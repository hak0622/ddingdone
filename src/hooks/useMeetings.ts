import { useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

export interface MeetingListItem {
  id: string
  name: string
  date: string
  memberCount: number
  totalAmount: number
  expenseCount: number
  status: 'active' | 'settled'
  photoUrl: string | null
}

let _cache: MeetingListItem[] = []
let _cacheUid = ''

// 기존 도큐먼트에 memberUids/memberCount/totalAmount/expenseCount 필드 1회 백필
async function migrateOnce(uid: string) {
  const key = `ddingdone_migrated_${uid}`
  if (localStorage.getItem(key)) return

  const allSnap = await getDocs(collection(db, 'meetings'))
  await Promise.all(
    allSnap.docs
      .filter((d) => !d.data().memberUids)
      .map(async (meetingDoc) => {
        const memberSnap = await getDocs(
          collection(db, 'meetings', meetingDoc.id, 'members')
        )
        const allUids = memberSnap.docs.map((d) => d.id)
        if (!allUids.includes(uid)) return

        const realUids = allUids.filter((id) => !id.startsWith('pre_'))
        const expSnap = await getDocs(
          collection(db, 'meetings', meetingDoc.id, 'expenses')
        )
        const totalAmount = expSnap.docs.reduce(
          (s, e) => s + (e.data().amount ?? 0),
          0
        )
        await updateDoc(doc(db, 'meetings', meetingDoc.id), {
          memberUids: realUids,
          memberCount: allUids.length,
          totalAmount,
          expenseCount: expSnap.docs.length,
        })
      })
  )

  localStorage.setItem(key, '1')
}

export function useMeetings(uid: string) {
  const hasCache = _cacheUid === uid && _cache.length > 0
  const [meetings, setMeetings] = useState<MeetingListItem[]>(
    hasCache ? _cache : []
  )
  const [loading, setLoading] = useState(!hasCache)

  useEffect(() => {
    if (!uid) {
      setMeetings([])
      setLoading(false)
      return
    }

    let active = true
    let unsub: (() => void) | undefined

    migrateOnce(uid).then(() => {
      if (!active) return

      const q = query(
        collection(db, 'meetings'),
        where('memberUids', 'array-contains', uid)
      )
      unsub = onSnapshot(q, (snap) => {
        const results: MeetingListItem[] = snap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            name: data.name,
            date: data.date,
            memberCount: data.memberCount ?? 0,
            totalAmount: data.totalAmount ?? 0,
            expenseCount: data.expenseCount ?? 0,
            status: data.status ?? 'active',
            photoUrl: data.photoUrl ?? null,
          }
        })
        results.sort((a, b) => (a.date < b.date ? 1 : -1))
        _cache = results
        _cacheUid = uid
        setMeetings(results)
        setLoading(false)
      })
    })

    return () => {
      active = false
      unsub?.()
    }
  }, [uid])

  return { meetings, loading }
}
