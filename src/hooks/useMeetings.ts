import { useEffect, useState } from 'react'
import { collection, onSnapshot, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'

export interface MeetingListItem {
  id: string
  name: string
  date: string
  memberCount: number
  totalAmount: number
}

export function useMeetings(uid: string) {
  const [meetings, setMeetings] = useState<MeetingListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) {
      setMeetings([])
      setLoading(false)
      return
    }

    setLoading(true)

    const unsub = onSnapshot(collection(db, 'meetings'), async (snap) => {
      const results: MeetingListItem[] = []

      await Promise.all(
        snap.docs.map(async (meetingDoc) => {
          const memberSnap = await getDocs(collection(db, 'meetings', meetingDoc.id, 'members'))
          const memberIds = memberSnap.docs.map((d) => d.id)

          if (!memberIds.includes(uid)) return

          const expenseSnap = await getDocs(collection(db, 'meetings', meetingDoc.id, 'expenses'))
          const totalAmount = expenseSnap.docs.reduce((sum, d) => sum + (d.data().amount ?? 0), 0)

          const data = meetingDoc.data()
          results.push({
            id: meetingDoc.id,
            name: data.name,
            date: data.date,
            memberCount: memberIds.length,
            totalAmount,
          })
        })
      )

      results.sort((a, b) => a.date < b.date ? 1 : -1)
      setMeetings(results)
      setLoading(false)
    })

    return unsub
  }, [uid])

  return { meetings, loading }
}
