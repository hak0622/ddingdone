import { useCallback, useSyncExternalStore } from 'react'
import { doc, collection, onSnapshot, query, orderBy, type DocumentSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { participantRoomRequest, type RoomAccess } from '../lib/participantRooms'
import { type MeetingParticipants } from '../utils/meetingParticipants'
import { type ExpenseShare } from '../utils/expenseShares'

export interface Meeting {
  id: string
  name: string
  date: string
  memo: string
  memberUids: string[]
  photoVersion?: string | null
  photoAccessConfirmed?: boolean
  status: 'active' | 'settled'
}

export interface MemberMap {
  [uid: string]: string
}

export interface Expense {
  id: string
  amount: number
  paidBy: string
  createdBy: string
  memo: string
  category: string
  splitMemberUids?: string[]
  shares: ExpenseShare[]
  revision?: string
}

interface MeetingState {
  meeting: Meeting | null
  members: MemberMap
  expenses: Expense[]
  participants?: MeetingParticipants
  access?: Extract<RoomAccess, { mode: 'participants' }>
  meetingReady: boolean
  membersReady: boolean
  expensesReady: boolean
  error: boolean
  ledgerError?: boolean
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

export function clearMeetingCache(): void {
  for (const entry of cache.values()) {
    if (entry.teardownTimer) clearTimeout(entry.teardownTimer)
    entry.unsubs.forEach((unsubscribe) => unsubscribe())
    entry.listeners.clear()
  }
  cache.clear()
}

function emptyState(): MeetingState {
  return { meeting: null, members: {}, expenses: [], meetingReady: false, membersReady: false, expensesReady: false, error: false }
}

const IDLE_STATE: MeetingState = { meeting: null, members: {}, expenses: [], meetingReady: true, membersReady: true, expensesReady: true, error: false }

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
    memberUids: data.memberUids ?? [],
    photoVersion: data.photoVersion ?? null,
    photoAccessConfirmed: !snap.metadata.fromCache && !snap.metadata.hasPendingWrites,
    status: data.status ?? 'active',
  }
}

export function refreshMeeting(meetingId: string) {
  const entry = cache.get(meetingId)
  if (!entry) return
  entry.unsubs.forEach((unsubscribe) => unsubscribe())
  entry.state = emptyState()
  startListening(meetingId, entry)
  notify(entry)
}

function startListening(meetingId: string, entry: CacheEntry) {
  let stopped = false
  let requestedAccess = false
  let accessPending = false
  let participantUnsub: (() => void) | undefined
  function update(state: Partial<MeetingState>) {
    if (stopped) return
    entry.state = { ...entry.state, ...state }
    notify(entry)
  }

  async function readParticipantAccess(inviteOnly: boolean) {
    if (accessPending) return
    accessPending = true
    try {
      const access = await participantRoomRequest<RoomAccess>(meetingId, 'access')
      if (stopped) return
      if (access.mode !== 'participants' || access.modelVersion !== 2) {
        update({ error: true, meetingReady: true, membersReady: true })
        return
      }
      if (inviteOnly || !access.participantId) {
        const meeting = {
          id: meetingId, name: access.name, status: access.canJoin ? 'active' : 'settled',
          memberUids: [], date: '', memo: '',
        } satisfies Meeting
        update({ meeting, access, members: {}, participants: {}, expenses: [],
          error: false, meetingReady: true, membersReady: true, expensesReady: true })
        return
      }
      update({ access })
      participantUnsub = onSnapshot(collection(db, 'meetings', meetingId, 'participants'), (snap) => {
        const participants: MeetingParticipants = {}
        const members: MemberMap = {}
        snap.forEach((document) => {
          const participant = document.data() as MeetingParticipants[string]
          participants[document.id] = participant
          if (participant.status === 'active' && participant.name) members[document.id] = participant.name
        })
        update({ participants, members, membersReady: true, error: false })
      }, () => update({ participants: {}, members: {}, expenses: [], error: true, membersReady: true }))
    } catch (error) {
      if (error instanceof Error && error.message === 'ROOM_NOT_FOUND') {
        update({ meeting: null, error: false, meetingReady: true, membersReady: true })
      } else update({ error: true, meetingReady: true, membersReady: true })
    } finally {
      accessPending = false
    }
  }

  const meetingUnsub = onSnapshot(doc(db, 'meetings', meetingId), { includeMetadataChanges: true }, (snap) => {
    const meeting = mapMeeting(snap)
    if (snap.metadata.fromCache) return
    if (!meeting) {
      participantUnsub?.()
      update({ ...emptyState(), meetingReady: true, membersReady: true, expensesReady: true })
      return
    }
    if (snap.data()?.participantModelVersion !== 2) {
      update({ ...emptyState(), error: true, meetingReady: true, membersReady: true, expensesReady: true })
      return
    }
    update({ meeting, meetingReady: true })
    if (!requestedAccess) {
      requestedAccess = true
      void readParticipantAccess(false)
    }
  }, (error) => {
    if (error.code !== 'permission-denied') {
      update({ error: true, meetingReady: true, membersReady: true })
      return
    }
    participantUnsub?.()
    update({ meeting: null, members: {}, participants: {}, expenses: [], access: undefined, meetingReady: false, membersReady: false })
    void readParticipantAccess(true)
  })

  const expensesUnsub = onSnapshot(
    query(collection(db, 'meetings', meetingId, 'expenses'), orderBy('createdAt', 'asc')),
    (snap) => {
      const expenses: Expense[] = []
      let invalidLedger = false
      snap.forEach((document) => {
        const data = document.data()
        if (data.deleted === true) return
        if (data.schemaVersion !== 4 || !Array.isArray(data.shares)) {
          invalidLedger = true
          return
        }
        expenses.push({
          id: document.id, amount: data.amount, paidBy: data.paidBy, createdBy: data.createdBy,
          memo: data.memo ?? '', category: data.category ?? '',
          shares: data.shares, splitMemberUids: data.shares.map((share: ExpenseShare) => share.participantId),
          revision: data.revision,
        })
      })
      update({ expenses: invalidLedger ? [] : expenses, expensesReady: true, ledgerError: invalidLedger })
    },
    () => update({ expenses: [], expensesReady: true, ...(entry.state.access?.participantId ? { error: true } : {}) }),
  )

  entry.unsubs = [() => { stopped = true; participantUnsub?.() }, meetingUnsub, expensesUnsub]
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
    participants: state.participants,
    access: state.access,
    expenses: state.expenses,
    loading: !state.meetingReady || !state.membersReady,
    expensesReady: state.expensesReady,
    error: state.error || !!state.ledgerError,
  }
}

export function useMeetingMembers(meetingId: string | undefined) {
  const { members, loading } = useMeeting(meetingId)
  return { members, loading }
}
