import { AuthenticationError, createGoogleAccessToken, readBearerToken, verifyFirebaseIdToken } from './auth'
import { randomNonce, sha256Hex, stableStringify } from './crypto'
import { createWithdrawalManifest, FirestoreError, loadMeetingSources } from './firestore'
import { buildWithdrawalPreview, withdrawalSourceHashInput } from './preview'
import type { WithdrawalPreviewResponse } from './types'

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

async function createPreview(request: Request, env: Env, origin: string | null): Promise<Response> {
  const requestId = crypto.randomUUID()
  const idToken = readBearerToken(request)
  if (!idToken) return jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401, origin)

  try {
    const uid = await verifyFirebaseIdToken(idToken, env.FIREBASE_API_KEY)
    const accessToken = await createGoogleAccessToken(
      env.FIREBASE_CLIENT_EMAIL,
      env.FIREBASE_PRIVATE_KEY,
    )
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    if (!isAllowedOrigin(origin)) {
      return jsonResponse({ error: { code: 'ORIGIN_NOT_ALLOWED' } }, 403, null)
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(origin) })

    const url = new URL(request.url)
    if (url.pathname !== '/withdrawal/preview') {
      return jsonResponse({ error: { code: 'NOT_FOUND' } }, 404, origin)
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405, origin)
    }
    const contentLength = Number(request.headers.get('Content-Length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > 1024) {
      return jsonResponse({ error: { code: 'PAYLOAD_TOO_LARGE' } }, 413, origin)
    }
    return createPreview(request, env, origin)
  },
} satisfies ExportedHandler<Env>
