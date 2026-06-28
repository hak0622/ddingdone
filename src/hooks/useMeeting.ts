import { useCallback, useSyncExternalStore } from 'react'
import { doc, collection, onSnapshot, query, orderBy, type DocumentSnapshot } from 'firebase/firestore'
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

interface MeetingState {
  meeting: Meeting | null
  members: MemberMap
  expenses: Expense[]
  meetingReady: boolean
  membersReady: boolean
  error: boolean
}

interface CacheEntry {
  state: MeetingState
  listeners: Set<() => void>
  unsubs: Array<() => void>
  teardownTimer: ReturnType<typeof setTimeout> | null
}

// 같은 모임을 보는 화면(상세/수정/지출입력/정산)을 오갈 때마다 매번 구독을
// 새로 맺으면 멤버/지출 목록을 다시 읽어들이게 되어 Firestore 읽기 횟수가
// 불필요하게 늘어난다. meetingId 하나당 구독을 하나만 유지하고 여러 화면이
// 공유하게 한다. 마지막 구독자가 떠나도 곧바로 끊지 않고 잠시 유지해서, 화면
// 사이를 빠르게 오갈 때 매번 다시 읽는 것을 막는다.
const GRACE_PERIOD_MS = 30_000
const cache = new Map<string, CacheEntry>()

function emptyState(): MeetingState {
  return { meeting: null, members: {}, expenses: [], meetingReady: false, membersReady: false, error: false }
}

const IDLE_STATE: MeetingState = { meeting: null, members: {}, expenses: [], meetingReady: true, membersReady: true, error: false }

function notify(entry: CacheEntry) {
  entry.listeners.forEach((l) => l())
}

function mapMeeting(snap: DocumentSnapshot): Meeting | null {
  if (!snap.exists()) return null
  const data = snap.data()
  return {
    id: snap.id,
    name: data.name,
    date: data.date,
    memo: data.memo,
    createdBy: data.createdBy,
    photoUrl: data.photoUrl ?? null,
    photoPublicId: data.photoPublicId ?? null,
    status: data.status ?? 'active',
  }
}

function startListening(meetingId: string, entry: CacheEntry) {
  const meetingUnsub = onSnapshot(
    doc(db, 'meetings', meetingId),
    (snap) => {
      entry.state = { ...entry.state, meeting: mapMeeting(snap), meetingReady: true }
      notify(entry)
    },
    () => {
      entry.state = { ...entry.state, error: true, meetingReady: true }
      notify(entry)
    },
  )

  const membersUnsub = onSnapshot(
    collection(db, 'meetings', meetingId, 'members'),
    (snap) => {
      const map: MemberMap = {}
      snap.forEach((d) => { map[d.id] = d.data().nickname })
      entry.state = { ...entry.state, members: map, membersReady: true }
      notify(entry)
    },
    () => {
      entry.state = { ...entry.state, error: true, membersReady: true }
      notify(entry)
    },
  )

  const expensesUnsub = onSnapshot(
    query(collection(db, 'meetings', meetingId, 'expenses'), orderBy('createdAt', 'asc')),
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
      entry.state = { ...entry.state, expenses: list }
      notify(entry)
    },
    () => {
      entry.state = { ...entry.state, error: true }
      notify(entry)
    },
  )

  entry.unsubs = [meetingUnsub, membersUnsub, expensesUnsub]
}

function getOrCreateEntry(meetingId: string): CacheEntry {
  const existing = cache.get(meetingId)
  if (existing) return existing
  const entry: CacheEntry = { state: emptyState(), listeners: new Set(), unsubs: [], teardownTimer: null }
  cache.set(meetingId, entry)
  startListening(meetingId, entry)
  return entry
}

function subscribe(meetingId: string, callback: () => void): () => void {
  const entry = getOrCreateEntry(meetingId)
  if (entry.teardownTimer) {
    clearTimeout(entry.teardownTimer)
    entry.teardownTimer = null
  }
  entry.listeners.add(callback)
  return () => {
    entry.listeners.delete(callback)
    if (entry.listeners.size === 0) {
      entry.teardownTimer = setTimeout(() => {
        entry.unsubs.forEach((u) => u())
        cache.delete(meetingId)
      }, GRACE_PERIOD_MS)
    }
  }
}

export function useMeeting(meetingId: string | undefined) {
  const subscribeFn = useCallback(
    (callback: () => void) => {
      if (!meetingId) return () => {}
      return subscribe(meetingId, callback)
    },
    [meetingId],
  )
  const getSnapshot = useCallback(
    () => (meetingId ? getOrCreateEntry(meetingId).state : IDLE_STATE),
    [meetingId],
  )

  const state = useSyncExternalStore(subscribeFn, getSnapshot)

  return {
    meeting: state.meeting,
    members: state.members,
    expenses: state.expenses,
    loading: !state.meetingReady || !state.membersReady,
    error: state.error,
  }
}

export function useMeetingMembers(meetingId: string | undefined) {
  const { members, loading } = useMeeting(meetingId)
  return { members, loading }
}
