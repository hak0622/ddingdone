import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteSoloMeeting,
  finalizeWithdrawalMetadata,
  processSharedMemberDeparture,
} from './firestore'
import type { FirestoreRecord, MeetingSource } from './types'

function record(id: string, data: Record<string, unknown>): FirestoreRecord {
  return { id, data, updateTime: `2026-08-20T00:00:0${id.length}.000Z` }
}

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
      'request-1',
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
    expect(meetingWrite?.updateMask?.fieldPaths).toContain('withdrawalLockRequestId')
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
      'project-1', 'access-token', 'user-1', 'request-1', source, null, 'user-2',
    )

    const [, init] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(String(init?.body)) as {
      writes: Array<{ update?: { fields?: Record<string, { stringValue?: string }> } }>
    }
    const meetingWrite = body.writes.find((write) => write.update)
    expect(meetingWrite?.update?.fields?.createdBy).toEqual({ stringValue: 'user-2' })
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

    await deleteSoloMeeting('project-1', 'access-token', 'user-1', 'request-1', source)

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
