import { useCallback, useSyncExternalStore } from 'react'
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

interface ListState {
  meetings: MeetingListItem[]
  loading: boolean
}

interface CacheEntry {
  state: ListState
  listeners: Set<() => void>
  unsub: (() => void) | null
  teardownTimer: ReturnType<typeof setTimeout> | null
}

// 홈 탭과 내역 탭이 같은 "내 모임 목록"을 각자 구독하면, 두 탭을 오갈 때마다
// 매번 다시 읽어들이게 된다. uid 하나당 구독을 하나만 유지하고 공유한다.
const GRACE_PERIOD_MS = 30_000
const cache = new Map<string, CacheEntry>()

const IDLE_STATE: ListState = { meetings: [], loading: false }

export function clearMeetingsCache(): void {
  for (const entry of cache.values()) {
    if (entry.teardownTimer) clearTimeout(entry.teardownTimer)
    entry.unsub?.()
    entry.listeners.clear()
  }
  cache.clear()
}

function notify(entry: CacheEntry) {
  entry.listeners.forEach((l) => l())
}

function startListening(uid: string, entry: CacheEntry) {
  const q = query(collection(db, 'meetings'), where('memberUids', 'array-contains', uid))
  entry.unsub = onSnapshot(
    q,
    (snap) => {
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
      entry.state = { meetings: results, loading: false }
      notify(entry)
    },
    () => {
      entry.state = { ...entry.state, loading: false }
      notify(entry)
    },
  )
}

function getOrCreateEntry(uid: string): CacheEntry {
  const existing = cache.get(uid)
  if (existing) return existing
  const entry: CacheEntry = { state: { meetings: [], loading: true }, listeners: new Set(), unsub: null, teardownTimer: null }
  cache.set(uid, entry)
  startListening(uid, entry)
  return entry
}

function subscribe(uid: string, callback: () => void): () => void {
  const entry = getOrCreateEntry(uid)
  if (entry.teardownTimer) {
    clearTimeout(entry.teardownTimer)
    entry.teardownTimer = null
  }
  entry.listeners.add(callback)
  return () => {
    entry.listeners.delete(callback)
    if (entry.listeners.size === 0) {
      entry.teardownTimer = setTimeout(() => {
        entry.unsub?.()
        cache.delete(uid)
      }, GRACE_PERIOD_MS)
    }
  }
}

export function useMeetings(uid: string) {
  const subscribeFn = useCallback(
    (callback: () => void) => {
      if (!uid) return () => {}
      return subscribe(uid, callback)
    },
    [uid],
  )
  const getSnapshot = useCallback(
    () => (uid ? getOrCreateEntry(uid).state : IDLE_STATE),
    [uid],
  )

  return useSyncExternalStore(subscribeFn, getSnapshot)
}
