import { sha256Hex } from './crypto'
import type {
  FirestoreRecord,
  PreviewIssue,
  WithdrawalConfirmBody,
  WithdrawalMeetingPreview,
  WithdrawalMeetingAction,
  WithdrawalPreview,
} from './types'

const ACTIONS = new Set([
  'leave_active_shared',
  'anonymize_settled_shared',
  'delete_solo_room',
  'manual_review',
] as const)
const PREVIEW_ISSUES = new Set<PreviewIssue>([
  'CREATOR_NOT_MEMBER',
  'EXPENSE_DATA_INVALID',
  'EXPENSE_OWNER_UNKNOWN',
  'EXPENSE_OWNERSHIP_MISMATCH',
  'INVALID_MEETING_STATUS',
  'MEETING_AGGREGATES_MISMATCH',
  'MEMBER_COUNT_MISMATCH',
  'MEMBER_DOCUMENTS_MISMATCH',
  'PHOTO_REFERENCE_INVALID',
  'SETTLEMENT_SNAPSHOT_INVALID',
  'SETTLEMENT_SNAPSHOT_MISSING',
  'SETTLEMENT_PARTICIPANTS_MISMATCH',
  'UNEXPECTED_SETTLEMENT_SNAPSHOT',
  'UNKNOWN_CHILD_COLLECTION',
])

function isWithdrawalAction(value: unknown): value is WithdrawalMeetingAction {
  return typeof value === 'string' && ACTIONS.has(value as WithdrawalMeetingAction)
}

export class WithdrawalValidationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'WithdrawalValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value)
}

export function parseWithdrawalConfirmBody(value: unknown): WithdrawalConfirmBody {
  if (!isRecord(value)) throw new WithdrawalValidationError('INVALID_REQUEST')
  const keys = Object.keys(value).sort()
  const expectedKeys = [
    'confirmationNonce',
    'manifestHash',
    'manifestId',
    'successorByMeeting',
  ]
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new WithdrawalValidationError('INVALID_REQUEST')
  }
  if (
    typeof value.manifestId !== 'string' || !/^[0-9a-f]{64}$/u.test(value.manifestId) ||
    typeof value.manifestHash !== 'string' || !/^[0-9a-f]{64}$/u.test(value.manifestHash) ||
    typeof value.confirmationNonce !== 'string' || value.confirmationNonce.length < 32 ||
    value.confirmationNonce.length > 128 || !isRecord(value.successorByMeeting)
  ) throw new WithdrawalValidationError('INVALID_REQUEST')

  const successorByMeeting: Record<string, string> = {}
  for (const [meetingId, successorUid] of Object.entries(value.successorByMeeting)) {
    if (!isId(meetingId) || !isId(successorUid)) {
      throw new WithdrawalValidationError('INVALID_SUCCESSOR')
    }
    successorByMeeting[meetingId] = successorUid
  }
  return {
    manifestId: value.manifestId,
    manifestHash: value.manifestHash,
    confirmationNonce: value.confirmationNonce,
    successorByMeeting,
  }
}

function hexBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/u.test(value) || value.length % 2 !== 0) return null
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    if (!Number.isFinite(byte)) return null
    bytes[index] = byte
  }
  return bytes
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBytes = hexBytes(left)
  const rightBytes = hexBytes(right)
  if (!leftBytes || !rightBytes || leftBytes.length !== rightBytes.length) return false
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(leftBytes, rightBytes)
  }
  // Node 기반 단위 테스트처럼 timingSafeEqual 확장이 없는 Web Crypto 구현용
  // 폴백이다. 길이는 위에서 고정하고 모든 바이트를 끝까지 비교한다.
  let difference = 0
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}

export async function verifyHashedToken(rawToken: string, storedHash: unknown): Promise<boolean> {
  return typeof storedHash === 'string' && timingSafeHexEqual(
    await sha256Hex(rawToken),
    storedHash,
  )
}

