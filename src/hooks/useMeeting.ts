import { useEffect, useState } from 'react'
import { doc, collection, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'

export interface Meeting {
  id: string
  name: string
  date: string
  memo: string
  createdBy: string
  photoUrl: string | null
}

export interface MemberMap {
  [uid: string]: string
}

export interface Expense {
  id: string
  amount: number
  paidBy: string
  memo: string
}

export function useMeeting(meetingId: string | undefined) {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [members, setMembers] = useState<MemberMap>({})
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!meetingId) {
      setLoading(true)
      return
    }

    setLoading(true)

    const meetingUnsub = onSnapshot(doc(db, 'meetings', meetingId), (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setMeeting({
          id: snap.id,
          name: data.name,
          date: data.date,
          memo: data.memo,
          createdBy: data.createdBy,
          photoUrl: data.photoUrl ?? null,
        })
      } else {
        setMeeting(null)
      }
      setLoading(false)
    })

    const membersUnsub = onSnapshot(collection(db, 'meetings', meetingId, 'members'), (snap) => {
      const map: MemberMap = {}
      snap.forEach((d) => {
        map[d.id] = d.data().nickname
      })
      setMembers(map)
    })

    const expensesUnsub = onSnapshot(collection(db, 'meetings', meetingId, 'expenses'), (snap) => {
      const list: Expense[] = []
      snap.forEach((d) => {
        const data = d.data()
        list.push({
          id: d.id,
          amount: data.amount,
          paidBy: data.paidBy,
          memo: data.memo,
        })
      })
      setExpenses(list)
    })

    return () => {
      meetingUnsub()
      membersUnsub()
      expensesUnsub()
    }
  }, [meetingId])

  return { meeting, members, expenses, loading }
}
