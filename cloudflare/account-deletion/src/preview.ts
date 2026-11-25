import { isCurrentRoom, memberUids, ROOM_COLLECTIONS } from './rooms'
import { stableStringify } from './crypto'
import {
  WITHDRAWAL_MANIFEST_SCHEMA_VERSION,
  type MeetingSource,
  type PreviewIssue,
  type WithdrawalMeetingPreview,
  type WithdrawalPreview,
} from './types'

export async function buildWithdrawalPreview(uid: string, sources: MeetingSource[]): Promise<WithdrawalPreview> {
  const meetings: WithdrawalMeetingPreview[] = sources.map(({ meeting, childCollectionIds }) => {
    const members = memberUids(meeting)
    if (!isCurrentRoom(meeting) || !members.includes(uid)) throw new Error('ROOM_VERSION_NOT_SUPPORTED')
    const solo = members.length === 1
    const issues: PreviewIssue[] = solo && childCollectionIds.some((collection) => !ROOM_COLLECTIONS.includes(collection))
      ? ['UNKNOWN_CHILD_COLLECTION'] : []
    return {
      meetingId: meeting.id,
      name: typeof meeting.data.name === 'string' ? meeting.data.name : '이름 없는 정산방',
      status: meeting.data.status === 'settled' ? 'settled' : 'active',
      role: 'member', memberCount: members.length, authoredExpenseCount: 0,
      action: issues.length ? 'manual_review' : solo ? 'delete_solo_room' : 'preserve_participant_records',
      issues, successorRequired: false, automaticSuccessorUid: null, successorCandidates: [],
      deletesCloudinaryPhoto: false,
    }
  })
  meetings.sort((left, right) => left.meetingId.localeCompare(right.meetingId))
  return {
    schemaVersion: WITHDRAWAL_MANIFEST_SCHEMA_VERSION,
    summary: {
      meetingCount: meetings.length,
      sharedMeetingCount: meetings.filter((meeting) => meeting.memberCount > 1).length,
      soloMeetingCountToDelete: meetings.filter((meeting) => meeting.action === 'delete_solo_room').length,
      activeExpenseCountToDelete: 0,
      settledExpenseCountToDelete: 0,
      settledMeetingCountToAnonymize: 0,
      ownershipTransferCount: 0,
      cloudinaryPhotoCountToDelete: 0,
      manualReviewMeetingCount: meetings.filter((meeting) => meeting.action === 'manual_review').length,
    },
    meetings,
  }
}

export function withdrawalSourceHashInput(sources: MeetingSource[]): string {
  const normalized = [...sources]
    .sort((left, right) => left.meeting.id.localeCompare(right.meeting.id))
    .map((source) => ({
      // 이전 버전의 Workflow가 남긴 잠금 필드는 탈퇴 원본 데이터가 아니다.
      // 같은 내용으로 문서를 다시 만든 경우에도 동일하게 비교할 수 있도록
      // 잠금 필드와 Firestore 메타 시간은 해시에서 제외한다.
      meeting: {
        id: source.meeting.id,
        data: Object.fromEntries(
          Object.entries(source.meeting.data)
            .filter(([key]) => key !== 'withdrawalLockRequestId'),
        ),
      },
      members: [...source.members]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id, data }) => ({ id, data })),
      expenses: [...source.expenses]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id, data }) => ({ id, data })),
      settlement: source.settlement
        ? { id: source.settlement.id, data: source.settlement.data }
        : null,
      settlementDocuments: [...source.settlementDocuments]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id, data }) => ({ id, data })),
      childCollectionIds: [...source.childCollectionIds].sort(),
    }))
  return stableStringify(normalized)
}
