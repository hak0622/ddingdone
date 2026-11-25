import { describe, expect, it } from 'vitest'
import { sha256Hex } from './crypto'
import { buildWithdrawalPreview, withdrawalSourceHashInput } from './preview'
import type { MeetingSource } from './types'

const USER = 'user-1'

function source(memberUids: string[], status = 'active', childCollectionIds = ['expenses', 'participants', 'photos']): MeetingSource {
  return {
    meeting: { id: 'meeting-1', data: { participantModelVersion: 2, name: '여행 정산', memberUids, status } },
    members: [], expenses: [], settlement: null, settlementDocuments: [], childCollectionIds,
  }
}

describe('v2 withdrawal preview', () => {
  it('Firestore 메타 시간과 Workflow 잠금 필드는 원본 해시를 바꾸지 않는다', async () => {
    const before = source([USER, 'user-2'])
    const after = { ...before, meeting: {
      ...before.meeting, updateTime: '2026-11-25T00:00:00.000Z',
      data: { ...before.meeting.data, withdrawalLockRequestId: 'request-1' },
    } }
    expect(await sha256Hex(withdrawalSourceHashInput([before])))
      .toBe(await sha256Hex(withdrawalSourceHashInput([after])))
  })

  it.each(['active', 'settled'])('공유방(%s)의 비용과 정산을 보존한다', async (status) => {
    const preview = await buildWithdrawalPreview(USER, [source([USER, 'user-2'], status)])
    expect(preview.meetings[0]).toMatchObject({
      action: 'preserve_participant_records', role: 'member', memberCount: 2,
      deletesCloudinaryPhoto: false, successorCandidates: [],
    })
    expect(preview.summary).toMatchObject({ sharedMeetingCount: 1, ownershipTransferCount: 0, cloudinaryPhotoCountToDelete: 0 })
  })

  it('단독 방은 Firestore 사진을 포함한 전체 삭제 대상으로 분류한다', async () => {
    const preview = await buildWithdrawalPreview(USER, [source([USER])])
    expect(preview.meetings[0]?.action).toBe('delete_solo_room')
    expect(preview.summary.soloMeetingCountToDelete).toBe(1)
  })

  it('알 수 없는 하위 문서가 딸린 단독 방은 삭제하지 않는다', async () => {
    const preview = await buildWithdrawalPreview(USER, [source([USER], 'active', ['unknown'])])
    expect(preview.meetings[0]).toMatchObject({ action: 'manual_review', issues: ['UNKNOWN_CHILD_COLLECTION'] })
  })
})
