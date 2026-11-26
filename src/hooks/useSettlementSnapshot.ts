import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'
import type { SettlementSnapshot } from '../utils/settlementSnapshot'

export function useSettlementSnapshot(meetingId: string | undefined, enabled: boolean) {
  const uid = useUserStore((state) => state.uid)
  const key = enabled && uid && meetingId ? JSON.stringify([uid, meetingId]) : null
  const [result, setResult] = useState<{ key: string; snapshot: SettlementSnapshot | null; error: boolean }>()

  useEffect(() => {
    if (!key || !meetingId) {
      setResult(undefined)
      return
    }

    return onSnapshot(
      doc(db, 'meetings', meetingId, 'settlements', 'final'),
      { includeMetadataChanges: true },
      (document) => {
        if (document.metadata.fromCache) return
        const snapshot = document.exists() ? document.data() as SettlementSnapshot : null
        setResult({ key, snapshot, error: !snapshot })
      },
      () => setResult({ key, snapshot: null, error: true }),
    )
  }, [key, meetingId])

  const current = result?.key === key ? result : undefined
  return { snapshot: current?.snapshot ?? null, loading: !!key && !current, error: !!current?.error }
}
