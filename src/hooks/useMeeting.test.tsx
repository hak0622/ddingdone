import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { clearMeetingCache, useExpenseForEdit, useMeeting } from './useMeeting'

const onSnapshotMock = vi.fn<(...args: unknown[]) => () => void>(() => () => {})
import { useUserStore } from '../store/userStore'

const { request, getDocFromServer } = vi.hoisted(() => ({ request: vi.fn(), getDocFromServer: vi.fn() }))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...path) => ({ path: path.join('/') })),
  getDocFromServer,
  collection: vi.fn((_db, ...path) => ({ path: path.join('/') })),
  query: vi.fn((ref) => ref),
  orderBy: vi.fn(),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
}))
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('../lib/participantRooms', () => ({ participantRoomRequest: request }))

function Probe({ meetingId, mode = 'all' }: { meetingId: string; mode?: Parameters<typeof useMeeting>[1] }) {
  const { meeting, loading, error } = useMeeting(meetingId, mode)
  return <div>{loading ? 'loading' : error ? 'error' : meeting?.name}</div>
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  onSnapshotMock.mockClear()
  request.mockReset()
  getDocFromServer.mockReset()
  useUserStore.getState().setUser('uid', '닉네임')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  clearMeetingCache()
  container.remove()
  vi.useRealTimers()
})

describe('useMeeting 구독 공유', () => {
  it('같은 meetingId를 빠르게 mount/unmount/remount해도 onSnapshot은 한 번씩만 호출된다', () => {
    act(() => { root.render(<Probe meetingId="m1" />) })
    // 처음에는 권한 확인에 필요한 모임 문서만 구독한다
    expect(onSnapshotMock).toHaveBeenCalledTimes(1)

    act(() => { root.render(<></>) }) // unmount (grace period 시작)
    act(() => { root.render(<Probe meetingId="m1" />) }) // 바로 다시 mount

    // 새로 구독이 생기지 않고 기존 캐시를 그대로 재사용해야 한다
    expect(onSnapshotMock).toHaveBeenCalledTimes(1)
  })

  it('grace period가 지난 뒤 다시 mount하면 새로 구독한다', () => {
    vi.useFakeTimers()
    act(() => { root.render(<Probe meetingId="m2" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(1)

    act(() => { root.render(<></>) })
    act(() => { vi.advanceTimersByTime(31_000) })

    act(() => { root.render(<Probe meetingId="m2" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(2)
  })

  it('다른 meetingId는 각자 독립적으로 구독한다', () => {
    act(() => { root.render(<Probe meetingId="m3" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(1)
    act(() => { root.render(<Probe meetingId="m4" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(2)
  })

  it('구형 모임에는 접근하지 않고 v2 모임만 참여자 조회를 시작한다', async () => {
    request.mockResolvedValue({ mode: 'participants', modelVersion: 2, participantId: 'p1' })
    act(() => { root.render(<Probe meetingId="room" />) })
    const onRoom = onSnapshotMock.mock.calls[0][2] as (snapshot: unknown) => void
    const snapshot = (version: number) => ({
      id: 'room',
      exists: () => true,
      data: () => ({ name: '모임', participantModelVersion: version, memberUids: ['uid'] }),
      metadata: { fromCache: false, hasPendingWrites: false },
    })
    act(() => { onRoom(snapshot(1)) })
    expect(container.textContent).toBe('error')
    expect(request).not.toHaveBeenCalled()

    await act(async () => { onRoom(snapshot(2)) })
    expect(request).toHaveBeenCalledWith('room', 'access')
    const onParticipants = callsFor('participants')[0][2] as (snapshot: unknown) => void
    act(() => {
      onParticipants({ metadata: { fromCache: false }, forEach: (add: (record: unknown) => void) =>
        add({ id: 'p1', data: () => ({ status: 'active', name: '참여자' }) }) })
    })
    expect(container.textContent).toBe('모임')
  })
})

function callsFor(suffix: string) {
  return onSnapshotMock.mock.calls.filter(([ref]) => (ref as { path: string }).path.endsWith(suffix))
}

async function openRoom(status: 'active' | 'settled', mode: Parameters<typeof useMeeting>[1]) {
  request.mockResolvedValue({ mode: 'participants', modelVersion: 2, participantId: 'p1' })
  act(() => root.render(<Probe meetingId="room" mode={mode} />))
  const onRoom = callsFor('/room')[0][2] as (snapshot: unknown) => void
  await act(async () => onRoom({
    id: 'room', exists: () => true, data: () => ({ name: '모임', participantModelVersion: 2, memberUids: ['uid'], status }),
    metadata: { fromCache: false, hasPendingWrites: false },
  }))
}

it.each([['active', 'none'], ['settled', 'active']] as const)('직접 진입 시 %s 모임의 %s 모드에서는 전체 지출을 구독하지 않는다', async (status, mode) => {
  await openRoom(status, mode)
  expect(callsFor('/participants')).toHaveLength(1)
  expect(callsFor('/expenses')).toHaveLength(0)
})

it('초대 링크 비멤버와 이전 계정의 늦은 응답에 지출을 노출하지 않는다', async () => {
  request.mockResolvedValue({ mode: 'participants', modelVersion: 2, name: '초대', canJoin: true })
  act(() => root.render(<Probe meetingId="room" />))
  const deny = callsFor('/room')[0][3] as (error: unknown) => void
  await act(async () => deny({ code: 'permission-denied' }))
  expect(container.textContent).toBe('초대')
  expect(callsFor('/expenses')).toHaveLength(0)
  act(() => useUserStore.getState().setUser('other', ''))
  expect(container.textContent).toBe('loading')
  expect(callsFor('/room')).toHaveLength(2)
})

it('전체 지출을 공유하는 화면으로 전환하면 하나의 구독에서 100건이 반영된다', async () => {
  await openRoom('active', 'none')
  act(() => root.render(<Probe meetingId="room" mode="all" />))
  const [read] = callsFor('/expenses')
  const onExpenses = read[2] as (snapshot: unknown) => void
  act(() => onExpenses({ metadata: { fromCache: false }, forEach: (add: (value: unknown) => void) => {
    for (let i = 0; i < 100; i++) add({ id: String(i), data: () => ({ schemaVersion: 4, shares: [], amount: 100 }) })
  } }))
  act(() => root.render(<><Probe meetingId="room" mode="all" /><Probe meetingId="room" mode="all" /></>))
  expect(callsFor('/expenses')).toHaveLength(1)
})

function EditProbe() {
  const room = useMeeting('room', 'none')
  const { expense, ready } = useExpenseForEdit('room', 'expense', room)
  return <div>{ready ? expense?.id : 'loading'}</div>
}

it('비용 수정에 직접 진입하면 권한 확인 뒤 대상 한 건만 읽는다', async () => {
  await openRoom('active', 'none')
  getDocFromServer.mockResolvedValue({ id: 'expense', data: () => ({ schemaVersion: 4, shares: [], createdBy: 'p1' }) })
  await act(async () => root.render(<EditProbe />))
  expect(getDocFromServer).not.toHaveBeenCalled()
  const onParticipants = callsFor('/participants')[0][2] as (snapshot: unknown) => void
  await act(async () => onParticipants({ metadata: { fromCache: false }, forEach: () => {} }))
  expect(getDocFromServer).toHaveBeenCalledExactlyOnceWith({ path: 'meetings/room/expenses/expense' })
  expect(container.textContent).toBe('expense')
  expect(callsFor('/expenses')).toHaveLength(0)
})
