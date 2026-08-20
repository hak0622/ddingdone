import { describe, expect, it } from 'vitest'
import { sha256Hex, stableStringify } from './crypto'
import { buildWithdrawalPreview, withdrawalSourceHashInput } from './preview'
import type { FirestoreRecord, MeetingSource } from './types'

const USER_UID = 'user-1'

function record(id: string, data: Record<string, unknown>): FirestoreRecord {
  return { id, data, updateTime: '2026-08-20T00:00:00.000Z' }
}

function source(overrides: Partial<MeetingSource> = {}): MeetingSource {
  return {
    meeting: record('meeting-1', {
      name: '여행 정산',
      status: 'active',
      createdBy: 'owner-1',
      memberCount: 2,
      memberUids: [USER_UID, 'owner-1'],
      totalAmount: 3000,
      expenseCount: 2,
      photoPublicId: null,
    }),
    members: [
      record(USER_UID, { nickname: '사용자' }),
      record('owner-1', { nickname: '방장' }),
    ],
    expenses: [
      record('expense-1', { paidBy: USER_UID, amount: 1000 }),
      record('expense-2', { paidBy: 'owner-1', createdBy: 'owner-1', amount: 2000 }),
    ],
    settlement: null,
    settlementDocuments: [],
    childCollectionIds: ['expenses', 'members'],
    ...overrides,
  }
}

