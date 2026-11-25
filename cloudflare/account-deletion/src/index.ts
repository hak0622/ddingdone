import { cleanupClosedRooms, createRoom, roomOperation, RoomError } from './rooms'
import { AuthenticationError, createGoogleAccessToken, readBearerToken, verifyFirebaseIdToken } from './auth'
import { randomNonce, sha256Hex, stableStringify } from './crypto'
import {
  claimWithdrawalRequest,
  commitWrites, updateWrite,
  cleanupExpiredWithdrawalMetadata,
  createWithdrawalManifest,
  FirestoreError,
  getFirestoreDocument,
  loadMeetingSources,
  markWorkflowCreationFailed,
} from './firestore'
import { buildWithdrawalPreview, withdrawalSourceHashInput } from './preview'
import type { WithdrawalPreviewResponse } from './types'
import {
  parseWithdrawalConfirmBody,
  resolveSuccessorByMeeting,
  validateManifestForConfirmation,
  verifyHashedToken,
  WithdrawalValidationError,
} from './withdrawal'

export { AccountDeletionWorkflow } from './workflow'

const APP_NAME = 'ddingdone'
const MANIFEST_TTL_MS = 15 * 60 * 1000
const PROD_HOSTNAMES = new Set([
  `${APP_NAME}.apps.tossmini.com`,
  `${APP_NAME}.private-apps.tossmini.com`,
])
const LOCAL_HOSTNAME_PATTERN = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true
  try {
    const hostname = new URL(origin).hostname
    return PROD_HOSTNAMES.has(hostname) || LOCAL_HOSTNAME_PATTERN.test(hostname)
  } catch {
    return false
  }
}

function responseHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Withdrawal-Status-Token',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  }
  if (origin && isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function jsonResponse(
  body: Record<string, unknown> | WithdrawalPreviewResponse,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) })
}

function logResult(requestId: string, result: 'success' | 'error', data: {
  stage: string
  documentCount?: number
  errorCode?: string
}): void {
  const payload = JSON.stringify({ requestId, result, ...data })
  if (result === 'error') console.error(payload)
  else console.log(payload)
}

async function readBoundedJson(request: Request, maximumBytes = 8_192): Promise<unknown> {
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) throw new WithdrawalValidationError('PAYLOAD_TOO_LARGE')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new WithdrawalValidationError('INVALID_JSON')
  }
}

async function createPreview(request: Request, env: Env, origin: string | null): Promise<Response> {
  const requestId = crypto.randomUUID()
  const idToken = readBearerToken(request)
  if (!idToken) return jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401, origin)

  try {
    const uid = await verifyFirebaseIdToken(idToken, env.FIREBASE_API_KEY, env.FIREBASE_PROJECT_ID)
    const accessToken = await createGoogleAccessToken(
      env.FIREBASE_CLIENT_EMAIL,
      env.FIREBASE_PRIVATE_KEY,
    )
    const existingLock = await getFirestoreDocument(
      env.FIREBASE_PROJECT_ID,
      `withdrawalLocks/${uid}`,
      accessToken,
    )
    if (existingLock) {
      if (new URL(request.url).searchParams.get('resume') === '1' && typeof existingLock.data.requestId === 'string') {
        return jsonResponse({ activeRequestId: existingLock.data.requestId }, 200, origin)
      }
      return jsonResponse({ error: { code: 'WITHDRAWAL_IN_PROGRESS' } }, 409, origin)
    }
    const sources = await loadMeetingSources(env.FIREBASE_PROJECT_ID, uid, accessToken)
    const preview = await buildWithdrawalPreview(uid, sources)
    const sourceHash = await sha256Hex(withdrawalSourceHashInput(sources))
    // 사용자당 manifest 하나만 유지해 미리보기 반복 호출로 문서가 무한히
    // 쌓이지 않게 한다. 새 미리보기는 이전 nonce와 해시를 즉시 무효화한다.
    const manifestId = await sha256Hex(`withdrawal-manifest:${uid}`)
    const confirmationNonce = randomNonce()
    const confirmationNonceHash = await sha256Hex(confirmationNonce)
    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + MANIFEST_TTL_MS)
    const manifestHash = await sha256Hex(stableStringify({ uid, sourceHash, preview }))

    await createWithdrawalManifest(env.FIREBASE_PROJECT_ID, manifestId, accessToken, {
      uid,
      manifestHash,
      sourceHash,
      confirmationNonceHash,
      preview,
      createdAt,
      expiresAt,
    })

    logResult(requestId, 'success', {
      stage: 'preview-created',
      documentCount: sources.length,
    })
    return jsonResponse({
      ...preview,
      manifestId,
      manifestHash,
      sourceHash,
      confirmationNonce,
      expiresAt: expiresAt.toISOString(),
    }, 200, origin)
  } catch (error) {
    const errorCode = error instanceof AuthenticationError
      ? 'UNAUTHORIZED'
      : error instanceof FirestoreError
        ? error.code
        : 'INTERNAL_ERROR'
    logResult(requestId, 'error', { stage: 'preview', errorCode })
    const status = errorCode === 'UNAUTHORIZED' ? 401
      : errorCode === 'MEETING_LIMIT_EXCEEDED' || errorCode === 'DOCUMENT_LIMIT_EXCEEDED' ? 409
        : 500
    return jsonResponse({ error: { code: errorCode } }, status, origin)
  }
}

