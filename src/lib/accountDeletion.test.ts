import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AccountDeletionError,
  confirmWithdrawal,
  createWithdrawalPreview,
  getWithdrawalStatus,
  type WithdrawalPreview,
} from './accountDeletion'

vi.mock('./firebase', () => ({
  getIdToken: vi.fn(async () => 'firebase-token'),
}))

const preview: WithdrawalPreview = {
  schemaVersion: 1,
  summary: {
    meetingCount: 1,
    sharedMeetingCount: 1,
    soloMeetingCountToDelete: 0,
    activeExpenseCountToDelete: 2,
    settledExpenseCountToDelete: 0,
    settledMeetingCountToAnonymize: 0,
    ownershipTransferCount: 1,
    cloudinaryPhotoCountToDelete: 0,
    manualReviewMeetingCount: 0,
  },
  meetings: [],
  manifestId: 'a'.repeat(64),
  manifestHash: 'b'.repeat(64),
  sourceHash: 'c'.repeat(64),
  confirmationNonce: 'nonce'.repeat(8),
  expiresAt: '2026-08-20T07:00:00.000Z',
}

describe('account deletion API', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_WORKER_URL', 'https://worker.example/')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('Firebase 토큰으로 탈퇴 미리보기를 요청한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(preview), { status: 200 }),
    )

    await expect(createWithdrawalPreview()).resolves.toEqual(preview)
    expect(fetchMock).toHaveBeenCalledWith('https://worker.example/withdrawal/preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer firebase-token' },
    })
  })

  it('확정할 때 manifest와 방장 선택을 그대로 전달한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'request-1', statusToken: 'status-token', status: 'queued' }), { status: 202 }),
    )

    await confirmWithdrawal(preview, { meeting1: 'successor1' })
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      manifestId: preview.manifestId,
      manifestHash: preview.manifestHash,
      confirmationNonce: preview.confirmationNonce,
      successorByMeeting: { meeting1: 'successor1' },
    })
  })

  it('계정 삭제 뒤에는 상태 토큰만으로 진행 상태를 조회한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'request-1', status: 'complete' }), { status: 200 }),
    )

    await getWithdrawalStatus('request-1', 'status-token')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://worker.example/withdrawal/status/request-1',
      { headers: { 'X-Withdrawal-Status-Token': 'status-token' } },
    )
  })

  it('Worker 오류 코드를 보존한다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'MANUAL_REVIEW_REQUIRED' } }), { status: 409 }),
    )

    await expect(createWithdrawalPreview()).rejects.toEqual(
      new AccountDeletionError('MANUAL_REVIEW_REQUIRED', 409),
    )
  })
})
