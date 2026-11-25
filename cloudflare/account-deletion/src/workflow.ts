import { closeRoom, departRoom, isCurrentRoom, RoomError, withRoomTransaction } from './rooms'
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { createGoogleAccessToken, deleteFirebaseUser } from './auth'
import {
  finalizeWithdrawalMetadata,
  getFirestoreDocument,
  listMeetingIdsForUser,
  markWithdrawalProcessing,
  releaseWithdrawalAccountLock,
  setWithdrawalLockStatus,
  updateWithdrawalRequestStatus,
} from './firestore'
import { buildWithdrawalPreview } from './preview'
import type { FirestoreRecord, WithdrawalMeetingPreview, WithdrawalWorkflowParams } from './types'
import { previewFromManifest } from './withdrawal'

const RETRY = {
  retries: { limit: 5, delay: '5 seconds', backoff: 'exponential' as const },
  timeout: '2 minutes' as const,
} as const
const SENSITIVE_RETRY = { ...RETRY, sensitive: 'output' as const }

interface WorkflowRequestContext {
  uid: string
  manifestId: string
  meetings: WithdrawalMeetingPreview[]
}

interface WorkflowMeetingPlan {
  meetingId: string
  approvedSolo?: boolean
  revision?: string
}

interface ProcessedMeetingResult {
  action: WithdrawalMeetingPreview['action'] | 'already_processed' | 'deletion_scope_changed'
  deletedExpenseCount: number
}

function requestContext(request: FirestoreRecord | null): WorkflowRequestContext {
  if (!request) throw new NonRetryableError('REQUEST_NOT_FOUND')
  const uid = request.data.uid
  const manifestId = request.data.manifestId
  if (typeof uid !== 'string' || typeof manifestId !== 'string') {
    throw new NonRetryableError('INVALID_REQUEST_RECORD')
  }
  const preview = previewFromManifest({ id: request.id, data: { preview: request.data.preview } })
  return {
    uid,
    manifestId,
    meetings: preview.meetings,
  }
}

async function loadContext(env: Env, requestId: string, accessToken: string): Promise<WorkflowRequestContext> {
  return requestContext(await getFirestoreDocument(
    env.FIREBASE_PROJECT_ID,
    `withdrawalRequests/${requestId}`,
    accessToken,
  ))
}

function sameMeetingIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b))
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b))
  return sortedLeft.every((meetingId, index) => meetingId === sortedRight[index])
}

function logStage(
  requestId: string,
  stage: string,
  startedAt: number,
  extra: Record<string, unknown> = {},
): void {
  console.log(JSON.stringify({
    event: 'account-deletion-timing',
    requestId,
    stage,
    durationMs: Date.now() - startedAt,
    result: 'success',
    ...extra,
  }))
}

async function processMeeting(
  env: Env,
  step: WorkflowStep,
  requestId: string,
  meeting: WorkflowMeetingPlan,
): Promise<ProcessedMeetingResult> {
  const processed = await step.do(`process meeting ${meeting.meetingId}${meeting.revision ? ` ${meeting.revision}` : ''}`, RETRY, async () => {
    const startedAt = Date.now()
    const accessToken = await createGoogleAccessToken(
      env.FIREBASE_CLIENT_EMAIL,
      env.FIREBASE_PRIVATE_KEY,
    )
    const context = await loadContext(env, requestId, accessToken)
    const meetingMetadata = await getFirestoreDocument(
      env.FIREBASE_PROJECT_ID, `meetings/${meeting.meetingId}`, accessToken,
    )
    if (meetingMetadata) {
      if (!isCurrentRoom(meetingMetadata)) throw new NonRetryableError('PREVIEW_STALE')
      try {
        let pending = await withRoomTransaction(env.FIREBASE_PROJECT_ID, accessToken, meeting.meetingId, async (store, path) => {
          const current = await store.read(path)
          if (!current) return false
          if (!isCurrentRoom(current)) throw new NonRetryableError('PREVIEW_STALE')
          if (current.data.roomCleanupPending) return true
          const departure = await departRoom(store, path, current, context.uid, 'withdraw', undefined, meeting.approvedSolo)
          return departure.cleanupPending === true
        })
        for (let page = 0; pending && page < 8; page++) {
          pending = await withRoomTransaction(env.FIREBASE_PROJECT_ID, accessToken, meeting.meetingId, async (store, path) => {
            const current = await store.read(path)
            if (!current) return false
            if (current.data.roomCleanupPending !== true) throw new NonRetryableError('PREVIEW_STALE')
            return !(await closeRoom(store, path, current))
          })
        }
        if (pending) throw new Error('ROOM_CLEANUP_PENDING')
      } catch (error) {
        if (error instanceof RoomError && error.code === 'DELETION_SCOPE_CHANGED') {
          return { action: 'deletion_scope_changed', deletedExpenseCount: 0 } satisfies ProcessedMeetingResult
        }
        throw error
      }
      return { action: 'preserve_participant_records', deletedExpenseCount: 0 } satisfies ProcessedMeetingResult
    }
    return { action: 'already_processed', deletedExpenseCount: 0 } satisfies ProcessedMeetingResult
  })
  return processed
}