async function confirmWithdrawal(request: Request, env: Env, origin: string | null): Promise<Response> {
  const logRequestId = crypto.randomUUID()
  const idToken = readBearerToken(request)
  if (!idToken) return jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401, origin)

  try {
    const input: unknown = await readBoundedJson(request)
    const uid = await verifyFirebaseIdToken(idToken, env.FIREBASE_API_KEY, env.FIREBASE_PROJECT_ID)
    const accessToken = await createGoogleAccessToken(
      env.FIREBASE_CLIENT_EMAIL,
      env.FIREBASE_PRIVATE_KEY,
    )
    const existingLock = await getFirestoreDocument(
      env.FIREBASE_PROJECT_ID,
      `withdrawalLocks/${uid}`,
      accessToken,
    )
    if (input && typeof input === 'object' && 'scopeRevision' in input && 'requestId' in input) {
      const { requestId, scopeRevision } = input
      if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/u.test(requestId) ||
          typeof scopeRevision !== 'string' || !/^[0-9a-f-]{36}$/u.test(scopeRevision) ||
          existingLock?.data.requestId !== requestId) throw new WithdrawalValidationError('INVALID_REQUEST')
      const path = `withdrawalRequests/${requestId}`
      const record = await getFirestoreDocument(env.FIREBASE_PROJECT_ID, path, accessToken)
      if (!record?.updateTime || record.data.uid !== uid || record.data.scopeRevision !== scopeRevision) {
        throw new WithdrawalValidationError('PREVIEW_STALE')
      }
      if (record.data.status !== 'awaiting_reconfirmation') {
        if (record.data.status === 'processing' && record.data.approvedScopeRevision === scopeRevision) {
          return jsonResponse({ accepted: true }, 200, origin)
        }
        throw new WithdrawalValidationError('PREVIEW_STALE')
      }
      if (record.data.approvedScopeRevision !== scopeRevision) {
        try {
          await commitWrites(env.FIREBASE_PROJECT_ID, accessToken, [
            updateWrite(env.FIREBASE_PROJECT_ID, path, { approvedScopeRevision: scopeRevision },
              ['approvedScopeRevision'], { updateTime: record.updateTime }),
          ], 'WITHDRAWAL_CONFIRM_CONFLICT')
        } catch (error) {
          const latest = await getFirestoreDocument(env.FIREBASE_PROJECT_ID, path, accessToken)
          if (latest?.data.uid !== uid || latest.data.approvedScopeRevision !== scopeRevision) throw error
          if (latest.data.status === 'processing') return jsonResponse({ accepted: true }, 200, origin)
          if (latest.data.status !== 'awaiting_reconfirmation') throw new WithdrawalValidationError('PREVIEW_STALE')
        }
      }
      const workflow = await env.ACCOUNT_DELETION_WORKFLOW.get(requestId)
      await workflow.sendEvent({ type: `withdrawal-${scopeRevision}`, payload: {} })
      return jsonResponse({ accepted: true }, 200, origin)
    }
    const body = parseWithdrawalConfirmBody(input)
    if (existingLock) throw new WithdrawalValidationError('WITHDRAWAL_IN_PROGRESS')
    const manifest = await getFirestoreDocument(
      env.FIREBASE_PROJECT_ID,
      `withdrawalManifests/${body.manifestId}`,
      accessToken,
    )
    const preview = await validateManifestForConfirmation(uid, manifest, body)
    if (!manifest) throw new WithdrawalValidationError('MANIFEST_NOT_FOUND')
    const successorByMeeting = resolveSuccessorByMeeting(preview, body.successorByMeeting)

    const requestId = crypto.randomUUID()
    const statusToken = randomNonce()
    await claimWithdrawalRequest(env.FIREBASE_PROJECT_ID, accessToken, {
      manifest,
      uid,
      requestId,
      statusTokenHash: await sha256Hex(statusToken),
      successorByMeeting,
      now: new Date(),
    })

    try {
      await env.ACCOUNT_DELETION_WORKFLOW.create({
        id: requestId,
        params: { requestId },
        retention: { successRetention: '30 days', errorRetention: '30 days' },
      })
    } catch {
      await markWorkflowCreationFailed(
        env.FIREBASE_PROJECT_ID,
        accessToken,
        uid,
        requestId,
        body.manifestId,
      )
      throw new WithdrawalValidationError('WORKFLOW_CREATE_FAILED')
    }

    logResult(logRequestId, 'success', { stage: 'withdrawal-queued' })
    return jsonResponse({ requestId, statusToken, status: 'queued' }, 202, origin)
  } catch (error) {
    const errorCode = error instanceof AuthenticationError ? 'UNAUTHORIZED'
      : error instanceof WithdrawalValidationError ? error.code
        : error instanceof FirestoreError ? error.code
          : 'INTERNAL_ERROR'
    logResult(logRequestId, 'error', { stage: 'confirm', errorCode })
    const status = errorCode === 'UNAUTHORIZED' ? 401
      : errorCode === 'INVALID_REQUEST' || errorCode === 'INVALID_JSON' ||
        errorCode === 'INVALID_SUCCESSOR' ? 400
        : errorCode === 'INTERNAL_ERROR' ? 500 : 409
    return jsonResponse({ error: { code: errorCode } }, status, origin)
  }
}

