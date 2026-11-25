import { expect, it, vi } from 'vitest'
import worker from './index'
import { commitWrites, getFirestoreDocument } from './firestore'

vi.mock('./workflow', () => ({ AccountDeletionWorkflow: class {} }))
vi.mock('./auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./auth')>(),
  readBearerToken: () => 'firebase-token',
  verifyFirebaseIdToken: async () => 'uid',
  createGoogleAccessToken: async () => 'owner',
}))
vi.mock('./firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('./firestore')>(),
  commitWrites: vi.fn(),
  getFirestoreDocument: vi.fn(),
}))

it('승인을 저장한 뒤 이벤트 전송에 실패하면 같은 요청으로 재전송한다', async () => {
  const id = crypto.randomUUID()
  const revision = crypto.randomUUID()
  const record = {
    uid: 'uid', status: 'awaiting_reconfirmation', scopeRevision: revision,
    approvedScopeRevision: null as string | null,
  }
  vi.mocked(getFirestoreDocument).mockImplementation(async (_project, path) => (
    path === 'withdrawalLocks/uid' ? { id: 'uid', data: { requestId: id } }
      : { id, data: { ...record }, updateTime: '2026-11-24T00:00:00Z' }
  ))
  vi.mocked(commitWrites).mockImplementation(async () => { record.approvedScopeRevision = revision })
  const sendEvent = vi.fn().mockRejectedValueOnce(new Error('event unavailable')).mockResolvedValue(undefined)
  const get = vi.fn(async () => ({ sendEvent }))
  const create = vi.fn()
  const env = { ACCOUNT_DELETION_WORKFLOW: { get, create } } as unknown as Env
  const confirm = () => worker.fetch(new Request('http://localhost/withdrawal/confirm', {
    method: 'POST', body: JSON.stringify({ requestId: id, scopeRevision: revision }),
  }), env)
  expect((await confirm()).ok).toBe(false)
  expect(record.approvedScopeRevision).toBe(revision)
  expect((await confirm()).ok).toBe(true)
  expect(commitWrites).toHaveBeenCalledTimes(1)
  expect(sendEvent).toHaveBeenCalledTimes(2)
  expect(sendEvent).toHaveBeenLastCalledWith({ type: `withdrawal-${revision}`, payload: {} })
  expect(get).toHaveBeenLastCalledWith(id)
  expect(create).not.toHaveBeenCalled()
})
