import { useCallback, useSyncExternalStore } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { meetingListQuery, PAGE_SIZE, type MeetingListScope } from '../lib/meetingListQuery'
export type { HistoryPage, MeetingStatusFilter } from '../lib/meetingListQuery'
import { useUserStore } from '../store/userStore'
import { forgetMeetingPhoto } from './useMeetingPhoto'

export interface MeetingListItem {
  id: string
  name: string
  date: string
  memberCount: number
  totalAmount: number
  status: 'active' | 'settled'
  photoVersion?: string | null
  photoAccessConfirmed?: boolean
}

const GRACE_PERIOD_MS = 30_000
const pending = { meetings: [] as MeetingListItem[], loading: true, error: false, hasPrevious: false, hasNext: false }
const idle = { ...pending, loading: false }

interface Entry {
  uid: string
  key: string
  state: typeof pending
  subscribers: Set<() => void>
  stop?: () => void
  timer?: ReturnType<typeof setTimeout>
}

const lists = new Map<MeetingListScope['kind'], Entry>()
const views = new Map<string, unknown>()
const viewListeners = new Set<() => void>()

function dispose(kind: MeetingListScope['kind'], entry: Entry) {
  clearTimeout(entry.timer)
  entry.stop?.()
  if (lists.get(kind) === entry) lists.delete(kind)
}

export function clearMeetingsCache() {
  for (const [kind, entry] of lists) {
    dispose(kind, entry)
    entry.state = idle
    entry.subscribers.forEach((notify) => notify())
  }
  views.clear()
  viewListeners.forEach((notify) => notify())
}

useUserStore.subscribe((next, previous) => {
  if (next.uid !== previous.uid) clearMeetingsCache()
})

export function useMeetingListView<T>(uid: string, kind: MeetingListScope['kind'], defaultView: T) {
  const key = JSON.stringify([uid, kind])
  const subscribe = useCallback((notify: () => void) => {
    viewListeners.add(notify)
    return () => { viewListeners.delete(notify) }
  }, [])
  const getSnapshot = useCallback(() => (views.get(key) as T | undefined) ?? defaultView, [key, defaultView])
  const view = useSyncExternalStore(subscribe, getSnapshot)
  function setView(next: T) {
    if (!uid) return
    views.set(key, next)
    viewListeners.forEach((notify) => notify())
  }
  return [view, setView] as const
}

function startListening(entry: Entry, scope: MeetingListScope) {
  entry.stop?.()
  let current = true

  function update(state: typeof pending) {
    entry.state = state
    entry.subscribers.forEach((notify) => notify())
  }

  update(pending)
  const unsubscribe = onSnapshot(meetingListQuery(db, entry.uid, scope), { includeMetadataChanges: true }, (snap) => {
    if (!current) return
    const before = scope.kind === 'history' && scope.page?.direction === 'before'
    const hasExtra = snap.size > PAGE_SIZE
    const documents = scope.kind === 'home' ? snap.docs
      : before ? snap.docs.slice(-PAGE_SIZE) : snap.docs.slice(0, PAGE_SIZE)
    const meetings = documents.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id, name: data.name, date: data.date, status: data.status ?? 'active',
        memberCount: data.memberUids?.length ?? 0, totalAmount: data.totalAmount ?? 0,
        photoVersion: data.photoVersion ?? null,
        photoAccessConfirmed: !snap.metadata.fromCache && !doc.metadata.hasPendingWrites,
      }
    })
    // Use cached data only for an already-open view. A new view waits for the server.
    if (snap.metadata.fromCache && entry.state.loading) return
    update({
      meetings, loading: false, error: false,
      hasPrevious: scope.kind === 'history' && (before ? hasExtra : !!scope.page),
      hasNext: scope.kind === 'history' && (before || hasExtra),
    })
  }, () => {
    if (!current) return
    for (const { id } of entry.state.meetings) forgetMeetingPhoto(entry.uid, id)
    update({ ...idle, error: true })
  })
  entry.stop = () => { current = false; unsubscribe() }
}

export function useMeetings(uid: string, scope: MeetingListScope) {
  const { kind } = scope
  const key = JSON.stringify([uid, scope])
  const subscribe = useCallback((notify: () => void) => {
    if (!uid) return () => {}
    const existing = lists.get(kind)
    let entry = existing
    if (!entry || entry.key !== key) {
      if (existing) dispose(kind, existing)
      entry = { uid, key, state: pending, subscribers: new Set() }
      lists.set(kind, entry)
      const [, selected] = JSON.parse(key) as [string, MeetingListScope]
      startListening(entry, selected)
    }
    const current = entry
    clearTimeout(current.timer)
    current.timer = undefined
    current.subscribers.add(notify)
    return () => {
      current.subscribers.delete(notify)
      if (lists.get(kind) === current && !current.subscribers.size) {
        current.timer = setTimeout(() => dispose(kind, current), GRACE_PERIOD_MS)
      }
    }
  }, [kind, key, uid])
  const getSnapshot = useCallback(() => {
    const entry = lists.get(kind)
    return entry?.key === key ? entry.state : uid ? pending : idle
  }, [kind, key, uid])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  function retry() {
    const entry = lists.get(kind)
    if (entry?.key === key) startListening(entry, scope)
  }
  return { ...state, retry }
}
