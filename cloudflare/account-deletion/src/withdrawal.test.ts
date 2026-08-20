import { describe, expect, it } from 'vitest'
import { sha256Hex } from './crypto'
import type { FirestoreRecord, WithdrawalPreview } from './types'
import {
  parseWithdrawalConfirmBody,
  resolveSuccessorByMeeting,
  validateManifestForConfirmation,
  WithdrawalValidationError,
} from './withdrawal'

const UID = 'user-1'
const NONCE = 'a'.repeat(43)

function preview(overrides: Partial<WithdrawalPreview> = {}): WithdrawalPreview {
  return {
    schemaVersion: 1,
    summary: {
      meetingCount: 1,
      sharedMeetingCount: 1,
      soloMeetingCountToDelete: 0,
      activeExpenseCountToDelete: 1,
      settledExpenseCountToDelete: 0,
      settledMeetingCountToAnonymize: 0,
      ownershipTransferCount: 0,
      cloudinaryPhotoCountToDelete: 0,
      manualReviewMeetingCount: 0,
    },
    meetings: [{
      meetingId: 'meeting-1',
      name: '공유방',
      status: 'active',
      role: 'member',
      memberCount: 2,
      authoredExpenseCount: 1,
      action: 'leave_active_shared',
      issues: [],
      successorRequired: false,
      automaticSuccessorUid: null,
      successorCandidates: [],
      deletesCloudinaryPhoto: false,
    }],
    ...overrides,
  }
}

async function manifest(previewValue = preview()): Promise<FirestoreRecord> {
  return {
    id: await sha256Hex(`withdrawal-manifest:${UID}`),
    updateTime: '2026-08-20T00:00:00.000Z',
    data: {
      uid: UID,
      status: 'previewed',
      manifestHash: 'b'.repeat(64),
      confirmationNonceHash: await sha256Hex(NONCE),
      expiresAt: '2026-08-20T01:00:00.000Z',
      preview: previewValue,
    },
  }
}

describe('withdrawal confirmation validation', () => {
  it('정확한 manifest와 nonce로 일반 멤버 탈퇴만 승인한다', async () => {
    const stored = await manifest()
    const result = await validateManifestForConfirmation(UID, stored, {
      manifestId: stored.id,
      manifestHash: 'b'.repeat(64),
      confirmationNonce: NONCE,
      successorByMeeting: {},
    }, Date.parse('2026-08-20T00:30:00.000Z'))

    expect(result.meetings[0]?.action).toBe('leave_active_shared')
  })

  it('nonce가 다르면 확인 요청을 거부한다', async () => {
    const stored = await manifest()
    await expect(validateManifestForConfirmation(UID, stored, {
      manifestId: stored.id,
      manifestHash: 'b'.repeat(64),
      confirmationNonce: 'c'.repeat(43),
      successorByMeeting: {},
    }, Date.parse('2026-08-20T00:30:00.000Z'))).rejects.toMatchObject({
      code: 'MANIFEST_INVALID_OR_EXPIRED',
    })
  })

  it('후임이 한 명이면 자동으로 방장을 이전한다', async () => {
    const ownerPreview = preview({
      meetings: [{
        ...preview().meetings[0]!,
        role: 'owner',
        successorRequired: false,
        automaticSuccessorUid: 'member-2',
        successorCandidates: [{ uid: 'member-2', nickname: '후임' }],
      }],
      summary: { ...preview().summary, ownershipTransferCount: 1 },
    })
    const stored = await manifest(ownerPreview)
    await expect(validateManifestForConfirmation(UID, stored, {
      manifestId: stored.id,
      manifestHash: 'b'.repeat(64),
      confirmationNonce: NONCE,
      successorByMeeting: {},
    }, Date.parse('2026-08-20T00:30:00.000Z'))).resolves.toEqual(ownerPreview)
    expect(resolveSuccessorByMeeting(ownerPreview, {})).toEqual({ 'meeting-1': 'member-2' })
  })

  it('후임 후보가 여러 명이면 후보 중 한 명을 명시해야 한다', () => {
    const ownerPreview = preview({
      meetings: [{
        ...preview().meetings[0]!,
        role: 'owner',
        successorRequired: true,
        automaticSuccessorUid: null,
        successorCandidates: [
          { uid: 'member-2', nickname: '둘째' },
          { uid: 'member-3', nickname: '셋째' },
        ],
      }],
    })
    expect(() => resolveSuccessorByMeeting(ownerPreview, {})).toThrowError(WithdrawalValidationError)
    expect(resolveSuccessorByMeeting(ownerPreview, { 'meeting-1': 'member-3' }))
      .toEqual({ 'meeting-1': 'member-3' })
  })

  it('검증된 단독 방은 후임 없이 전체 삭제를 승인한다', async () => {
    const soloPreview = preview({
      meetings: [{
        ...preview().meetings[0]!,
        meetingId: 'solo',
        role: 'owner',
        memberCount: 1,
        action: 'delete_solo_room',
        authoredExpenseCount: 1,
        successorCandidates: [],
        deletesCloudinaryPhoto: true,
      }],
      summary: {
        ...preview().summary,
        sharedMeetingCount: 0,
        soloMeetingCountToDelete: 1,
        cloudinaryPhotoCountToDelete: 1,
      },
    })
    const stored = await manifest(soloPreview)

    await expect(validateManifestForConfirmation(UID, stored, {
      manifestId: stored.id,
      manifestHash: 'b'.repeat(64),
      confirmationNonce: NONCE,
      successorByMeeting: {},
    }, Date.parse('2026-08-20T00:30:00.000Z'))).resolves.toEqual(soloPreview)
  })

  it('확인 요청에 정의되지 않은 필드가 있으면 거부한다', () => {
    expect(() => parseWithdrawalConfirmBody({
      manifestId: 'a'.repeat(64),
      manifestHash: 'b'.repeat(64),
      confirmationNonce: NONCE,
      successorByMeeting: {},
      uid: UID,
    })).toThrowError(WithdrawalValidationError)
  })
})
