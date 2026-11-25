import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useMeetingPhoto } from './useMeetingPhoto'
import { useUserStore } from '../store/userStore'

const { fromCache, fromServer } = vi.hoisted(() => ({
  fromCache: vi.fn(),
  fromServer: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDocFromCache: fromCache,
  getDocFromServer: fromServer,
}))
vi.mock('../lib/firebase', () => ({ db: {} }))

function Photo({ allowed }: { allowed: boolean }) {
  const src = useMeetingPhoto('room', 'version', allowed)
  return src ? <img src={src} alt="" /> : null
}

it('동시 사진 요청을 공유하고 멤버십을 잃으면 표시한 사진을 제거한다', async () => {
  fromCache.mockRejectedValue(new Error('cache miss'))
  fromServer.mockResolvedValue({
    data: () => ({ version: 'version', bytes: { toUint8Array: () => new Uint8Array([1, 2, 3]) } }),
  })
  const blobUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const node = document.createElement('div')
  const root = createRoot(node)
  useUserStore.getState().setUser('member', 'member')
  try {
    await act(async () => root.render(<><Photo allowed /><Photo allowed /></>))
    expect(fromServer).toHaveBeenCalledTimes(1)
    expect(node.querySelectorAll('img')).toHaveLength(2)
    await act(async () => root.render(<><Photo allowed={false} /><Photo allowed={false} /></>))
    expect(node.querySelectorAll('img')).toHaveLength(0)
    expect(revoke).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    useUserStore.getState().setUser('', '')
    blobUrl.mockRestore()
    revoke.mockRestore()
  }
})
