import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { clearMeetingsCache, useMeetings } from './useMeetings'

const onSnapshotMock = vi.fn<(...args: unknown[]) => () => void>(() => () => {})

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ type: 'collection' })),
  query: vi.fn((ref) => ref),
  where: vi.fn(),
  orderBy: vi.fn(),
  documentId: vi.fn(),
  limit: vi.fn(),
  limitToLast: vi.fn(),
  endBefore: vi.fn(),
  startAfter: vi.fn(),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
}))
vi.mock('../lib/firebase', () => ({ db: {} }))

const home = { kind: 'home', start: '2026.11.01', end: '2026.12.01' } as const
const history = { kind: 'history', filter: 'all', newest: true, page: null } as const

function Probe({ uid, scope = home }: { uid: string; scope?: Parameters<typeof useMeetings>[1] }) {
  const { meetings, loading, error } = useMeetings(uid, scope)
  return <div>{error ? 'error' : loading ? 'loading' : meetings.map(({ name }) => name).join(',')}</div>
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
  clearMeetingsCache()
  container.remove()
  vi.useRealTimers()
})

describe('useMeetings 구독 공유 (홈 ↔ 내역 탭)', () => {
  it('탭을 빠르게 오가도(unmount→remount) 조회 범위별로 한 번만 구독한다', () => {
    act(() => { root.render(<Probe uid="u1" />) })
    expect(onSnapshotMock).toHaveBeenCalledTimes(1)

    for (let repeat = 0; repeat < 3; repeat++) {
      act(() => { root.render(<Probe uid="u1" scope={history} />) })
      act(() => { root.render(<Probe uid="u1" />) })
    }

    expect(onSnapshotMock).toHaveBeenCalledTimes(2)
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

  it('월과 계정이 바뀌면 늦게 도착한 예전 목록을 무시한다', () => {
    function publish(subscription: number, name: string) {
      const callback = onSnapshotMock.mock.calls[subscription][2] as (snapshot: unknown) => void
      act(() => callback({
        size: 1, metadata: { fromCache: false },
        docs: [{ id: name, data: () => ({ name }), metadata: { hasPendingWrites: false } }],
      }))
    }
    act(() => root.render(<Probe uid="u1" />))
    publish(0, '11월 모임')
    expect(container.textContent).toBe('11월 모임')

    act(() => root.render(<Probe uid="u1" scope={{ ...home, start: '2026.12.01', end: '2027.01.01' }} />))
    publish(0, '늦은 11월 응답')
    expect(container.textContent).toBe('loading')
    publish(1, '12월 모임')
    expect(container.textContent).toBe('12월 모임')

    act(() => root.render(<Probe uid="u2" />))
    publish(1, '이전 계정 응답')
    expect(container.textContent).toBe('loading')
    const fail = onSnapshotMock.mock.calls[2][3] as () => void
    act(() => fail())
    expect(container.textContent).toBe('error')
  })
})