async function withdrawalStatus(
  request: Request,
  env: Env,
  origin: string | null,
  requestId: string,
): Promise<Response> {
  const logRequestId = crypto.randomUUID()
  try {
    const accessToken = await createGoogleAccessToken(
      env.FIREBASE_CLIENT_EMAIL,
      env.FIREBASE_PRIVATE_KEY,
    )
    const record = await getFirestoreDocument(
      env.FIREBASE_PROJECT_ID,
      `withdrawalRequests/${requestId}`,
      accessToken,
    )
    if (!record) return jsonResponse({ error: { code: 'NOT_FOUND' } }, 404, origin)

    const statusToken = request.headers.get('X-Withdrawal-Status-Token')
    let authorized = Boolean(
      statusToken && statusToken.length <= 128 &&
      await verifyHashedToken(statusToken, record.data.statusTokenHash),
    )
    if (!authorized && typeof record.data.uid === 'string') {
      const idToken = readBearerToken(request)
      if (idToken) {
        const uid = await verifyFirebaseIdToken(idToken, env.FIREBASE_API_KEY, env.FIREBASE_PROJECT_ID)
        authorized = uid === record.data.uid
      }
    }
    if (!authorized) return jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401, origin)

    return jsonResponse({
      requestId,
      status: record.data.status,
      stage: record.data.stage,
      errorCode: record.data.errorCode ?? null,
      updatedAt: record.data.updatedAt,
      ...(record.data.status === 'awaiting_reconfirmation' ? {
        scopeRevision: record.data.scopeRevision, scopeMeetingName: record.data.scopeMeetingName,
      } : {}),
    }, 200, origin)
  } catch (error) {
    const errorCode = error instanceof AuthenticationError ? 'UNAUTHORIZED' : 'INTERNAL_ERROR'
    logResult(logRequestId, 'error', { stage: 'status', errorCode })
    return jsonResponse({ error: { code: errorCode } }, errorCode === 'UNAUTHORIZED' ? 401 : 500, origin)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    if (!isAllowedOrigin(origin)) {
      return jsonResponse({ error: { code: 'ORIGIN_NOT_ALLOWED' } }, 403, null)
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(origin) })

    const url = new URL(request.url)
    const roomMatch = url.pathname.match(/^\/rooms\/([A-Za-z0-9_-]{1,128})\/(access|join|leave|expense|settle)$/u)
    if (roomMatch || url.pathname === '/rooms') {
      const [, roomId, action = 'create'] = roomMatch ?? []
      if (request.method !== (action === 'access' ? 'GET' : 'POST')) {
        return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405, origin)
      }
      try {
        const idToken = readBearerToken(request)
        if (!idToken) throw new RoomError('UNAUTHORIZED', 401)
        const uid = await verifyFirebaseIdToken(idToken, env.FIREBASE_API_KEY, env.FIREBASE_PROJECT_ID)
        const body = action === 'access' ? {} : await readBoundedJson(request, 32768)
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RoomError('INVALID_JSON', 400)
        const token = await createGoogleAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY)
        const input = body as Record<string, unknown>
        const result = action === 'create'
          ? await createRoom(env.FIREBASE_PROJECT_ID, token, uid, input)
          : await roomOperation(env.FIREBASE_PROJECT_ID, token, roomId!, uid, action, input)
        return jsonResponse(result, 200, origin)
      } catch (error) {
        if (error instanceof RoomError) return jsonResponse({ error: { code: error.code } }, error.status, origin)
        if (error instanceof AuthenticationError) return jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401, origin)
        if (error instanceof WithdrawalValidationError) return jsonResponse({ error: { code: error.code } }, 400, origin)
        if (error instanceof FirestoreError && error.code === 'ROOM_CHANGED') return jsonResponse({ error: { code: error.code } }, 409, origin)
        console.error(JSON.stringify({ event: 'room-operation-failed', action, code: error instanceof FirestoreError ? error.code : 'INTERNAL_ERROR' }))
        return jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500, origin)
      }
    }
    const statusMatch = url.pathname.match(/^\/withdrawal\/status\/([0-9a-f-]{36})$/u)
    if (statusMatch?.[1]) {
      if (request.method !== 'GET') {
        return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405, origin)
      }
      return withdrawalStatus(request, env, origin, statusMatch[1])
    }
    if (url.pathname !== '/withdrawal/preview' && url.pathname !== '/withdrawal/confirm') {
      return jsonResponse({ error: { code: 'NOT_FOUND' } }, 404, origin)
    }
    if (request.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405, origin)
    const contentLength = Number(request.headers.get('Content-Length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > 1024) {
      return jsonResponse({ error: { code: 'PAYLOAD_TOO_LARGE' } }, 413, origin)
    }
    return url.pathname === '/withdrawal/preview'
      ? createPreview(request, env, origin)
      : confirmWithdrawal(request, env, origin)
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const cleanupId = `scheduled-cleanup:${controller.scheduledTime}`
    try {
      const accessToken = await createGoogleAccessToken(
        env.FIREBASE_CLIENT_EMAIL,
        env.FIREBASE_PRIVATE_KEY,
      )
      const [metadata, closedRooms] = await Promise.all([
        cleanupExpiredWithdrawalMetadata(
          env.FIREBASE_PROJECT_ID,
          accessToken,
          new Date(controller.scheduledTime),
        ),
        cleanupClosedRooms(env.FIREBASE_PROJECT_ID, accessToken),
      ])
      console.log(JSON.stringify({
        cleanupId,
        result: 'success',
        stage: 'cleanup',
        metadata,
        closedRooms,
      }))
    } catch (error) {
      const errorCode = error instanceof FirestoreError ? error.code : 'INTERNAL_ERROR'
      console.error(JSON.stringify({ cleanupId, result: 'error', stage: 'cleanup', errorCode }))
      throw error
    }
  },
} satisfies ExportedHandler<Env>
