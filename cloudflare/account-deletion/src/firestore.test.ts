import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginFirestoreTransaction,
  commitWrites,
  listMeetingIdsForUser,
  updateWrite,
  cleanupExpiredWithdrawalMetadata,
  finalizeWithdrawalMetadata,
} from './firestore'

describe('cleanupExpiredWithdrawalMetadata', () => {
  afterEach(() => vi.restoreAllMocks())

  it('만료된 미확정 manifest와 익명화된 완료 요청만 삭제한다', async () => {
    const expiredAt = '2026-08-20T00:00:00.000Z'
    const document = (
      collectionId: string,
      id: string,
      fields: Record<string, unknown>,
    ) => ({
      document: {
        name: `projects/project-1/databases/(default)/documents/${collectionId}/${id}`,
        updateTime: `2026-08-20T01:00:0${id.length}.000Z`,
        fields,
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as {
        structuredQuery?: { from?: Array<{ collectionId?: string }> }
      } : null
      const collectionId = body?.structuredQuery?.from?.[0]?.collectionId
      if (url.endsWith(':runQuery') && collectionId === 'withdrawalManifests') {
        return new Response(JSON.stringify([
          document('withdrawalManifests', 'safe-manifest', {
            status: { stringValue: 'previewed' },
            expiresAt: { timestampValue: expiredAt },
          }),
          document('withdrawalManifests', 'queued-manifest', {
            status: { stringValue: 'queued' },
            expiresAt: { timestampValue: expiredAt },
          }),
        ]), { status: 200 })
      }
      if (url.endsWith(':runQuery') && collectionId === 'withdrawalRequests') {
        return new Response(JSON.stringify([
          document('withdrawalRequests', 'safe-request', {
            status: { stringValue: 'complete' },
            stage: { stringValue: 'complete' },
            expiresAt: { timestampValue: expiredAt },
          }),
          document('withdrawalRequests', 'unsafe-complete-request', {
            status: { stringValue: 'complete' },
            stage: { stringValue: 'complete' },
            uid: { stringValue: 'user-1' },
            expiresAt: { timestampValue: expiredAt },
          }),
          document('withdrawalRequests', 'failed-request', {
            status: { stringValue: 'failed' },
            stage: { stringValue: 'manual-recovery-required' },
            expiresAt: { timestampValue: expiredAt },
          }),
        ]), { status: 200 })
      }
      return new Response(null, { status: 200 })
    })

    await expect(cleanupExpiredWithdrawalMetadata(
      'project-1',
      'access-token',
      new Date('2026-08-21T00:00:00.000Z'),
    )).resolves.toEqual({
      scannedManifestCount: 2,
      scannedRequestCount: 3,
      deletedManifestCount: 1,
      deletedRequestCount: 1,
      skippedManifestCount: 1,
      skippedRequestCount: 2,
    })

    const deletedPaths = fetchMock.mock.calls.flatMap(([, init]) => {
      if (!init?.body) return []
      const body = JSON.parse(String(init.body)) as { writes?: Array<{ delete?: string }> }
      return (body.writes ?? []).flatMap((write) => write.delete ? [write.delete] : [])
    })
    expect(deletedPaths).toEqual([
      'projects/project-1/databases/(default)/documents/withdrawalManifests/safe-manifest',
      'projects/project-1/databases/(default)/documents/withdrawalRequests/safe-request',
    ])
    expect(deletedPaths.some((path) => path.includes('withdrawalLocks'))).toBe(false)
  })
})

describe('Firestore retirement and withdrawal', () => {
  afterEach(() => vi.restoreAllMocks())

  it('v2 탈퇴 범위는 활성 모임만 조회하고 과거 링크 조회가 필요 없다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'))
    await expect(listMeetingIdsForUser('project-1', 'user-1', 'access-token')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
    const query = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).structuredQuery
    expect(query.from).toEqual([{ collectionId: 'meetings' }])
    expect(query.where.fieldFilter.field.fieldPath).toBe('memberUids')
  })

  it('Firestore 읽기-쓰기 트랜잭션을 시작하고 원자적 commit에 연결한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith(':beginTransaction')
        ? new Response(JSON.stringify({ transaction: 'transaction-1' }))
        : new Response(null, { status: 200 }))
    const transaction = await beginFirestoreTransaction('project-1', 'access-token')
    await commitWrites('project-1', 'access-token', [
      updateWrite('project-1', 'meetings/example', { totalAmount: 1000 }, ['totalAmount']),
    ], 'COMMIT_FAILED', transaction)
    const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith(':commit'))
    expect(JSON.parse(String(call?.[1]?.body)).transaction).toBe('transaction-1')
  })

  it('완료 요청에서는 상태 토큰 외의 개인정보와 처리 원본을 제거한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))

    await finalizeWithdrawalMetadata(
      'project-1',
      'access-token',
      'user-1',
      'request-1',
      'manifest-1',
    )

    const [, init] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(String(init?.body)) as {
      writes: Array<{ updateMask?: { fieldPaths: string[] } }>
    }
    const fieldPaths = body.writes[0]?.updateMask?.fieldPaths ?? []
    expect(fieldPaths).toEqual(expect.arrayContaining([
      'uid',
      'manifestId',
      'manifestHash',
      'sourceHash',
      'preview',
      'successorByMeeting',
    ]))
    expect(fieldPaths).not.toContain('statusTokenHash')
    const deletedPaths = body.writes.flatMap((write) => {
      const path = (write as { delete?: string }).delete
      return path ? [path] : []
    })
    expect(deletedPaths).toEqual([
      'projects/project-1/databases/(default)/documents/withdrawalManifests/manifest-1',
      'projects/project-1/databases/(default)/documents/withdrawalLocks/user-1',
    ])
  })
})
