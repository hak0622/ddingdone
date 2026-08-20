import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { anonymizeSettlementSnapshot, SnapshotAnonymizationError } from './anonymization'
import { createGoogleAccessToken, deleteFirebaseUser } from './auth'
import { sha256Hex } from './crypto'
import {
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
  return { uid, manifestId, sourceHash, meetings: preview.meetings }
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
      const meetingPlan = await step.do('lock withdrawal meetings', SENSITIVE_RETRY, async () => {
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
        return context.meetings.map(({ meetingId, status }) => ({ meetingId, status }))
      })

      await step.do('revalidate withdrawal source', RETRY, async () => {
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
        return { verified: true }
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
          'deleting-shared-data',
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
          const source = await loadMeetingSource(
            this.env.FIREBASE_PROJECT_ID,
            meeting.meetingId,
            stepAccessToken,
          )
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
          )
        })
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