describe('buildWithdrawalPreview', () => {
  it('Workflow 잠금 필드와 Firestore 메타 시간은 원본 해시를 바꾸지 않는다', async () => {
    const before = source()
    const after = source({
      meeting: {
        ...before.meeting,
        updateTime: '2026-08-20T00:01:00.000Z',
        data: { ...before.meeting.data, withdrawalLockRequestId: 'request-1' },
      },
    })

    expect(await sha256Hex(withdrawalSourceHashInput([before])))
      .toBe(await sha256Hex(withdrawalSourceHashInput([after])))
  })

  it('활동 중 공유방에서 탈퇴자가 작성한 비용만 집계한다', async () => {
    const preview = await buildWithdrawalPreview(USER_UID, [source()])

    expect(preview.summary).toMatchObject({
      meetingCount: 1,
      sharedMeetingCount: 1,
      activeExpenseCountToDelete: 1,
      manualReviewMeetingCount: 0,
    })
    expect(preview.meetings[0]).toMatchObject({
      action: 'leave_active_shared',
      role: 'member',
      authoredExpenseCount: 1,
    })
  })

  it('남은 멤버가 여러 명인 방장은 후임 선택 대상으로 분류한다', async () => {
    const meeting = record('meeting-2', {
      name: '회식',
      status: 'active',
      createdBy: USER_UID,
      memberCount: 3,
      memberUids: [USER_UID, 'member-1', 'member-2'],
      totalAmount: 0,
      expenseCount: 0,
    })
    const members = [
      record(USER_UID, { nickname: '방장' }),
      record('member-1', { nickname: '첫째' }),
      record('member-2', { nickname: '둘째' }),
    ]
    const preview = await buildWithdrawalPreview(USER_UID, [source({ meeting, members, expenses: [] })])

    expect(preview.summary.ownershipTransferCount).toBe(1)
    expect(preview.meetings[0]).toMatchObject({
      role: 'owner',
      successorRequired: true,
      automaticSuccessorUid: null,
    })
    expect(preview.meetings[0]?.successorCandidates.map((candidate) => candidate.uid))
      .toEqual(['member-1', 'member-2'])
  })

  it('검증을 모두 통과한 단독 방만 전체 삭제 대상으로 분류한다', async () => {
    const meeting = record('solo', {
      name: '개인 정산',
      status: 'active',
      createdBy: USER_UID,
      memberCount: 1,
      memberUids: [USER_UID],
      totalAmount: 1000,
      expenseCount: 1,
      photoPublicId: 'ddingdone/solo/photo',
    })
    const preview = await buildWithdrawalPreview(USER_UID, [source({
      meeting,
      members: [record(USER_UID, { nickname: '사용자' })],
      expenses: [record('expense', { paidBy: USER_UID, createdBy: USER_UID, amount: 1000 })],
    })])

    expect(preview.meetings[0]).toMatchObject({
      action: 'delete_solo_room',
      deletesCloudinaryPhoto: true,
    })
    expect(preview.summary.soloMeetingCountToDelete).toBe(1)
    expect(preview.summary.cloudinaryPhotoCountToDelete).toBe(1)
  })

  it('정산 스냅샷이 없는 정산 완료 방은 수동 검토로 중단한다', async () => {
    const settled = source({
      meeting: record('settled', {
        name: '완료된 정산',
        status: 'settled',
        createdBy: 'owner-1',
        memberCount: 2,
        memberUids: [USER_UID, 'owner-1'],
        totalAmount: 3000,
        expenseCount: 2,
      }),
    })
    const preview = await buildWithdrawalPreview(USER_UID, [settled])

    expect(preview.meetings[0]).toMatchObject({ action: 'manual_review' })
    expect(preview.meetings[0]?.issues).toContain('SETTLEMENT_SNAPSHOT_MISSING')
    expect(preview.summary.settledExpenseCountToDelete).toBe(0)
  })

  it('정산 완료 방은 원본으로 재계산한 스냅샷과 해시가 모두 일치해야 통과한다', async () => {
    const core = {
      schemaVersion: 1,
      totalAmount: 3000,
      participantCount: 2,
      participantIds: [USER_UID, 'owner-1'],
      participantNames: { [USER_UID]: '사용자', 'owner-1': '방장' },
      participantPaidTotals: { [USER_UID]: 1000, 'owner-1': 2000 },
      transfers: [{ from: USER_UID, to: 'owner-1', amount: 500 }],
    }
    const finalSettlement = record('final', {
      ...core,
      hash: await sha256Hex(stableStringify(core)),
    })
    const settled = source({
      meeting: record('settled-valid', {
        name: '완료된 정산',
        status: 'settled',
        createdBy: 'owner-1',
        memberCount: 2,
        memberUids: [USER_UID, 'owner-1'],
        totalAmount: 3000,
        expenseCount: 2,
      }),
      settlement: finalSettlement,
      settlementDocuments: [finalSettlement],
      childCollectionIds: ['expenses', 'members', 'settlements'],
    })

    const valid = await buildWithdrawalPreview(USER_UID, [settled])
    expect(valid.meetings[0]).toMatchObject({ action: 'anonymize_settled_shared', issues: [] })

    const tamperedSettlement = record('final', { ...settled.settlement?.data, hash: '0'.repeat(64) })
    const tampered = await buildWithdrawalPreview(USER_UID, [{
      ...settled,
      settlement: tamperedSettlement,
      settlementDocuments: [tamperedSettlement],
    }])
    expect(tampered.meetings[0]).toMatchObject({ action: 'manual_review' })
    expect(tampered.meetings[0]?.issues).toContain('SETTLEMENT_SNAPSHOT_INVALID')
  })

  it('알 수 없는 하위 컬렉션이 있는 단독 방은 전체 삭제하지 않는다', async () => {
    const meeting = record('solo-unsafe', {
      name: '검토 필요',
      status: 'active',
      createdBy: USER_UID,
      memberCount: 1,
      memberUids: [USER_UID],
      totalAmount: 0,
      expenseCount: 0,
    })
    const preview = await buildWithdrawalPreview(USER_UID, [source({
      meeting,
      members: [record(USER_UID, { nickname: '사용자' })],
      expenses: [],
      childCollectionIds: ['members', 'unknown-data'],
    })])

    expect(preview.meetings[0]).toMatchObject({ action: 'manual_review' })
    expect(preview.meetings[0]?.issues).toContain('UNKNOWN_CHILD_COLLECTION')
  })

  it('final 외의 정산 문서가 있으면 숨은 데이터를 남기지 않도록 자동 삭제를 중단한다', async () => {
    const meeting = record('solo-hidden-settlement', {
      name: '검토 필요',
      status: 'active',
      createdBy: USER_UID,
      memberCount: 1,
      memberUids: [USER_UID],
      totalAmount: 0,
      expenseCount: 0,
    })
    const result = await buildWithdrawalPreview(USER_UID, [source({
      meeting,
      members: [record(USER_UID, { nickname: '사용자' })],
      expenses: [],
      settlementDocuments: [record('legacy', { value: 'unknown' })],
      childCollectionIds: ['members', 'settlements'],
    })])

    expect(result.meetings[0]).toMatchObject({ action: 'manual_review' })
    expect(result.meetings[0]?.issues).toContain('SETTLEMENT_DOCUMENTS_MISMATCH')
  })

  it('이전 탈퇴자가 익명화된 정산방도 현재 사용자 원본만 다시 검증한다', async () => {
    const core = {
      schemaVersion: 1,
      totalAmount: 3500,
      participantCount: 3,
      participantIds: [USER_UID, 'withdrawn_abcdef1234567890abcdef12', 'owner-1'],
      participantNames: {
        [USER_UID]: '사용자',
        withdrawn_abcdef1234567890abcdef12: '탈퇴한 사용자',
        'owner-1': '방장',
      },
      participantPaidTotals: {
        [USER_UID]: 1000,
        withdrawn_abcdef1234567890abcdef12: 500,
        'owner-1': 2000,
      },
      transfers: [{ from: 'withdrawn_abcdef1234567890abcdef12', to: 'owner-1', amount: 500 }],
    }
    const finalSettlement = record('final', {
      ...core,
      hash: await sha256Hex(stableStringify(core)),
      anonymizedParticipantCount: 1,
    })
    const settled = source({
      meeting: record('settled-anonymized', {
        name: '익명 참여자가 있는 정산',
        status: 'settled',
        createdBy: 'owner-1',
        memberCount: 2,
        memberUids: [USER_UID, 'owner-1'],
        totalAmount: 3500,
        expenseCount: 2,
      }),
      settlement: finalSettlement,
      settlementDocuments: [finalSettlement],
      childCollectionIds: ['expenses', 'members', 'settlements'],
    })

    const result = await buildWithdrawalPreview(USER_UID, [settled])
    expect(result.meetings[0]).toMatchObject({
      action: 'anonymize_settled_shared',
      issues: [],
    })
  })
})
