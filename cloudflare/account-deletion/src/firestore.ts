import type { FirestoreRecord, MeetingSource, WithdrawalPreview } from './types'

const MAX_MEETINGS = 100
const MAX_MEMBERS_PER_MEETING = 500
const MAX_EXPENSES_PER_MEETING = 5_000
const MAX_CHILD_COLLECTIONS = 100
const PAGE_SIZE = 300
const FIRESTORE_API = 'https://firestore.googleapis.com/v1'
const EXTERNAL_REQUEST_TIMEOUT_MS = 10_000

type FirestoreValue = {
  nullValue?: null
  booleanValue?: boolean
  integerValue?: string
  doubleValue?: number
  timestampValue?: string
  stringValue?: string
  bytesValue?: string
  referenceValue?: string
  geoPointValue?: { latitude?: number; longitude?: number }
  arrayValue?: { values?: FirestoreValue[] }
  mapValue?: { fields?: Record<string, FirestoreValue> }
}

interface FirestoreDocument {
  name?: string
  fields?: Record<string, FirestoreValue>
  createTime?: string
  updateTime?: string
}

export class FirestoreError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'FirestoreError'
  }
}

function documentBase(projectId: string): string {
  return `${FIRESTORE_API}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`
}

function authorization(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` }
}

function requestSignal(): AbortSignal {
  return AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS)
}

async function readJson(response: Response, errorCode: string): Promise<unknown> {
  if (!response.ok) throw new FirestoreError(errorCode)
  return response.json()
}

function decodeValue(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null
  if (typeof value.booleanValue === 'boolean') return value.booleanValue
  if (typeof value.integerValue === 'string') return Number(value.integerValue)
  if (typeof value.doubleValue === 'number') return value.doubleValue
  if (typeof value.timestampValue === 'string') return value.timestampValue
  if (typeof value.stringValue === 'string') return value.stringValue
  if (typeof value.bytesValue === 'string') return value.bytesValue
  if (typeof value.referenceValue === 'string') return value.referenceValue
  if (value.geoPointValue) return {
    latitude: value.geoPointValue.latitude ?? 0,
    longitude: value.geoPointValue.longitude ?? 0,
  }
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decodeValue)
  if (value.mapValue) return decodeFields(value.mapValue.fields ?? {})
  return null
}

function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) result[key] = decodeValue(value)
  return result
}

function decodeDocument(document: FirestoreDocument): FirestoreRecord {
  if (!document.name) throw new FirestoreError('INVALID_DOCUMENT')
  return {
    id: document.name.slice(document.name.lastIndexOf('/') + 1),
    data: decodeFields(document.fields ?? {}),
    ...(document.createTime ? { createTime: document.createTime } : {}),
    ...(document.updateTime ? { updateTime: document.updateTime } : {}),
  }
}

function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new FirestoreError('INVALID_NUMBER')
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (value && typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {}
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) fields[key] = encodeValue(child)
    }
    return { mapValue: { fields } }
  }
  throw new FirestoreError('UNSUPPORTED_VALUE')
}

function encodeFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) fields[key] = encodeValue(value)
  }
  return fields
}

function asRunQueryDocuments(value: unknown): FirestoreRecord[] {
  if (!Array.isArray(value)) throw new FirestoreError('INVALID_QUERY_RESPONSE')
  const documents: FirestoreRecord[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const document = (item as { document?: FirestoreDocument }).document
    if (document) documents.push(decodeDocument(document))
  }
  return documents
}

async function queryMeetings(
  projectId: string,
  uid: string,
  accessToken: string,
): Promise<FirestoreRecord[]> {
  const response = await fetch(`${documentBase(projectId)}:runQuery`, {
    method: 'POST',
    headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'meetings' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'memberUids' },
            op: 'ARRAY_CONTAINS',
            value: { stringValue: uid },
          },
        },
        limit: MAX_MEETINGS + 1,
      },
    }),
    signal: requestSignal(),
  })
  const documents = asRunQueryDocuments(await readJson(response, 'MEETING_QUERY_FAILED'))
  if (documents.length > MAX_MEETINGS) throw new FirestoreError('MEETING_LIMIT_EXCEEDED')
  return documents.sort((left, right) => left.id.localeCompare(right.id))
}

async function listDocuments(
  projectId: string,
  parentPath: string,
  collectionId: string,
  accessToken: string,
  maximumDocuments: number,
): Promise<FirestoreRecord[]> {
  const documents: FirestoreRecord[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(`${documentBase(projectId)}/${parentPath}/${collectionId}`)
    url.searchParams.set('pageSize', String(PAGE_SIZE))
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetch(url, {
      headers: authorization(accessToken),
      signal: requestSignal(),
    })
    const json = await readJson(response, 'SUBCOLLECTION_QUERY_FAILED')
    if (!json || typeof json !== 'object') throw new FirestoreError('INVALID_LIST_RESPONSE')
    const body = json as { documents?: FirestoreDocument[]; nextPageToken?: unknown }
    for (const document of body.documents ?? []) documents.push(decodeDocument(document))
    if (documents.length > maximumDocuments) throw new FirestoreError('DOCUMENT_LIMIT_EXCEEDED')
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined
  } while (pageToken)
  return documents
}

async function getDocument(
  projectId: string,
  documentPath: string,
  accessToken: string,
): Promise<FirestoreRecord | null> {
  const response = await fetch(`${documentBase(projectId)}/${documentPath}`, {
    headers: authorization(accessToken),
    signal: requestSignal(),
  })
  if (response.status === 404) return null
  const json = await readJson(response, 'DOCUMENT_GET_FAILED')
  if (!json || typeof json !== 'object') throw new FirestoreError('INVALID_DOCUMENT_RESPONSE')
  return decodeDocument(json as FirestoreDocument)
}

async function listChildCollectionIds(
  projectId: string,
  documentPath: string,
  accessToken: string,
): Promise<string[]> {
  const ids = new Set<string>()
  let pageToken: string | undefined
  do {
    const response = await fetch(`${documentBase(projectId)}/${documentPath}:listCollectionIds`, {
      method: 'POST',
      headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageSize: PAGE_SIZE, ...(pageToken ? { pageToken } : {}) }),
      signal: requestSignal(),
    })
    const json = await readJson(response, 'COLLECTION_LIST_FAILED')
    if (!json || typeof json !== 'object') throw new FirestoreError('INVALID_COLLECTION_LIST_RESPONSE')
    const body = json as { collectionIds?: unknown; nextPageToken?: unknown }
    if (Array.isArray(body.collectionIds)) {
      for (const id of body.collectionIds) if (typeof id === 'string') ids.add(id)
    }
    if (ids.size > MAX_CHILD_COLLECTIONS) throw new FirestoreError('DOCUMENT_LIMIT_EXCEEDED')
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined
  } while (pageToken)
  return [...ids].sort()
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      const value = values[index]
      if (value !== undefined) result[index] = await mapper(value)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return result
}

export async function loadMeetingSources(
  projectId: string,
  uid: string,
  accessToken: string,
): Promise<MeetingSource[]> {
  const meetings = await queryMeetings(projectId, uid, accessToken)
  return mapWithConcurrency(meetings, 5, async (meeting) => {
    const parentPath = `meetings/${encodeURIComponent(meeting.id)}`
    const [members, expenses, settlement, childCollectionIds] = await Promise.all([
      listDocuments(projectId, parentPath, 'members', accessToken, MAX_MEMBERS_PER_MEETING),
      listDocuments(projectId, parentPath, 'expenses', accessToken, MAX_EXPENSES_PER_MEETING),
      getDocument(projectId, `${parentPath}/settlements/final`, accessToken),
      listChildCollectionIds(projectId, parentPath, accessToken),
    ])
    return { meeting, members, expenses, settlement, childCollectionIds }
  })
}

export async function createWithdrawalManifest(
  projectId: string,
  manifestId: string,
  accessToken: string,
  manifest: {
    uid: string
    manifestHash: string
    sourceHash: string
    confirmationNonceHash: string
    preview: WithdrawalPreview
    createdAt: Date
    expiresAt: Date
  },
): Promise<void> {
  const url = new URL(`${documentBase(projectId)}/withdrawalManifests/${encodeURIComponent(manifestId)}`)
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: encodeFields({
        schemaVersion: 1,
        uid: manifest.uid,
        status: 'previewed',
        manifestHash: manifest.manifestHash,
        sourceHash: manifest.sourceHash,
        confirmationNonceHash: manifest.confirmationNonceHash,
        preview: manifest.preview,
        createdAt: manifest.createdAt,
        expiresAt: manifest.expiresAt,
      }),
    }),
    signal: requestSignal(),
  })
  if (!response.ok) throw new FirestoreError('MANIFEST_CREATE_FAILED')
  await response.body?.cancel()
}
