export const WITHDRAWAL_MANIFEST_SCHEMA_VERSION = 1

export type MeetingStatus = 'active' | 'settled'

export interface FirestoreRecord {
  id: string
  data: Record<string, unknown>
  createTime?: string
  updateTime?: string
}

export interface MeetingSource {
  meeting: FirestoreRecord
  members: FirestoreRecord[]
  expenses: FirestoreRecord[]
  settlement: FirestoreRecord | null
  settlementDocuments: FirestoreRecord[]
  childCollectionIds: string[]
}

export type WithdrawalMeetingAction =
  | 'leave_active_shared'
  | 'anonymize_settled_shared'
  | 'delete_solo_room'
  | 'manual_review'

export type PreviewIssue =
  | 'CREATOR_NOT_MEMBER'
  | 'EXPENSE_DATA_INVALID'
  | 'EXPENSE_OWNER_UNKNOWN'
  | 'EXPENSE_OWNERSHIP_MISMATCH'
  | 'INVALID_MEETING_STATUS'
  | 'MEETING_AGGREGATES_MISMATCH'
  | 'MEMBER_COUNT_MISMATCH'
  | 'MEMBER_DOCUMENTS_MISMATCH'
  | 'PHOTO_REFERENCE_INVALID'
  | 'SETTLEMENT_SNAPSHOT_INVALID'
  | 'SETTLEMENT_SNAPSHOT_MISSING'
  | 'SETTLEMENT_DOCUMENTS_MISMATCH'
  | 'SETTLEMENT_PARTICIPANTS_MISMATCH'
  | 'UNEXPECTED_SETTLEMENT_SNAPSHOT'
  | 'UNKNOWN_CHILD_COLLECTION'

export interface SuccessorCandidate {
  uid: string
  nickname: string
}

export interface WithdrawalMeetingPreview {
  meetingId: string
  name: string
  status: MeetingStatus
  role: 'owner' | 'member'
  memberCount: number
  authoredExpenseCount: number
  action: WithdrawalMeetingAction
  issues: PreviewIssue[]
  successorRequired: boolean
  automaticSuccessorUid: string | null
  successorCandidates: SuccessorCandidate[]
  deletesCloudinaryPhoto: boolean
}

export interface WithdrawalPreviewSummary {
  meetingCount: number
  sharedMeetingCount: number
  soloMeetingCountToDelete: number
  activeExpenseCountToDelete: number
  settledExpenseCountToDelete: number
  settledMeetingCountToAnonymize: number
  ownershipTransferCount: number
  cloudinaryPhotoCountToDelete: number
  manualReviewMeetingCount: number
}

export interface WithdrawalPreview {
  schemaVersion: number
  summary: WithdrawalPreviewSummary
  meetings: WithdrawalMeetingPreview[]
}

export interface WithdrawalPreviewResponse extends WithdrawalPreview {
  manifestId: string
  manifestHash: string
  sourceHash: string
  confirmationNonce: string
  expiresAt: string
}

export interface WithdrawalConfirmBody {
  manifestId: string
  manifestHash: string
  confirmationNonce: string
  successorByMeeting: Record<string, string>
}

export interface WithdrawalWorkflowParams {
  requestId: string
}

export type WithdrawalRequestStatus =
  | 'queued'
  | 'locking'
  | 'processing'
  | 'finalizing'
  | 'complete'
  | 'preview_stale'
  | 'failed'
