import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { useMeeting } from './useMeeting'

const onSnapshotMock = vi.fn(() => () => {})

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ type: 'doc' })),
  collection: vi.fn(() => ({ type: 'collection' })),
  query: vi.fn((ref) => ref),
  orderBy: vi.fn(),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
}))
vi.mock('../lib/firebase', () => ({ db: {} }))

function Probe({ meetingId }: { meetingId: string }) {
  useMeeting(meetingId)
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  onSnapshotMock.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.useRealTimers()
})

describe('useMeeting 구독 공유', () => {
  it('같은 meetingId를 빠르게 mount/unmount/remount해도 onSnapshot은 한 번씩만 호출된다', () => {
    act(() => { root.render(<Probe meetingId="m1" />) })
    // meeting 문서 + members + expenses = 3개 리스너
    expect(onSnapshotMock).toHaveBeenCalledTimes(3)

    act(() => { root.render(<></>) }) // unmount (grace period 시작)
    act(() => { root.render(<Probe meetingId="m1" />) }) // 바로 다시 mount

    // 새로 구독이 생기지 않고 기존 캐시를 그대로 재사용해야 한다
    expect(onSnapshotMock).toHaveBeenCalledTimes(3)
  })

  it('grace period가 지난 뒤 다시 mount하면 새로 구독한다', () => {
    vi.useFakeTimers()
    act(() => { root.render(<Probe meetingId="m2" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(3)

    act(() => { root.render(<></>) })
    act(() => { vi.advanceTimersByTime(31_000) })

    act(() => { root.render(<Probe meetingId="m2" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(6)
  })

  it('다른 meetingId는 각자 독립적으로 구독한다', () => {
    act(() => { root.render(<Probe meetingId="m3" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(3)
    act(() => { root.render(<Probe meetingId="m4" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(6)
  })
})
