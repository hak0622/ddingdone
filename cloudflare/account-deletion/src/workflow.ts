import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { anonymizeSettlementSnapshot, SnapshotAnonymizationError } from './anonymization'
import { createGoogleAccessToken, deleteFirebaseUser } from './auth'
import { deleteCloudinaryMeetingImage } from './cloudinary'
import {
  beginFirestoreTransaction,
  deleteSoloMeeting,
  finalizeWithdrawalMetadata,
  getFirestoreDocument,
  listMeetingIdsForUser,
  loadMeetingSource,
  markWithdrawalProcessing,
  processSharedMemberDeparture,
  releaseWithdrawalAccountLock,
  rollbackFirestoreTransaction,
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
  successorByMeeting: Record<string, string>
}

interface WorkflowMeetingPlan {
  meetingId: string
  requestedSuccessorUid: string | null
}

interface ProcessedMeetingResult {
  action: WithdrawalMeetingPreview['action'] | 'already_processed'
  deletedExpenseCount: number
  photoPublicId: string | null
}

function successorMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NonRetryableError('INVALID_REQUEST_RECORD')
  }
  const result: Record<string, string> = {}
  for (const [meetingId, uid] of Object.entries(value)) {
    if (typeof uid !== 'string') throw new NonRetryableError('INVALID_REQUEST_RECORD')
    result[meetingId] = uid
  }
  return result
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
    successorByMeeting: successorMap(request.data.successorByMeeting),
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

function currentSuccessor(
  meeting: WithdrawalMeetingPreview,
  requestedSuccessorUid: string | null,
): string | null {
  if (meeting.role !== 'owner' || meeting.memberCount <= 1) return null
  const candidateUids = meeting.successorCandidates.map((candidate) => candidate.uid)
  if (requestedSuccessorUid && candidateUids.includes(requestedSuccessorUid)) {
    return requestedSuccessorUid
  }
  if (meeting.automaticSuccessorUid && candidateUids.includes(meeting.automaticSuccessorUid)) {
    return meeting.automaticSuccessorUid
  }
  throw new NonRetryableError('INVALID_SUCCESSOR')
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
          requestedSuccessorUid: context.successorByMeeting[meeting.meetingId] ?? null,
        }))
      })

      processingStarted = true
      const orderedMeetings = [...meetingPlan].sort(
        (left, right) => left.meetingId.localeCompare(right.meetingId),
      )
      for (const meeting of orderedMeetings) {
        const processed = await step.do(`process meeting ${meeting.meetingId}`, RETRY, async () => {
          const startedAt = Date.now()
          const accessToken = await createGoogleAccessToken(
            this.env.FIREBASE_CLIENT_EMAIL,
            this.env.FIREBASE_PRIVATE_KEY,
          )
          const context = await loadContext(this.env, requestId, accessToken)
          const transaction = await beginFirestoreTransaction(
            this.env.FIREBASE_PROJECT_ID,
            accessToken,
          )
          let transactionFinished = false
          try {
            const meetingDocument = await getFirestoreDocument(
              this.env.FIREBASE_PROJECT_ID,
              `meetings/${meeting.meetingId}`,
              accessToken,
              transaction,
            )
            if (!meetingDocument) {
              await rollbackFirestoreTransaction(this.env.FIREBASE_PROJECT_ID, accessToken, transaction)
              transactionFinished = true
              return {
                action: 'already_processed',
                deletedExpenseCount: 0,
                photoPublicId: null,
              } satisfies ProcessedMeetingResult
            }
            const memberUids = Array.isArray(meetingDocument.data.memberUids)
              ? meetingDocument.data.memberUids
              : []
            if (!memberUids.includes(context.uid)) {
              await rollbackFirestoreTransaction(this.env.FIREBASE_PROJECT_ID, accessToken, transaction)
              transactionFinished = true
              return {
                action: 'already_processed',
                deletedExpenseCount: 0,
                photoPublicId: null,
              } satisfies ProcessedMeetingResult
            }
            const source = await loadMeetingSource(
              this.env.FIREBASE_PROJECT_ID,
              meeting.meetingId,
              accessToken,
              meetingDocument,
              transaction,
            )
            const currentPreview = (await buildWithdrawalPreview(context.uid, [source])).meetings[0]
            if (!currentPreview || currentPreview.action === 'manual_review') {
              throw new NonRetryableError('MANUAL_REVIEW_REQUIRED')
            }
            const successorUid = currentSuccessor(currentPreview, meeting.requestedSuccessorUid)
            const photoPublicId = currentPreview.action === 'delete_solo_room' &&
              typeof source.meeting.data.photoPublicId === 'string'
              ? source.meeting.data.photoPublicId
              : null
            let result: { deletedExpenseCount: number }
            if (currentPreview.action === 'delete_solo_room') {
              result = await deleteSoloMeeting(
                this.env.FIREBASE_PROJECT_ID,
                accessToken,
                context.uid,
                source,
                transaction,
              )
            } else {
              let snapshot: Record<string, unknown> | null = null
              if (currentPreview.action === 'anonymize_settled_shared') {
                try {
                  snapshot = await anonymizeSettlementSnapshot(
                    requestId,
                    context.uid,
                    meeting.meetingId,
                    source.settlement,
                  )
                } catch (error) {
                  if (error instanceof SnapshotAnonymizationError) {
                    throw new NonRetryableError(error.code)
                  }
                  throw error
                }
              }
              result = await processSharedMemberDeparture(
                this.env.FIREBASE_PROJECT_ID,
                accessToken,
                context.uid,
                source,
                snapshot,
                successorUid,
                transaction,
              )
            }
            transactionFinished = true
            logStage(requestId, 'meeting', startedAt, {
              meetingId: meeting.meetingId,
              action: currentPreview.action,
              deletedExpenseCount: result.deletedExpenseCount,
            })
            return {
              action: currentPreview.action,
              deletedExpenseCount: result.deletedExpenseCount,
              photoPublicId,
            } satisfies ProcessedMeetingResult
          } catch (error) {
            if (!transactionFinished) {
              await rollbackFirestoreTransaction(
                this.env.FIREBASE_PROJECT_ID,
                accessToken,
                transaction,
              ).catch(() => undefined)
            }
            throw error
          }
        })

        if (processed.action === 'delete_solo_room' && processed.photoPublicId) {
          const photoPublicId = processed.photoPublicId
          await step.do(`delete meeting photo ${meeting.meetingId}`, RETRY, async () => {
            const startedAt = Date.now()
            await deleteCloudinaryMeetingImage(
              this.env.CLOUDINARY_CLOUD_NAME,
              this.env.CLOUDINARY_API_KEY,
              this.env.CLOUDINARY_API_SECRET,
              meeting.meetingId,
              photoPublicId,
            )
            logStage(requestId, 'cloudinary-photo', startedAt, { meetingId: meeting.meetingId })
            return { deleted: true }
          })
        }
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
