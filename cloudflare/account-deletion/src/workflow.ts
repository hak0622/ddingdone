import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { anonymizeSettlementSnapshot, SnapshotAnonymizationError } from './anonymization'
import { createGoogleAccessToken, deleteFirebaseUser } from './auth'
import { deleteCloudinaryMeetingImage } from './cloudinary'
import { sha256Hex } from './crypto'
import {
  deleteSoloMeeting,
  finalizeWithdrawalMetadata,
  getFirestoreDocument,
  loadMeetingSource,
  loadMeetingSources,
  lockMeetings,
  processSharedMemberDeparture,
  releaseWithdrawalLocks,
  setWithdrawalLockStatus,
  updateWithdrawalRequestStatus,
} from './firestore'
import { withdrawalSourceHashInput } from './preview'
import type {
  FirestoreRecord,
  WithdrawalMeetingAction,
  WithdrawalMeetingPreview,
  WithdrawalWorkflowParams,
} from './types'
import { previewFromManifest } from './withdrawal'

const RETRY = {
  retries: { limit: 5, delay: '5 seconds', backoff: 'exponential' as const },
  timeout: '2 minutes' as const,
} as const
const SENSITIVE_RETRY = { ...RETRY, sensitive: 'output' as const }

interface WorkflowRequestContext {
  uid: string
  manifestId: string
  sourceHash: string
  meetings: WithdrawalMeetingPreview[]
  successorByMeeting: Record<string, string>
}

