import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginFirestoreTransaction,
  cleanupExpiredWithdrawalMetadata,
  deleteSoloMeeting,
  finalizeWithdrawalMetadata,
  processSharedMemberDeparture,
} from './firestore'
import type { FirestoreRecord, MeetingSource } from './types'

function record(id: string, data: Record<string, unknown>): FirestoreRecord {
  return { id, data, updateTime: `2026-08-20T00:00:0${id.length}.000Z` }
}

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

describe('processSharedMemberDeparture', () => {
  afterEach(() => vi.restoreAllMocks())

  it('비용·멤버·방 집계를 하나의 원자적 Firestore commit으로 처리한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const source: MeetingSource = {
      meeting: record('meeting-1', {
        status: 'active',
        memberUids: ['user-1', 'user-2'],
        memberCount: 2,
        expenseCount: 3,
        totalAmount: 3500,
        withdrawalLockRequestId: 'request-1',
      }),
      members: [
        record('user-1', { nickname: '탈퇴자' }),
        record('user-2', { nickname: '남은 사용자' }),
      ],
      expenses: [
        record('expense-1', { createdBy: 'user-1', paidBy: 'user-1', amount: 1000 }),
        record('expense-2', { createdBy: 'user-1', paidBy: 'user-1', amount: 500 }),
        record('expense-3', { createdBy: 'user-2', paidBy: 'user-2', amount: 2000 }),
      ],
      settlement: null,
      settlementDocuments: [],
      childCollectionIds: ['expenses', 'members'],
    }

    await expect(processSharedMemberDeparture(
      'project-1',
      'access-token',
      'user-1',
      source,
      null,
      null,
    )).resolves.toEqual({ deletedExpenseCount: 2 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toMatch(/\/documents:commit$/u)
    const body = JSON.parse(String(init?.body)) as {
      writes: Array<{
        delete?: string
        update?: { fields?: Record<string, { integerValue?: string }> }
        updateMask?: { fieldPaths: string[] }
      }>
    }
    expect(body.writes).toHaveLength(4)
    expect(body.writes.filter((write) => write.delete).map((write) => write.delete)).toEqual([
      'projects/project-1/databases/(default)/documents/meetings/meeting-1/expenses/expense-1',
      'projects/project-1/databases/(default)/documents/meetings/meeting-1/expenses/expense-2',
      'projects/project-1/databases/(default)/documents/meetings/meeting-1/members/user-1',
    ])
    const meetingWrite = body.writes.find((write) => write.update)
    expect(meetingWrite?.update?.fields).toMatchObject({
      memberCount: { integerValue: '1' },
      expenseCount: { integerValue: '1' },
      totalAmount: { integerValue: '2000' },
    })
    expect(meetingWrite?.updateMask?.fieldPaths).not.toContain('withdrawalLockRequestId')
  })

  it('공유방 방장이 탈퇴하면 선택된 현재 멤버에게 방장을 원자적으로 이전한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const source: MeetingSource = {
      meeting: record('meeting-1', {
        status: 'active',
        createdBy: 'user-1',
        memberUids: ['user-1', 'user-2'],
        memberCount: 2,
        expenseCount: 0,
        totalAmount: 0,
        withdrawalLockRequestId: 'request-1',
      }),
      members: [record('user-1', {}), record('user-2', {})],
      expenses: [],
      settlement: null,
      settlementDocuments: [],
      childCollectionIds: ['members'],
    }

    await processSharedMemberDeparture(
      'project-1', 'access-token', 'user-1', source, null, 'user-2',
    )

    const [, init] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(String(init?.body)) as {
      writes: Array<{ update?: { fields?: Record<string, { stringValue?: string }> } }>
    }
    const meetingWrite = body.writes.find((write) => write.update)
    expect(meetingWrite?.update?.fields?.createdBy).toEqual({ stringValue: 'user-2' })
  })

  it('공유방 방장 이전 대상이 현재 남은 멤버가 아니면 쓰기 전에 중단한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const source: MeetingSource = {
      meeting: record('meeting-1', {
        status: 'active',
        createdBy: 'user-1',
        memberUids: ['user-1', 'user-2'],
        withdrawalLockRequestId: 'request-1',
      }),
      members: [record('user-1', {}), record('user-2', {})],
      expenses: [],
      settlement: null,
      settlementDocuments: [],
      childCollectionIds: ['members'],
    }

    await expect(processSharedMemberDeparture('project-1', 'access-token', 'user-1', source, null, 'outsider')).rejects.toThrow(
      'INVALID_SUCCESSOR',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('단독 방의 모든 하위 문서와 부모 문서를 하나의 commit으로 삭제한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const settlement = record('final', { participantIds: ['user-1'] })
    const source: MeetingSource = {
      meeting: record('solo', {
        status: 'settled',
        createdBy: 'user-1',
        memberUids: ['user-1'],
        withdrawalLockRequestId: 'request-1',
      }),
      members: [record('user-1', {})],
      expenses: [record('expense-1', { createdBy: 'user-1', paidBy: 'user-1', amount: 1000 })],
      settlement,
      settlementDocuments: [settlement],
      childCollectionIds: ['expenses', 'members', 'settlements'],
    }

    await deleteSoloMeeting('project-1', 'access-token', 'user-1', source)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(String(init?.body)) as { writes: Array<{ delete?: string }> }
    expect(body.writes.map((write) => write.delete)).toEqual([
      'projects/project-1/databases/(default)/documents/meetings/solo/expenses/expense-1',
      'projects/project-1/databases/(default)/documents/meetings/solo/members/user-1',
      'projects/project-1/databases/(default)/documents/meetings/solo/settlements/final',
      'projects/project-1/databases/(default)/documents/meetings/solo',
    ])
  })

  it.each([
    {
      name: '다른 멤버가 남아 있는 경우',
      mutate: (source: MeetingSource) => {
        source.meeting.data.memberUids = ['user-1', 'user-2']
        source.members.push(record('user-2', {}))
      },
    },
    {
      name: '다른 사용자의 비용이 섞인 경우',
      mutate: (source: MeetingSource) => {
        source.expenses.push(
          record('foreign-expense', {
            createdBy: 'user-2',
            paidBy: 'user-2',
            amount: 2000,
          }),
        )
      },
    },
    {
      name: '알 수 없는 하위 컬렉션이 있는 경우',
      mutate: (source: MeetingSource) => {
        source.childCollectionIds.push('unknown-data')
      },
    },
  ])('단독 방 삭제는 $name 안전하게 쓰기 전에 거부한다', async ({ mutate }) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const source: MeetingSource = {
      meeting: record('solo', {
        status: 'active',
        createdBy: 'user-1',
        memberUids: ['user-1'],
        withdrawalLockRequestId: 'request-1',
      }),
      members: [record('user-1', {})],
      expenses: [
        record('expense-1', {
          createdBy: 'user-1',
          paidBy: 'user-1',
          amount: 1000,
        }),
      ],
      settlement: null,
      settlementDocuments: [],
      childCollectionIds: ['expenses', 'members'],
    }
    mutate(source)

    await expect(deleteSoloMeeting('project-1', 'access-token', 'user-1', source)).rejects.toThrow('SOLO_MEETING_NOT_SAFE_TO_DELETE')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Firestore 읽기-쓰기 트랜잭션을 시작하고 원자적 commit에 연결한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith(':beginTransaction')) {
        return new Response(JSON.stringify({ transaction: 'transaction-1' }), { status: 200 })
      }
      return new Response(null, { status: 200 })
    })
    const transaction = await beginFirestoreTransaction('project-1', 'access-token')
    const source: MeetingSource = {
      meeting: record('meeting-1', {
        status: 'active',
        memberUids: ['user-1', 'user-2'],
        memberCount: 2,
        expenseCount: 1,
        totalAmount: 1000,
      }),
      members: [record('user-1', {}), record('user-2', {})],
      expenses: [record('expense-1', { createdBy: 'user-1', paidBy: 'user-1', amount: 1000 })],
      settlement: null,
      settlementDocuments: [],
      childCollectionIds: ['expenses', 'members'],
    }

    await processSharedMemberDeparture(
      'project-1', 'access-token', 'user-1', source, null, null, transaction,
    )

    const commitCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith(':commit'))
    const body = JSON.parse(String(commitCall?.[1]?.body)) as { transaction?: string }
    expect(body.transaction).toBe('transaction-1')
  })

  it('완료 요청에서는 상태 토큰 외의 개인정보와 처리 원본을 제거한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))

    await finalizeWithdrawalMetadata(
      'project-1', 'access-token', 'user-1', 'request-1', 'manifest-1',
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
  })
})
