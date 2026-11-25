import { useEffect, useState } from 'react'
import { doc, getDocFromCache, getDocFromServer, type DocumentSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'

const cache = new Map<string, Promise<Blob | null>>()
const CACHE_LIMIT = 64
useUserStore.subscribe((next, previous) => {
  if (next.uid !== previous.uid) cache.clear()
})

export function forgetMeetingPhoto(uid: string, meetingId: string, keepVersion?: string | null) {
  const prefix = JSON.stringify([uid, meetingId]).slice(0, -1) + ','
  const retainedKey = JSON.stringify([uid, meetingId, keepVersion])
  for (const key of cache.keys()) {
    if (key.startsWith(prefix) && key !== retainedKey) cache.delete(key)
  }
}

function loadPhoto(key: string, meetingId: string, version: string) {
  const existing = cache.get(key)
  if (existing) {
    cache.delete(key)
    cache.set(key, existing)
    return existing
  }
  const ref = doc(db, 'meetings', meetingId, 'photos', 'cover')
  function toBlob(snapshot: DocumentSnapshot) {
    const photo = snapshot.data()
    if (!photo || photo.version !== version || !photo.bytes) return null
    const bytes = photo.bytes.toUint8Array()
    return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
  }
  const pending = getDocFromCache(ref).then(toBlob, () => null)
    .then((cached) => cached ?? getDocFromServer(ref).then(toBlob))
    .catch(() => null)
  cache.set(key, pending)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  void pending.then((blob) => {
    if (!blob && cache.get(key) === pending) cache.delete(key)
  })
  return pending
}

export function useMeetingPhoto(
  meetingId: string | undefined,
  version: string | null | undefined,
  allowed: boolean,
  enabled = true,
) {
  const uid = useUserStore((state) => state.uid)
  const key = allowed && enabled && uid && meetingId && version
    ? JSON.stringify([uid, meetingId, version])
    : null
  const [image, setImage] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (uid && meetingId) forgetMeetingPhoto(uid, meetingId, allowed ? version : null)
    if (!key || !meetingId || !version) return
    let live = true
    let url: string | undefined
    void loadPhoto(key, meetingId, version).then((blob) => {
      if (!live || !blob) return
      url = URL.createObjectURL(blob)
      setImage({ key, url })
    })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [allowed, key, meetingId, uid, version])

  return image && image.key === key ? image.url : null
}
