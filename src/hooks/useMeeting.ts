import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { doc, collection, getDocFromServer, onSnapshot, query, orderBy, type DocumentSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'
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

type LedgerMode = 'all' | 'active' | 'none' | 'metadata'

interface CacheEntry {
  uid: string
  meetingId: string
  state: MeetingState
  listeners: Map<() => void, LedgerMode>
  stop?: () => void
  syncParticipants?: () => void
  stopLedger?: () => void
  teardownTimer?: ReturnType<typeof setTimeout>
  ledgerTimer?: ReturnType<typeof setTimeout>
}

const GRACE_PERIOD_MS = 30_000
const cache = new Map<string, CacheEntry>()
const cacheKey = (uid: string, meetingId: string) => JSON.stringify([uid, meetingId])
const initialState: MeetingState = {
  meeting: null, members: {}, expenses: [], meetingReady: false, membersReady: false, expensesReady: false, error: false,
}
const idleState: MeetingState = { ...initialState, meetingReady: true, membersReady: true, expensesReady: true }

function update(entry: CacheEntry, partial: Partial<MeetingState>) {
  entry.state = { ...entry.state, ...partial }
  entry.listeners.forEach((_, notify) => notify())
}

function stopLedger(entry: CacheEntry) {
  clearTimeout(entry.ledgerTimer)
  entry.ledgerTimer = undefined
  entry.stopLedger?.()
  entry.stopLedger = undefined
  update(entry, { expenses: [], expensesReady: false, ledgerError: false })
}

function dispose(entry: CacheEntry) {
  clearTimeout(entry.teardownTimer)
  entry.stop?.()
  entry.stop = undefined
  cache.delete(cacheKey(entry.uid, entry.meetingId))
  stopLedger(entry)
}

export function clearMeetingCache(): void {
  for (const entry of cache.values()) dispose(entry)
}

useUserStore.subscribe((next, previous) => {
  if (previous.uid === next.uid) return
  for (const entry of cache.values()) if (entry.uid === previous.uid) dispose(entry)
})

export function forgetMeeting(meetingId: string) {
  const entry = cache.get(cacheKey(useUserStore.getState().uid, meetingId))
  if (entry) dispose(entry)
}

export function refreshMeeting(meetingId: string) {
  const entry = cache.get(cacheKey(useUserStore.getState().uid, meetingId))
  if (!entry) return
  entry.stop?.()
  stopLedger(entry)
  update(entry, { ...initialState, access: undefined, participants: undefined })
  startRoom(entry)
}

function mapMeeting(snap: DocumentSnapshot): Meeting | null {
  if (!snap.exists()) return null
  const data = snap.data()
  return {
    id: snap.id, name: data.name, date: data.date, memo: data.memo,
    memberUids: data.memberUids ?? [], photoVersion: data.photoVersion ?? null,
    photoAccessConfirmed: !snap.metadata.fromCache && !snap.metadata.hasPendingWrites,
    status: data.status ?? 'active',
  }
}

function mapExpense(document: DocumentSnapshot): Expense | null {
  const data = document.data()
  if (!data || data.deleted === true) return null
  if (data.schemaVersion !== 4 || !Array.isArray(data.shares)) throw new Error('INVALID_EXPENSE')
  const shares: ExpenseShare[] = data.shares
  return {
    id: document.id, amount: data.amount, paidBy: data.paidBy, createdBy: data.createdBy,
    memo: data.memo ?? '', category: data.category ?? '', shares,
    splitMemberUids: shares.map((share) => share.participantId), revision: data.revision,
  }
}

function canReadLedger(entry: CacheEntry) {
  const { meeting, access } = entry.state
  return !!meeting?.memberUids.includes(entry.uid) && !!access?.participantId
}

function wantsLedger(state: MeetingState, mode: LedgerMode) {
  return mode === 'all' || (mode === 'active' && state.meeting?.status === 'active')
}

function syncLedger(entry: CacheEntry) {
  const allowed = canReadLedger(entry)
  const wanted = [...entry.listeners.values()].some((mode) => wantsLedger(entry.state, mode))
  if (!allowed || !wanted) {
    if (!entry.stopLedger) return
    if (!allowed || entry.state.meeting?.status === 'settled') stopLedger(entry)
    else entry.ledgerTimer ??= setTimeout(() => stopLedger(entry), GRACE_PERIOD_MS)
    return
  }
  clearTimeout(entry.ledgerTimer)
  entry.ledgerTimer = undefined
  if (entry.stopLedger) return

  let current = true
  const unsubscribe = onSnapshot(
    query(collection(db, 'meetings', entry.meetingId, 'expenses'), orderBy('createdAt', 'asc')),
    { includeMetadataChanges: true },
    (snap) => {
      if (!current || snap.metadata.fromCache) return
      try {
        const expenses: Expense[] = []
        snap.forEach((document) => {
          const expense = mapExpense(document)
          if (expense) expenses.push(expense)
        })
        update(entry, { expenses, expensesReady: true, ledgerError: false })
      } catch {
        update(entry, { expenses: [], expensesReady: true, ledgerError: true })
      }
    },
    (error) => {
      if (!current) return
      if (error.code === 'permission-denied') {
        entry.stop?.()
        stopLedger(entry)
        update(entry, { ...idleState, access: undefined, participants: undefined, error: true })
      } else update(entry, { expenses: [], expensesReady: true, ledgerError: true })
    },
  )
  entry.stopLedger = () => { current = false; unsubscribe() }
}

function startRoom(entry: CacheEntry) {
  const { meetingId, uid } = entry
  let stopped = false
  let accessGeneration = 0
  let requestedMember = false
  let participantUnsub: (() => void) | undefined

  let participantGeneration = 0
  let participantTimer: ReturnType<typeof setTimeout> | undefined

  function stopParticipants() {
    participantGeneration++
    clearTimeout(participantTimer)
    participantTimer = undefined
    participantUnsub?.()
    participantUnsub = undefined
  }

  entry.syncParticipants = () => {
    if (stopped || !entry.state.access?.participantId) return
    if (![...entry.listeners.values()].some((mode) => mode !== 'metadata')) {
      if (participantUnsub) participantTimer ??= setTimeout(() => {
        stopParticipants()
        update(entry, { participants: undefined, members: {}, membersReady: false })
      }, GRACE_PERIOD_MS)
      return
    }
    clearTimeout(participantTimer)
    participantTimer = undefined
    if (participantUnsub) return
    const generation = ++participantGeneration
    participantUnsub = onSnapshot(
      collection(db, 'meetings', meetingId, 'participants'), { includeMetadataChanges: true },
      (snap) => {
        if (stopped || generation !== participantGeneration || snap.metadata.fromCache) return
        const participants: MeetingParticipants = {}
        const members: MemberMap = {}
        snap.forEach((document) => {
          const participant = document.data() as MeetingParticipants[string]
          participants[document.id] = participant
          if (participant.status === 'active' && participant.name) members[document.id] = participant.name
        })
        update(entry, { participants, members, membersReady: true })
      }, () => {
        if (!stopped && generation === participantGeneration) resetRoom(true)
      },
    )
  }

  function resetRoom(error = false) {
    accessGeneration++
    requestedMember = false
    stopParticipants()
    stopLedger(entry)
    update(entry, { ...idleState, expensesReady: false, access: undefined, participants: undefined, error })
  }

  async function resolveAccess(inviteOnly: boolean) {
    const generation = ++accessGeneration
    try {
      const access = await participantRoomRequest<RoomAccess>(meetingId, 'access')
      if (stopped || generation !== accessGeneration) return
      if (access.mode !== 'participants' || access.modelVersion !== 2) {
        resetRoom(true)
        return
      }
      if (inviteOnly || !access.participantId) {
        const meeting: Meeting = {
          id: meetingId, name: access.name, status: access.canJoin ? 'active' : 'settled',
          memberUids: [], date: '', memo: '',
        }
        update(entry, { ...idleState, meeting, access: undefined, participants: undefined })
        return
      }
      update(entry, { access })
      syncLedger(entry)
      entry.syncParticipants?.()
    } catch (error) {
      if (!stopped && generation === accessGeneration) {
        resetRoom(!(error instanceof Error && error.message === 'ROOM_NOT_FOUND'))
      }
    }
  }

  const unsubscribe = onSnapshot(doc(db, 'meetings', meetingId), { includeMetadataChanges: true }, (snap) => {
    if (stopped || snap.metadata.fromCache) return
    const meeting = mapMeeting(snap)
    if (!meeting || snap.data()?.participantModelVersion !== 2) {
      resetRoom(!!meeting)
      return
    }
    if (!meeting.memberUids.includes(uid)) {
      resetRoom()
      update(entry, { meetingReady: false, membersReady: false })
      void resolveAccess(true)
      return
    }
    update(entry, { meeting, meetingReady: true, error: false })
    if (!requestedMember) {
      requestedMember = true
      void resolveAccess(false)
    }
    syncLedger(entry)
  }, (error) => {
    if (stopped) return
    resetRoom(error.code !== 'permission-denied')
    if (error.code === 'permission-denied') {
      update(entry, { meetingReady: false, membersReady: false })
      void resolveAccess(true)
    }
  })

  entry.stop = () => {
    stopped = true
    stopParticipants()
    entry.syncParticipants = undefined
    unsubscribe()
  }
}

function subscribe(uid: string, meetingId: string, mode: LedgerMode, callback: () => void) {
  const key = cacheKey(uid, meetingId)
  let entry = cache.get(key)
  if (!entry) {
    entry = { uid, meetingId, state: initialState, listeners: new Map() }
    cache.set(key, entry)
    startRoom(entry)
  }
  const current = entry
  clearTimeout(current.teardownTimer)
  current.listeners.set(callback, mode)
  current.syncParticipants?.()
  syncLedger(current)
  return () => {
    current.listeners.delete(callback)
    if (cache.get(key) !== current) return
    if (!current.listeners.size) current.teardownTimer = setTimeout(() => dispose(current), GRACE_PERIOD_MS)
    current.syncParticipants?.()
    syncLedger(current)
  }
}

export function useMeeting(meetingId: string | undefined, mode: LedgerMode = 'all') {
  const uid = useUserStore((state) => state.uid)
  const subscribeFn = useCallback(
    (callback: () => void) => meetingId && uid ? subscribe(uid, meetingId, mode, callback) : () => {},
    [meetingId, uid, mode],
  )
  const getSnapshot = useCallback(
    () => meetingId && uid ? cache.get(cacheKey(uid, meetingId))?.state ?? initialState : idleState,
    [meetingId, uid],
  )
  const state = useSyncExternalStore(subscribeFn, getSnapshot)
  const ledgerAvailable = !!(uid && meetingId && cache.get(cacheKey(uid, meetingId))?.stopLedger)
  const useLedger = wantsLedger(state, mode)
  return {
    meeting: state.meeting, members: state.members, participants: state.participants, access: state.access,
    expenses: state.expenses, ledgerAvailable, ledgerError: !!state.ledgerError,
    loading: !state.meetingReady || (mode === 'metadata'
      ? !!state.meeting?.memberUids.includes(uid) && !state.access?.participantId
      : !state.membersReady),
    expensesReady: state.expensesReady,
    error: state.error || (useLedger && !!state.ledgerError),
  }
}

export function useExpenseForEdit(
  meetingId: string | undefined, id: string | null, room: ReturnType<typeof useMeeting>,
) {
  const uid = useUserStore((state) => state.uid)
  const enabled = !!(uid && meetingId && id && !room.loading && !room.error &&
    room.meeting?.status === 'active' && room.meeting.memberUids.includes(uid) && room.access?.participantId)
  const key = enabled ? JSON.stringify([uid, meetingId, id, room.access?.participantId]) : null
  const [result, setResult] = useState<{ key: string; expense: Expense | null; error: boolean }>()
  const shared = room.ledgerAvailable && !room.ledgerError
  const sharedExpense = shared ? room.expenses.find((expense) => expense.id === id) ?? null : null
  const loadedKey = result?.key
  useEffect(() => {
    if (!key || !meetingId || !id) return
    if (shared) {
      if (room.expensesReady) setResult({ key, expense: sharedExpense, error: false })
      return
    }
    if (loadedKey === key) return
    let current = true
    void getDocFromServer(doc(db, 'meetings', meetingId, 'expenses', id))
      .then(mapExpense)
      .then(
        (expense) => { if (current) setResult({ key, expense, error: false }) },
        () => { if (current) setResult({ key, expense: null, error: true }) },
      )
    return () => { current = false }
  }, [key, meetingId, id, shared, sharedExpense, room.expensesReady, loadedKey])

  if (!key) return { expense: null, ready: false, error: false }
  if (shared) return { expense: sharedExpense, ready: room.expensesReady, error: false }
  return result?.key === key
    ? { expense: result.expense, ready: true, error: result.error }
    : { expense: null, ready: false, error: false }
}