interface WorkflowMeetingPlan {
  meetingId: string
  status: 'active' | 'settled'
  action: WithdrawalMeetingAction
  successorUid: string | null
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
  const sourceHash = request.data.sourceHash
  if (
    typeof uid !== 'string' || typeof manifestId !== 'string' ||
    typeof sourceHash !== 'string' || !/^[0-9a-f]{64}$/u.test(sourceHash)
  ) throw new NonRetryableError('INVALID_REQUEST_RECORD')
  const preview = previewFromManifest({ id: request.id, data: { preview: request.data.preview } })
  return {
    uid,
    manifestId,
    sourceHash,
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

export class AccountDeletionWorkflow extends WorkflowEntrypoint<Env, WithdrawalWorkflowParams> {
  async run(event: WorkflowEvent<WithdrawalWorkflowParams>, step: WorkflowStep): Promise<{
    status: 'complete'
    processedMeetingCount: number
  }> {
    const { requestId } = event.payload
    let processingStarted = false

    try {
      await step.do('lock withdrawal meetings', RETRY, async () => {
        const accessToken = await createGoogleAccessToken(
          this.env.FIREBASE_CLIENT_EMAIL,
          this.env.FIREBASE_PRIVATE_KEY,
        )
        const context = await loadContext(this.env, requestId, accessToken)
        await updateWithdrawalRequestStatus(
          this.env.FIREBASE_PROJECT_ID,
          accessToken,
          requestId,
          'locking',
          'locking-meetings',
        )
        await lockMeetings(
          this.env.FIREBASE_PROJECT_ID,
          accessToken,
          requestId,
          context.meetings.map((meeting) => meeting.meetingId),
        )
        await setWithdrawalLockStatus(
          this.env.FIREBASE_PROJECT_ID,
          accessToken,
          context.uid,
          requestId,
          'locked',
        )
        return { locked: true }
      })

      const meetingPlan = await step.do('revalidate withdrawal source', SENSITIVE_RETRY, async () => {
        const accessToken = await createGoogleAccessToken(
          this.env.FIREBASE_CLIENT_EMAIL,
          this.env.FIREBASE_PRIVATE_KEY,
        )
        const context = await loadContext(this.env, requestId, accessToken)
        const sources = await loadMeetingSources(
          this.env.FIREBASE_PROJECT_ID,
          context.uid,
          accessToken,
        )
        const currentHash = await sha256Hex(withdrawalSourceHashInput(sources))
        if (currentHash !== context.sourceHash) throw new NonRetryableError('PREVIEW_STALE')
        const sourceByMeeting = new Map(sources.map((source) => [source.meeting.id, source]))
        return context.meetings.map((meeting): WorkflowMeetingPlan => {
          const source = sourceByMeeting.get(meeting.meetingId)
          if (!source) throw new NonRetryableError('PREVIEW_STALE')
          const photoPublicId = source.meeting.data.photoPublicId
          return {
            meetingId: meeting.meetingId,
            status: meeting.status,
            action: meeting.action,
            successorUid: context.successorByMeeting[meeting.meetingId] ?? null,
            photoPublicId: meeting.action === 'delete_solo_room' && typeof photoPublicId === 'string'
              ? photoPublicId
              : null,
          }
        })
      })

      processingStarted = true
      await step.do('mark withdrawal processing', RETRY, async () => {
        const accessToken = await createGoogleAccessToken(
          this.env.FIREBASE_CLIENT_EMAIL,
          this.env.FIREBASE_PRIVATE_KEY,
        )
        await updateWithdrawalRequestStatus(
          this.env.FIREBASE_PROJECT_ID,
          accessToken,
          requestId,
          'processing',
          'processing-meetings',
        )
        return { processing: true }
      })

      const orderedMeetings = [...meetingPlan].sort(
        (left, right) => left.meetingId.localeCompare(right.meetingId),
      )
      for (const meeting of orderedMeetings) {
        await step.do(`process meeting ${meeting.meetingId}`, RETRY, async () => {
          const stepAccessToken = await createGoogleAccessToken(
            this.env.FIREBASE_CLIENT_EMAIL,
            this.env.FIREBASE_PRIVATE_KEY,
          )
          const stepContext = await loadContext(this.env, requestId, stepAccessToken)
          const meetingDocument = await getFirestoreDocument(
            this.env.FIREBASE_PROJECT_ID,
            `meetings/${meeting.meetingId}`,
            stepAccessToken,
          )
          if (!meetingDocument && meeting.action === 'delete_solo_room') {
            return { deletedExpenseCount: 0, alreadyDeleted: true }
          }
          if (!meetingDocument) throw new NonRetryableError('MEETING_NOT_FOUND')
          const source = await loadMeetingSource(
            this.env.FIREBASE_PROJECT_ID,
            meeting.meetingId,
            stepAccessToken,
            meetingDocument,
          )
          if (meeting.action === 'delete_solo_room') {
            return deleteSoloMeeting(
              this.env.FIREBASE_PROJECT_ID,
              stepAccessToken,
              stepContext.uid,
              requestId,
              source,
            )
          }
          const snapshot = meeting.status === 'settled' && source.meeting.data.memberUids instanceof Array &&
            source.meeting.data.memberUids.includes(stepContext.uid)
            ? await anonymizeSettlementSnapshot(
                requestId,
                stepContext.uid,
                meeting.meetingId,
                source.settlement,
              ).catch((error: unknown) => {
                if (error instanceof SnapshotAnonymizationError) {
                  throw new NonRetryableError(error.code)
                }
                throw error
              })
            : null
          return processSharedMemberDeparture(
            this.env.FIREBASE_PROJECT_ID,
            stepAccessToken,
            stepContext.uid,
            requestId,
            source,
            snapshot,
            meeting.successorUid,
          )
        })

        const photoPublicId = meeting.photoPublicId
        if (meeting.action === 'delete_solo_room' && photoPublicId) {
          await step.do(`delete meeting photo ${meeting.meetingId}`, RETRY, async () => {
            await deleteCloudinaryMeetingImage(
              this.env.CLOUDINARY_CLOUD_NAME,
              this.env.CLOUDINARY_API_KEY,
              this.env.CLOUDINARY_API_SECRET,
              meeting.meetingId,
              photoPublicId,
            )
            return { deleted: true }
          })
        }
      }

      await step.do('delete firebase auth account', RETRY, async () => {
        const finalAccessToken = await createGoogleAccessToken(
          this.env.FIREBASE_CLIENT_EMAIL,
          this.env.FIREBASE_PRIVATE_KEY,
        )
        const finalContext = await loadContext(this.env, requestId, finalAccessToken)
        await updateWithdrawalRequestStatus(
          this.env.FIREBASE_PROJECT_ID,
          finalAccessToken,
          requestId,
          'finalizing',
          'deleting-auth-account',
        )
        await deleteFirebaseUser(
          this.env.FIREBASE_PROJECT_ID,
          finalContext.uid,
          finalAccessToken,
        )
        return { deleted: true }
      })

      await step.do('finalize withdrawal metadata', RETRY, async () => {
        const finalAccessToken = await createGoogleAccessToken(
          this.env.FIREBASE_CLIENT_EMAIL,
          this.env.FIREBASE_PRIVATE_KEY,
        )
        const request = await getFirestoreDocument(
          this.env.FIREBASE_PROJECT_ID,
          `withdrawalRequests/${requestId}`,
          finalAccessToken,
        )
        if (request?.data.status === 'complete' && request.data.uid === undefined) {
          return { finalized: true }
        }
        const finalContext = requestContext(request)
        await finalizeWithdrawalMetadata(
          this.env.FIREBASE_PROJECT_ID,
          finalAccessToken,
          finalContext.uid,
          requestId,
          finalContext.manifestId,
        )
        return { finalized: true }
      })

      console.log(JSON.stringify({
        requestId,
        stage: 'complete',
        documentCount: orderedMeetings.length,
        result: 'success',
      }))
      return { status: 'complete', processedMeetingCount: orderedMeetings.length }
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : 'WORKFLOW_FAILED'
      if (!processingStarted) {
        await step.do('release locks before processing', RETRY, async () => {
          const accessToken = await createGoogleAccessToken(
            this.env.FIREBASE_CLIENT_EMAIL,
            this.env.FIREBASE_PRIVATE_KEY,
          )
          const failureContext = await loadContext(this.env, requestId, accessToken)
          await releaseWithdrawalLocks(
            this.env.FIREBASE_PROJECT_ID,
            accessToken,
            failureContext.uid,
            requestId,
            failureContext.meetings.map((meeting) => meeting.meetingId),
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
          return { retainedLocks: true }
        })
      }
      console.error(JSON.stringify({ requestId, stage: 'workflow', result: 'error', errorCode }))
      throw error
    }
  }
}