function parseMeetingPreview(value: unknown): WithdrawalMeetingPreview | null {
  if (!isRecord(value) || !isId(value.meetingId)) return null
  if (
    typeof value.name !== 'string' ||
    (value.status !== 'active' && value.status !== 'settled') ||
    (value.role !== 'owner' && value.role !== 'member') ||
    typeof value.memberCount !== 'number' || !Number.isInteger(value.memberCount) ||
    typeof value.authoredExpenseCount !== 'number' || !Number.isInteger(value.authoredExpenseCount) ||
    !isWithdrawalAction(value.action) ||
    !Array.isArray(value.issues) || !value.issues.every(
      (issue): issue is PreviewIssue => typeof issue === 'string' && PREVIEW_ISSUES.has(issue as PreviewIssue),
    ) ||
    typeof value.successorRequired !== 'boolean' ||
    typeof value.deletesCloudinaryPhoto !== 'boolean' ||
    !Array.isArray(value.successorCandidates) ||
    !value.successorCandidates.every((candidate) =>
      isRecord(candidate) && isId(candidate.uid) && typeof candidate.nickname === 'string') ||
    !(value.automaticSuccessorUid === null || isId(value.automaticSuccessorUid))
  ) return null
  return {
    meetingId: value.meetingId,
    name: value.name,
    status: value.status,
    role: value.role,
    memberCount: value.memberCount,
    authoredExpenseCount: value.authoredExpenseCount,
    action: value.action,
    issues: value.issues,
    successorRequired: value.successorRequired,
    automaticSuccessorUid: value.automaticSuccessorUid,
    successorCandidates: value.successorCandidates.map((candidate) => ({
      uid: candidate.uid as string,
      nickname: candidate.nickname as string,
    })),
    deletesCloudinaryPhoto: value.deletesCloudinaryPhoto,
  }
}

export function previewFromManifest(manifest: FirestoreRecord): WithdrawalPreview {
  const value = manifest.data.preview
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.summary) || !Array.isArray(value.meetings)) {
    throw new WithdrawalValidationError('INVALID_MANIFEST')
  }
  const meetings = value.meetings.map(parseMeetingPreview)
  if (meetings.some((meeting) => !meeting)) throw new WithdrawalValidationError('INVALID_MANIFEST')
  const summaryKeys: Array<keyof WithdrawalPreview['summary']> = [
    'meetingCount',
    'sharedMeetingCount',
    'soloMeetingCountToDelete',
    'activeExpenseCountToDelete',
    'settledExpenseCountToDelete',
    'settledMeetingCountToAnonymize',
    'ownershipTransferCount',
    'cloudinaryPhotoCountToDelete',
    'manualReviewMeetingCount',
  ]
  const summary: Partial<WithdrawalPreview['summary']> = {}
  for (const key of summaryKeys) {
    const count = value.summary[key]
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new WithdrawalValidationError('INVALID_MANIFEST')
    }
    summary[key] = count
  }
  return {
    schemaVersion: 1,
    summary: summary as WithdrawalPreview['summary'],
    meetings: meetings.filter((meeting): meeting is WithdrawalMeetingPreview => meeting !== null),
  }
}

export async function validateManifestForConfirmation(
  uid: string,
  manifest: FirestoreRecord | null,
  body: WithdrawalConfirmBody,
  now = Date.now(),
): Promise<WithdrawalPreview> {
  if (!manifest || manifest.id !== body.manifestId) {
    throw new WithdrawalValidationError('MANIFEST_NOT_FOUND')
  }
  const expectedManifestId = await sha256Hex(`withdrawal-manifest:${uid}`)
  const storedUid = manifest.data.uid
  const storedHash = manifest.data.manifestHash
  const nonceHash = manifest.data.confirmationNonceHash
  const expiresAt = manifest.data.expiresAt
  if (
    manifest.id !== expectedManifestId || storedUid !== uid || manifest.data.status !== 'previewed' ||
    typeof storedHash !== 'string' || !timingSafeHexEqual(storedHash, body.manifestHash) ||
    typeof nonceHash !== 'string' ||
    !timingSafeHexEqual(nonceHash, await sha256Hex(body.confirmationNonce)) ||
    typeof expiresAt !== 'string' || Date.parse(expiresAt) <= now
  ) throw new WithdrawalValidationError('MANIFEST_INVALID_OR_EXPIRED')

  const preview = previewFromManifest(manifest)
  if (preview.meetings.some((meeting) => meeting.action === 'manual_review')) {
    throw new WithdrawalValidationError('MANUAL_REVIEW_REQUIRED')
  }
  // 방장 이전·단독 방 전체 삭제·Cloudinary 삭제는 다음 단계에서 연결한다.
  if (preview.meetings.some((meeting) =>
    meeting.action === 'delete_solo_room' ||
    (meeting.role === 'owner' && meeting.memberCount > 1))) {
    throw new WithdrawalValidationError('SPECIAL_HANDLING_NOT_READY')
  }
  if (Object.keys(body.successorByMeeting).length > 0) {
    throw new WithdrawalValidationError('INVALID_SUCCESSOR')
  }
  return preview
}
