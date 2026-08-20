import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { SettlementSnapshot } from '../utils/settlementSnapshot'

export function useSettlementSnapshot(meetingId: string | undefined, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<SettlementSnapshot | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(false)

  useEffect(() => {
    setSnapshot(null)
    setError(false)
    if (!meetingId || !enabled) {
      setLoading(false)
      return
    }

    setLoading(true)
    return onSnapshot(
      doc(db, 'meetings', meetingId, 'settlements', 'final'),
      (document) => {
        setSnapshot(document.exists() ? document.data() as SettlementSnapshot : null)
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
  }, [meetingId, enabled])

  return { snapshot, loading, error }
}

