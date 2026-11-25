import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { clearMeetingCache, useMeeting } from './useMeeting'

const onSnapshotMock = vi.fn<(...args: unknown[]) => () => void>(() => () => {})
const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ type: 'doc' })),
  collection: vi.fn(() => ({ type: 'collection' })),
  query: vi.fn((ref) => ref),
  orderBy: vi.fn(),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
}))
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('../lib/participantRooms', () => ({ participantRoomRequest: request }))

function Probe({ meetingId }: { meetingId: string }) {
  const { meeting, loading, error } = useMeeting(meetingId)
  return <div>{loading ? 'loading' : error ? 'error' : meeting?.name}</div>
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  onSnapshotMock.mockClear()
  request.mockReset()
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
    // 초기에는 모임 문서와 비용을 구독하고, 참여자는 권한 확인 후 구독한다
    expect(onSnapshotMock).toHaveBeenCalledTimes(2)

    act(() => { root.render(<></>) }) // unmount (grace period 시작)
    act(() => { root.render(<Probe meetingId="m1" />) }) // 바로 다시 mount

    // 새로 구독이 생기지 않고 기존 캐시를 그대로 재사용해야 한다
    expect(onSnapshotMock).toHaveBeenCalledTimes(2)
  })

  it('grace period가 지난 뒤 다시 mount하면 새로 구독한다', () => {
    vi.useFakeTimers()
    act(() => { root.render(<Probe meetingId="m2" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(2)

    act(() => { root.render(<></>) })
    act(() => { vi.advanceTimersByTime(31_000) })

    act(() => { root.render(<Probe meetingId="m2" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(4)
  })

  it('다른 meetingId는 각자 독립적으로 구독한다', () => {
    act(() => { root.render(<Probe meetingId="m3" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(2)
    act(() => { root.render(<Probe meetingId="m4" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(4)
  })

  it('구형 모임에는 접근하지 않고 v2 모임만 참여자 조회를 시작한다', async () => {
    request.mockResolvedValue({ mode: 'participants', modelVersion: 2, participantId: 'p1' })
    act(() => { root.render(<Probe meetingId="room" />) })
    const onRoom = onSnapshotMock.mock.calls[0][2] as (snapshot: unknown) => void
    const snapshot = (version: number) => ({
      id: 'room',
      exists: () => true,
      data: () => ({ name: '모임', participantModelVersion: version }),
      metadata: { fromCache: false, hasPendingWrites: false },
    })
    act(() => { onRoom(snapshot(1)) })
    expect(container.textContent).toBe('error')
    expect(request).not.toHaveBeenCalled()

    await act(async () => { onRoom(snapshot(2)) })
    expect(request).toHaveBeenCalledWith('room', 'access')
    const onParticipants = onSnapshotMock.mock.calls[2][1] as (snapshot: unknown) => void
    act(() => {
      onParticipants({ forEach: (add: (record: unknown) => void) =>
        add({ id: 'p1', data: () => ({ status: 'active', name: '참여자' }) }) })
    })
    expect(container.textContent).toBe('모임')
  })
})
