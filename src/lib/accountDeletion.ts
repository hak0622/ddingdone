import { getIdToken } from './firebase'

export type WithdrawalMeetingAction =
  | 'leave_active_shared'
  | 'anonymize_settled_shared'
  | 'delete_solo_room'
  | 'manual_review'

export interface SuccessorCandidate {
  uid: string
  nickname: string
}

export interface WithdrawalMeetingPreview {
  meetingId: string
  name: string
  status: 'active' | 'settled'
  role: 'owner' | 'member'
  memberCount: number
  authoredExpenseCount: number
  action: WithdrawalMeetingAction
  issues: string[]
  successorRequired: boolean
  automaticSuccessorUid: string | null
  successorCandidates: SuccessorCandidate[]
  deletesCloudinaryPhoto: boolean
}

export interface WithdrawalPreview {
  schemaVersion: number
  summary: {
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
  meetings: WithdrawalMeetingPreview[]
  manifestId: string
  manifestHash: string
  sourceHash: string
  confirmationNonce: string
  expiresAt: string
}

export type WithdrawalStatusName =
  | 'queued'
  | 'locking'
  | 'processing'
  | 'finalizing'
  | 'complete'
  | 'preview_stale'
  | 'failed'

export interface WithdrawalStatus {
  requestId: string
  status: WithdrawalStatusName
  stage: string
  errorCode: string | null
  updatedAt: string
  workflowStatus: string
}

interface ConfirmResult {
  requestId: string
  statusToken: string
  status: 'queued'
}

export class AccountDeletionError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'AccountDeletionError'
  }
}

function workerUrl(): string {
  const value = import.meta.env.VITE_ACCOUNT_DELETION_WORKER_URL?.trim()
  if (!value) throw new AccountDeletionError('WORKER_NOT_CONFIGURED', 0)
  return value.replace(/\/$/u, '')
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null
  if (!response.ok) {
    const code = typeof body?.error?.code === 'string' ? body.error.code : 'REQUEST_FAILED'
    throw new AccountDeletionError(code, response.status)
  }
  return body as T
}

async function authHeaders(): Promise<Record<string, string>> {
  const idToken = await getIdToken()
  if (!idToken) throw new AccountDeletionError('UNAUTHORIZED', 401)
  return { Authorization: `Bearer ${idToken}` }
}

export async function createWithdrawalPreview(): Promise<WithdrawalPreview> {
  const response = await fetch(`${workerUrl()}/withdrawal/preview`, {
    method: 'POST',
    headers: await authHeaders(),
  })
  return parseResponse<WithdrawalPreview>(response)
}

export async function confirmWithdrawal(
  preview: WithdrawalPreview,
  successorByMeeting: Record<string, string>,
): Promise<ConfirmResult> {
  const response = await fetch(`${workerUrl()}/withdrawal/confirm`, {
    method: 'POST',
    headers: {
      ...await authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      manifestId: preview.manifestId,
      manifestHash: preview.manifestHash,
      confirmationNonce: preview.confirmationNonce,
      successorByMeeting,
    }),
  })
  return parseResponse<ConfirmResult>(response)
}

export async function getWithdrawalStatus(
  requestId: string,
  statusToken: string,
): Promise<WithdrawalStatus> {
  const response = await fetch(`${workerUrl()}/withdrawal/status/${encodeURIComponent(requestId)}`, {
    headers: { 'X-Withdrawal-Status-Token': statusToken },
  })
  return parseResponse<WithdrawalStatus>(response)
}