export class AccountDeletionWorkflow extends WorkflowEntrypoint<Env, WithdrawalWorkflowParams> {
  async run(event: WorkflowEvent<WithdrawalWorkflowParams>, step: WorkflowStep): Promise<{
    status: 'complete'
    processedMeetingCount: number
  }> {
    const { requestId } = event.payload
    const workflowStartedAt = event.timestamp.getTime()
    let processingStarted = false

    console.log(JSON.stringify({
      event: 'account-deletion-timing',
      requestId,
      stage: 'workflow-started',
      queueDelayMs: Math.max(0, Date.now() - workflowStartedAt),
      result: 'success',
    }))

    try {
      const meetingPlan = await step.do('prepare withdrawal processing', SENSITIVE_RETRY, async () => {
        const startedAt = Date.now()
        const accessToken = await createGoogleAccessToken(
          this.env.FIREBASE_CLIENT_EMAIL,
          this.env.FIREBASE_PRIVATE_KEY,
        )
        const context = await loadContext(this.env, requestId, accessToken)
        const currentMeetingIds = await listMeetingIdsForUser(
          this.env.FIREBASE_PROJECT_ID,
          context.uid,
          accessToken,
        )
        const previewMeetingIds = context.meetings.map((meeting) => meeting.meetingId)
        if (!sameMeetingIds(currentMeetingIds, previewMeetingIds)) {
          throw new NonRetryableError('PREVIEW_STALE')
        }
        await markWithdrawalProcessing(
          this.env.FIREBASE_PROJECT_ID,
          accessToken,
          context.uid,
          requestId,
        )
        logStage(requestId, 'prepare', startedAt, { meetingCount: context.meetings.length })
        return context.meetings.map((meeting): WorkflowMeetingPlan => ({
          meetingId: meeting.meetingId,
          approvedSolo: meeting.action === 'delete_solo_room',
        }))
      })

      const orderedMeetings = [...meetingPlan].sort(
        (left, right) => left.meetingId.localeCompare(right.meetingId),
      )
      const processedMeetings: ProcessedMeetingResult[] = []
      for (const meeting of orderedMeetings) {
        processingStarted = true
        let result = await processMeeting(this.env, step, requestId, meeting)
        if (result.action === 'deletion_scope_changed') {
          if (!processedMeetings.length) {
            processingStarted = false
            throw new NonRetryableError('PREVIEW_STALE')
          }
          const revision = await step.do(`request confirmation ${meeting.meetingId}`, RETRY, async () => {
            const token = await createGoogleAccessToken(this.env.FIREBASE_CLIENT_EMAIL, this.env.FIREBASE_PRIVATE_KEY)
            const existing = await getFirestoreDocument(this.env.FIREBASE_PROJECT_ID, `withdrawalRequests/${requestId}`, token)
            if (existing?.data.scopeMeetingId === meeting.meetingId && typeof existing.data.scopeRevision === 'string') {
              return existing.data.scopeRevision
            }
            const next = crypto.randomUUID()
            const context = requestContext(existing)
            await updateWithdrawalRequestStatus(this.env.FIREBASE_PROJECT_ID, token, requestId,
              'awaiting_reconfirmation', 'confirm-expanded-deletion', {
                scopeMeetingId: meeting.meetingId,
                scopeMeetingName: context.meetings.find((item) => item.meetingId === meeting.meetingId)?.name ?? '정산방',
                scopeRevision: next, approvedScopeRevision: null,
              })
            return next
          })
          await step.waitForEvent(`confirm room ${meeting.meetingId}`, {
            type: `withdrawal-${revision}`, timeout: '24 hours',
          })
          await step.do(`verify confirmation ${meeting.meetingId}`, RETRY, async () => {
            const token = await createGoogleAccessToken(this.env.FIREBASE_CLIENT_EMAIL, this.env.FIREBASE_PRIVATE_KEY)
            const request = await getFirestoreDocument(this.env.FIREBASE_PROJECT_ID, `withdrawalRequests/${requestId}`, token)
            if (request?.data.approvedScopeRevision !== revision) throw new NonRetryableError('UNCONFIRMED_DELETION_SCOPE')
            await updateWithdrawalRequestStatus(this.env.FIREBASE_PROJECT_ID, token, requestId, 'processing', 'processing-meetings')
          })
          result = await processMeeting(this.env, step, requestId, { ...meeting, approvedSolo: true, revision })
        }
        processedMeetings.push(result)
      }
      await step.do('delete auth and finalize withdrawal', RETRY, async () => {
        const startedAt = Date.now()
        let operationStartedAt = Date.now()
        const accessToken = await createGoogleAccessToken(
          this.env.FIREBASE_CLIENT_EMAIL,
          this.env.FIREBASE_PRIVATE_KEY,
        )
        logStage(requestId, 'finalize-access-token', operationStartedAt)

        operationStartedAt = Date.now()
        const request = await getFirestoreDocument(
          this.env.FIREBASE_PROJECT_ID,
          `withdrawalRequests/${requestId}`,
          accessToken,
        )
        logStage(requestId, 'finalize-request-read', operationStartedAt)
        if (request?.data.status === 'complete' && request.data.uid === undefined) {
          logStage(requestId, 'auth-and-finalize', startedAt, {
            meetingCount: orderedMeetings.length,
            alreadyFinalized: true,
          })
          return { finalized: true }
        }
        const context = requestContext(request)

        operationStartedAt = Date.now()
        await updateWithdrawalRequestStatus(
          this.env.FIREBASE_PROJECT_ID,
          accessToken,
          requestId,
          'finalizing',
          'deleting-auth-account',
        )
        logStage(requestId, 'finalize-status-write', operationStartedAt)

        operationStartedAt = Date.now()
        const remaining = await listMeetingIdsForUser(this.env.FIREBASE_PROJECT_ID, context.uid, accessToken)
        if (remaining.length) throw new Error('WITHDRAWAL_ROOM_LINKS_REMAIN')
        await deleteFirebaseUser(this.env.FIREBASE_PROJECT_ID, context.uid, accessToken)
        logStage(requestId, 'finalize-auth-delete', operationStartedAt)

        operationStartedAt = Date.now()
        await finalizeWithdrawalMetadata(
          this.env.FIREBASE_PROJECT_ID,
          accessToken,
          context.uid,
          requestId,
          context.manifestId,
        )
        logStage(requestId, 'finalize-metadata-cleanup', operationStartedAt)
        logStage(requestId, 'auth-and-finalize', startedAt, {
          meetingCount: orderedMeetings.length,
        })
        return { finalized: true }
      })

      logStage(requestId, 'workflow-total', workflowStartedAt, {
        meetingCount: orderedMeetings.length,
      })
      return { status: 'complete', processedMeetingCount: orderedMeetings.length }
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : 'WORKFLOW_FAILED'
      if (!processingStarted) {
        await step.do('release account lock before processing', RETRY, async () => {
          const accessToken = await createGoogleAccessToken(
            this.env.FIREBASE_CLIENT_EMAIL,
            this.env.FIREBASE_PRIVATE_KEY,
          )
          const failureContext = await loadContext(this.env, requestId, accessToken)
          await releaseWithdrawalAccountLock(
            this.env.FIREBASE_PROJECT_ID,
            accessToken,
            failureContext.uid,
            requestId,
          )
          await updateWithdrawalRequestStatus(
            this.env.FIREBASE_PROJECT_ID,
            accessToken,
            requestId,
            errorCode === 'PREVIEW_STALE' ? 'preview_stale' : 'failed',
            'stopped-before-deletion',
            { errorCode },
          )
          return { released: true }
        })
      } else {
        await step.do('mark workflow failed', RETRY, async () => {
          const accessToken = await createGoogleAccessToken(
            this.env.FIREBASE_CLIENT_EMAIL,
            this.env.FIREBASE_PRIVATE_KEY,
          )
          const failureContext = await loadContext(this.env, requestId, accessToken)
          await updateWithdrawalRequestStatus(
            this.env.FIREBASE_PROJECT_ID,
            accessToken,
            requestId,
            'failed',
            'manual-recovery-required',
            { errorCode },
          )
          await setWithdrawalLockStatus(
            this.env.FIREBASE_PROJECT_ID,
            accessToken,
            failureContext.uid,
            requestId,
            'failed',
          )
          return { retainedAccountLock: true }
        })
      }
      console.error(JSON.stringify({
        event: 'account-deletion-timing',
        requestId,
        stage: 'workflow-total',
        durationMs: Date.now() - workflowStartedAt,
        result: 'error',
        errorCode,
      }))
      throw error
    }
  }
}
