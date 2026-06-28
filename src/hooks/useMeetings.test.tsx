import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { useMeetings } from './useMeetings'

const onSnapshotMock = vi.fn(() => () => {})

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ type: 'collection' })),
  query: vi.fn((ref) => ref),
  where: vi.fn(),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
}))
vi.mock('../lib/firebase', () => ({ db: {} }))

function Probe({ uid }: { uid: string }) {
  useMeetings(uid)
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

describe('useMeetings 구독 공유 (홈 ↔ 내역 탭)', () => {
  it('탭을 빠르게 오가도(unmount→remount) 같은 uid는 한 번만 구독한다', () => {
    act(() => { root.render(<Probe uid="u1" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(1)

    act(() => { root.render(<></>) })
    act(() => { root.render(<Probe uid="u1" />) })

    expect(onSnapshotMock).toHaveBeenCalledTimes(1)
  })

  it('grace period가 지난 뒤에는 다시 구독한다', () => {
    vi.useFakeTimers()
    act(() => { root.render(<Probe uid="u2" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(1)

    act(() => { root.render(<></>) })
    act(() => { vi.advanceTimersByTime(31_000) })
    act(() => { root.render(<Probe uid="u2" />) })

    expect(onSnapshotMock).toHaveBeenCalledTimes(2)
  })
})
