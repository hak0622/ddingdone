import { base64UrlBytes, base64UrlJson } from './crypto'

const FIREBASE_LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_TOKEN_AUDIENCE = GOOGLE_TOKEN_URL
const GOOGLE_DATASTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'
const EXTERNAL_REQUEST_TIMEOUT_MS = 10_000

export class AuthenticationError extends Error {
  constructor() {
    super('Authentication failed')
    this.name = 'AuthenticationError'
  }
}

function readUid(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const users = (value as { users?: unknown }).users
  if (!Array.isArray(users) || users.length !== 1) return null
  const first = users[0]
  if (!first || typeof first !== 'object') return null
  const uid = (first as { localId?: unknown }).localId
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 128 ? uid : null
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (!header || header.length > 8192 || !header.startsWith('Bearer ')) return null
  const token = header.slice(7)
  return token && !token.includes(' ') ? token : null
}

export async function verifyFirebaseIdToken(idToken: string, apiKey: string): Promise<string> {
  const response = await fetch(`${FIREBASE_LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
    signal: AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new AuthenticationError()
  const uid = readUid(await response.json())
  if (!uid) throw new AuthenticationError()
  return uid
}

function pemToPkcs8(privateKey: string): ArrayBuffer {
  const normalized = privateKey.replace(/\\n/g, '\n')
  const base64 = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  if (!base64) throw new Error('Firebase private key is invalid')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function readAccessToken(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const token = (value as { access_token?: unknown }).access_token
  return typeof token === 'string' && token.length > 0 ? token : null
}

export async function createGoogleAccessToken(
  clientEmail: string,
  privateKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' })
  const claims = base64UrlJson({
    iss: clientEmail,
    sub: clientEmail,
    aud: GOOGLE_TOKEN_AUDIENCE,
    scope: GOOGLE_DATASTORE_SCOPE,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  })
  const unsignedJwt = `${header}.${claims}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedJwt),
  )
  const assertion = `${unsignedJwt}.${base64UrlBytes(new Uint8Array(signature))}`
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('Google access token request failed')
  const accessToken = readAccessToken(await response.json())
  if (!accessToken) throw new Error('Google access token response is invalid')
  return accessToken
}
