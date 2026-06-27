import { useEffect, useState } from 'react'
import { doc, collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'

export interface Meeting {
  id: string
  name: string
  date: string
  memo: string
  createdBy: string
  photoUrl: string | null
  photoPublicId: string | null
  status: 'active' | 'settled'
}

export interface MemberMap {
  [uid: string]: string
}

export interface Expense {
  id: string
  amount: number
  paidBy: string
  memo: string
  category: string
}

export function useMeeting(meetingId: string | undefined) {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [members, setMembers] = useState<MemberMap>({})
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [meetingReady, setMeetingReady] = useState(false)
  const [membersReady, setMembersReady] = useState(false)
  const [error, setError] = useState(false)

  const loading = !meetingReady || !membersReady

  useEffect(() => {
    if (!meetingId) {
      setMeetingReady(true)
      setMembersReady(true)
      return
    }

    setMeetingReady(false)
    setMembersReady(false)
    setError(false)

    const meetingUnsub = onSnapshot(
      doc(db, 'meetings', meetingId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data()
          setMeeting({
            id: snap.id,
            name: data.name,
            date: data.date,
            memo: data.memo,
            createdBy: data.createdBy,
            photoUrl: data.photoUrl ?? null,
            photoPublicId: data.photoPublicId ?? null,
            status: data.status ?? 'active',
          })
        } else {
          setMeeting(null)
        }
        setMeetingReady(true)
      },
      () => { setError(true); setMeetingReady(true) },
    )

    const membersUnsub = onSnapshot(
      collection(db, 'meetings', meetingId, 'members'),
      (snap) => {
        const map: MemberMap = {}
        snap.forEach((d) => { map[d.id] = d.data().nickname })
        setMembers(map)
        setMembersReady(true)
      },
      () => { setError(true); setMembersReady(true) },
    )

    const expensesQuery = query(
      collection(db, 'meetings', meetingId, 'expenses'),
      orderBy('createdAt', 'asc'),
    )
    const expensesUnsub = onSnapshot(
      expensesQuery,
      (snap) => {
        const list: Expense[] = []
        snap.forEach((d) => {
          const data = d.data()
          list.push({
            id: d.id,
            amount: data.amount,
            paidBy: data.paidBy,
            memo: data.memo ?? '',
            category: data.category ?? '',
          })
        })
        setExpenses(list)
      },
      () => { setError(true) },
    )

    return () => {
      meetingUnsub()
      membersUnsub()
      expensesUnsub()
    }
  }, [meetingId])

  return { meeting, members, expenses, loading, error }
}

export function useMeetingMembers(meetingId: string | undefined) {
  const [members, setMembers] = useState<MemberMap>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!meetingId) { setLoading(false); return }
    setLoading(true)
    const unsub = onSnapshot(
      collection(db, 'meetings', meetingId, 'members'),
      (snap) => {
        const map: MemberMap = {}
        snap.forEach((d) => { map[d.id] = d.data().nickname })
        setMembers(map)
        setLoading(false)
      },
      () => { setLoading(false) },
    )
    return () => unsub()
  }, [meetingId])

  return { members, loading }
}
