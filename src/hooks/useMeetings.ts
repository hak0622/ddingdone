import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
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

    const q = query(
      collection(db, 'meetings'),
      where('memberUids', 'array-contains', uid)
    )
    const unsub = onSnapshot(q, (snap) => {
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

    return () => {
      unsub()
    }
  }, [uid])

  return { meetings, loading }
}
