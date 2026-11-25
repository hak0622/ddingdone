import type {
  FirestoreRecord,
  MeetingSource,
  WithdrawalPreview,
  WithdrawalRequestStatus,
} from './types'

const MAX_MEETINGS = 100
const MAX_CHILD_COLLECTIONS = 100
const PAGE_SIZE = 300
const MAX_CLEANUP_DOCUMENTS_PER_COLLECTION = 240
function firestoreApi(projectId: string) {
  return projectId === 'demo-ddingdone' ? 'http://127.0.0.1:8080/v1' : 'https://firestore.googleapis.com/v1'
}
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

type FirestorePrecondition = { exists: boolean } | { updateTime: string }

export type FirestoreWrite = {
  update?: FirestoreDocument
  updateMask?: { fieldPaths: string[] }
  currentDocument?: FirestorePrecondition
  delete?: string
}

export class FirestoreError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'FirestoreError'
  }
}

function documentBase(projectId: string): string {
  return `${firestoreApi(projectId)}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`
}

function documentName(projectId: string, documentPath: string): string {
  return `projects/${projectId}/databases/(default)/documents/${documentPath}`
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

export function updateWrite(
  projectId: string,
  documentPath: string,
  data: Record<string, unknown>,
  fieldPaths: string[],
  currentDocument?: FirestorePrecondition,
): FirestoreWrite {
  return {
    update: { name: documentName(projectId, documentPath), fields: encodeFields(data) },
    updateMask: { fieldPaths },
    ...(currentDocument ? { currentDocument } : {}),
  }
}

export function deleteWrite(
  projectId: string,
  documentPath: string,
  currentDocument?: FirestorePrecondition,
): FirestoreWrite {
  return {
    delete: documentName(projectId, documentPath),
    ...(currentDocument ? { currentDocument } : {}),
  }
}

export async function commitWrites(
  projectId: string,
  accessToken: string,
  writes: FirestoreWrite[],
  errorCode: string,
  transaction?: string,
): Promise<void> {
  if (writes.length === 0 && !transaction) return
  const response = await fetch(
    `${firestoreApi(projectId)}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`,
    {
      method: 'POST',
      headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes, ...(transaction ? { transaction } : {}) }),
      signal: requestSignal(),
    },
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new FirestoreError(response.status === 409 && errorCode === 'ROOM_COMMIT_FAILED' ? 'ROOM_CHANGED' : errorCode)
  }
  await response.body?.cancel()
}

export async function beginFirestoreTransaction(
  projectId: string,
  accessToken: string,
): Promise<string> {
  const response = await fetch(
    `${firestoreApi(projectId)}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:beginTransaction`,
    {
      method: 'POST',
      headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { readWrite: {} } }),
      signal: requestSignal(),
    },
  )
  const json = await readJson(response, 'TRANSACTION_BEGIN_FAILED')
  const transaction = json && typeof json === 'object'
    ? (json as { transaction?: unknown }).transaction
    : null
  if (typeof transaction !== 'string' || transaction.length === 0) {
    throw new FirestoreError('INVALID_TRANSACTION_RESPONSE')
  }
  return transaction
}

export async function rollbackFirestoreTransaction(
  projectId: string,
  accessToken: string,
  transaction: string,
): Promise<void> {
  const response = await fetch(
    `${firestoreApi(projectId)}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:rollback`,
    {
      method: 'POST',
      headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction }),
      signal: requestSignal(),
    },
  )
  if (!response.ok) throw new FirestoreError('TRANSACTION_ROLLBACK_FAILED')
  await response.body?.cancel()
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

async function queryExpiredDocuments(
  projectId: string,
  collectionId: 'withdrawalManifests' | 'withdrawalRequests',
  accessToken: string,
  now: Date,
): Promise<FirestoreRecord[]> {
  const response = await fetch(`${documentBase(projectId)}:runQuery`, {
    method: 'POST',
    headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'expiresAt' },
            op: 'LESS_THAN_OR_EQUAL',
            value: { timestampValue: now.toISOString() },
          },
        },
        orderBy: [{ field: { fieldPath: 'expiresAt' }, direction: 'ASCENDING' }],
        limit: MAX_CLEANUP_DOCUMENTS_PER_COLLECTION,
      },
    }),
    signal: requestSignal(),
  })
  return asRunQueryDocuments(await readJson(response, 'CLEANUP_QUERY_FAILED'))
}

function isExpired(record: FirestoreRecord, now: Date): boolean {
  const expiresAt = record.data.expiresAt
  if (typeof expiresAt !== 'string') return false
  const expiresAtMs = Date.parse(expiresAt)
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime()
}

function isSafeExpiredManifest(record: FirestoreRecord, now: Date): boolean {
  return record.data.status === 'previewed' && isExpired(record, now)
}

function isSafeExpiredRequest(record: FirestoreRecord, now: Date): boolean {
  return record.data.status === 'complete' &&
    record.data.stage === 'complete' &&
    record.data.uid === undefined &&
    record.data.manifestId === undefined &&
    record.data.preview === undefined &&
    record.data.successorByMeeting === undefined &&
    isExpired(record, now)
}

async function deleteCleanupDocuments(
  projectId: string,
  collectionId: 'withdrawalManifests' | 'withdrawalRequests',
  accessToken: string,
  records: FirestoreRecord[],
): Promise<void> {
  await commitWrites(projectId, accessToken, records.map((record) => deleteWrite(
    projectId,
    `${collectionId}/${encodeURIComponent(record.id)}`,
    // 조회 뒤 같은 ID로 새 문서가 생성되거나 상태가 바뀌면 삭제하지 않는다.
    { updateTime: record.updateTime! },
  )), 'CLEANUP_DELETE_FAILED')
}

export interface WithdrawalCleanupResult {
  scannedManifestCount: number
  scannedRequestCount: number
  deletedManifestCount: number
  deletedRequestCount: number
  skippedManifestCount: number
  skippedRequestCount: number
}

export async function cleanupExpiredWithdrawalMetadata(
  projectId: string,
  accessToken: string,
  now: Date,
): Promise<WithdrawalCleanupResult> {
  const [manifests, requests] = await Promise.all([
    queryExpiredDocuments(projectId, 'withdrawalManifests', accessToken, now),
    queryExpiredDocuments(projectId, 'withdrawalRequests', accessToken, now),
  ])
  const safeManifests = manifests.filter((record) =>
    Boolean(record.updateTime) && isSafeExpiredManifest(record, now))
  const safeRequests = requests.filter((record) =>
    Boolean(record.updateTime) && isSafeExpiredRequest(record, now))

  // 컬렉션별로 커밋해 한쪽의 동시 변경이 다른 쪽 정리까지 막지 않게 한다.
  await deleteCleanupDocuments(
    projectId,
    'withdrawalManifests',
    accessToken,
    safeManifests,
  )
  await deleteCleanupDocuments(
    projectId,
    'withdrawalRequests',
    accessToken,
    safeRequests,
  )

  return {
    scannedManifestCount: manifests.length,
    scannedRequestCount: requests.length,
    deletedManifestCount: safeManifests.length,
    deletedRequestCount: safeRequests.length,
    skippedManifestCount: manifests.length - safeManifests.length,
    skippedRequestCount: requests.length - safeRequests.length,
  }
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

export async function queryRoomRecords(
  projectId: string, accessToken: string, collectionId: string,
  fieldPath: string, value: string | boolean, allDescendants = false,
): Promise<FirestoreRecord[]> {
  const response = await fetch(`${documentBase(projectId)}:runQuery`, {
    method: 'POST',
    headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId, allDescendants }],
      where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: encodeValue(value) } },
      limit: MAX_MEETINGS + 1,
    } }),
    signal: requestSignal(),
  })
  const records = asRunQueryDocuments(await readJson(response, 'ROOM_QUERY_FAILED'))
  if (records.length > MAX_MEETINGS) throw new FirestoreError('MEETING_LIMIT_EXCEEDED')
  return records
}

export async function readRoomCollection(
  projectId: string, accessToken: string, parentPath: string, collectionId: string,
  transaction: string, limit: number, namesOnly = false,
): Promise<FirestoreRecord[]> {
  const response = await fetch(`${documentBase(projectId)}/${parentPath}:runQuery`, {
    method: 'POST',
    headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction, structuredQuery: {
      from: [{ collectionId }], limit,
      ...(namesOnly ? { select: { fields: [{ fieldPath: '__name__' }] } } : {}),
    } }),
    signal: requestSignal(),
  })
  return asRunQueryDocuments(await readJson(response, 'ROOM_COLLECTION_QUERY_FAILED'))
}

async function getDocument(
  projectId: string,
  documentPath: string,
  accessToken: string,
  transaction?: string,
): Promise<FirestoreRecord | null> {
  const url = new URL(`${documentBase(projectId)}/${documentPath}`)
  if (transaction) url.searchParams.set('transaction', transaction)
  const response = await fetch(url, {
    headers: authorization(accessToken),
    signal: requestSignal(),
  })
  if (response.status === 404) return null
  const json = await readJson(response, 'DOCUMENT_GET_FAILED')
  if (!json || typeof json !== 'object') throw new FirestoreError('INVALID_DOCUMENT_RESPONSE')
  return decodeDocument(json as FirestoreDocument)
}

export async function getFirestoreDocument(
  projectId: string,
  documentPath: string,
  accessToken: string,
  transaction?: string,
): Promise<FirestoreRecord | null> {
  return getDocument(projectId, documentPath, accessToken, transaction)
}

export async function batchGetRoomDocuments(
  projectId: string, paths: string[], accessToken: string, transaction: string,
): Promise<Array<FirestoreRecord | null>> {
  if (!paths.length) return []
  const names = paths.map((path) => documentName(projectId, path))
  const response = await fetch(`${documentBase(projectId)}:batchGet`, {
    method: 'POST',
    headers: { ...authorization(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: names, transaction }),
    signal: requestSignal(),
  })
  const rows = await readJson(response, 'ROOM_DOCUMENT_QUERY_FAILED')
  if (!Array.isArray(rows)) throw new FirestoreError('INVALID_DOCUMENT_RESPONSE')
  const found = new Map<string, FirestoreRecord | null>()
  for (const row of rows as Array<{ found?: FirestoreDocument; missing?: string }>) {
    if (row.found?.name) found.set(row.found.name, decodeDocument(row.found))
    else if (row.missing) found.set(row.missing, null)
  }
  return names.map((name) => {
    const result = found.get(name)
    if (result === undefined) throw new FirestoreError('INVALID_DOCUMENT_RESPONSE')
    return result
  })
}

export async function listChildCollectionIds(
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
    if (meeting.data.participantModelVersion !== 2) throw new FirestoreError('ROOM_VERSION_NOT_SUPPORTED')
    const childCollectionIds = await listChildCollectionIds(projectId, `meetings/${encodeURIComponent(meeting.id)}`, accessToken)
    return { meeting, members: [], expenses: [], settlement: null, settlementDocuments: [], childCollectionIds }
  })
}

export async function listMeetingIdsForUser(
  projectId: string,
  uid: string,
  accessToken: string,
): Promise<string[]> {
  return (await queryMeetings(projectId, uid, accessToken)).map((meeting) => meeting.id)
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

export async function claimWithdrawalRequest(
  projectId: string,
  accessToken: string,
  input: {
    manifest: FirestoreRecord
    uid: string
    requestId: string
    statusTokenHash: string
    successorByMeeting: Record<string, string>
    now: Date
  },
): Promise<void> {
  if (!input.manifest.updateTime) throw new FirestoreError('INVALID_MANIFEST_VERSION')
  const requestPath = `withdrawalRequests/${input.requestId}`
  const lockPath = `withdrawalLocks/${input.uid}`
  const manifestPath = `withdrawalManifests/${input.manifest.id}`
  await commitWrites(projectId, accessToken, [
    updateWrite(projectId, manifestPath, {
      status: 'queued',
      requestId: input.requestId,
      claimedAt: input.now,
    }, ['status', 'requestId', 'claimedAt'], { updateTime: input.manifest.updateTime }),
    updateWrite(projectId, requestPath, {
      schemaVersion: 1,
      uid: input.uid,
      manifestId: input.manifest.id,
      manifestHash: input.manifest.data.manifestHash,
      sourceHash: input.manifest.data.sourceHash,
      preview: input.manifest.data.preview,
      successorByMeeting: input.successorByMeeting,
      statusTokenHash: input.statusTokenHash,
      status: 'queued',
      stage: 'queued',
      createdAt: input.now,
      updatedAt: input.now,
      expiresAt: new Date(input.now.getTime() + 30 * 24 * 60 * 60 * 1000),
    }, [
      'schemaVersion', 'uid', 'manifestId', 'manifestHash', 'sourceHash', 'preview',
      'successorByMeeting', 'statusTokenHash', 'status', 'stage', 'createdAt', 'updatedAt', 'expiresAt',
    ], { exists: false }),
    updateWrite(projectId, lockPath, {
      requestId: input.requestId,
      status: 'queued',
      createdAt: input.now,
      updatedAt: input.now,
    }, ['requestId', 'status', 'createdAt', 'updatedAt'], { exists: false }),
  ], 'WITHDRAWAL_CLAIM_FAILED')
}

export async function updateWithdrawalRequestStatus(
  projectId: string,
  accessToken: string,
  requestId: string,
  status: WithdrawalRequestStatus,
  stage: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date()
  const data = { status, stage, updatedAt: now, ...extra }
  await commitWrites(projectId, accessToken, [
    updateWrite(
      projectId,
      `withdrawalRequests/${requestId}`,
      data,
      Object.keys(data),
      { exists: true },
    ),
  ], 'REQUEST_STATUS_UPDATE_FAILED')
}

export async function setWithdrawalLockStatus(
  projectId: string,
  accessToken: string,
  uid: string,
  requestId: string,
  status: string,
): Promise<void> {
  await commitWrites(projectId, accessToken, [
    updateWrite(projectId, `withdrawalLocks/${uid}`, {
      requestId,
      status,
      updatedAt: new Date(),
    }, ['requestId', 'status', 'updatedAt'], { exists: true }),
  ], 'ACCOUNT_LOCK_UPDATE_FAILED')
}

export async function markWithdrawalProcessing(
  projectId: string,
  accessToken: string,
  uid: string,
  requestId: string,
): Promise<void> {
  const now = new Date()
  await commitWrites(projectId, accessToken, [
    updateWrite(projectId, `withdrawalRequests/${requestId}`, {
      status: 'processing',
      stage: 'processing-meetings',
      updatedAt: now,
    }, ['status', 'stage', 'updatedAt'], { exists: true }),
    updateWrite(projectId, `withdrawalLocks/${uid}`, {
      requestId,
      status: 'processing',
      updatedAt: now,
    }, ['requestId', 'status', 'updatedAt'], { exists: true }),
  ], 'WITHDRAWAL_PROCESSING_UPDATE_FAILED')
}

export async function releaseWithdrawalAccountLock(
  projectId: string,
  accessToken: string,
  uid: string,
  requestId: string,
): Promise<void> {
  const accountLock = await getDocument(
    projectId,
    `withdrawalLocks/${encodeURIComponent(uid)}`,
    accessToken,
  )
  const writes: FirestoreWrite[] = []
  if (accountLock?.updateTime && accountLock.data.requestId === requestId) {
    writes.push(deleteWrite(
      projectId,
      `withdrawalLocks/${uid}`,
      { updateTime: accountLock.updateTime },
    ))
  }
  await commitWrites(projectId, accessToken, writes, 'LOCK_RELEASE_FAILED')
}

export async function markWorkflowCreationFailed(
  projectId: string,
  accessToken: string,
  uid: string,
  requestId: string,
  manifestId: string,
): Promise<void> {
  await updateWithdrawalRequestStatus(
    projectId,
    accessToken,
    requestId,
    'failed',
    'workflow-create-failed',
    { errorCode: 'WORKFLOW_CREATE_FAILED' },
  )
  await releaseWithdrawalAccountLock(projectId, accessToken, uid, requestId)
  await commitWrites(projectId, accessToken, [
    updateWrite(projectId, `withdrawalManifests/${manifestId}`, {
      status: 'previewed',
    }, ['status'], { exists: true }),
  ], 'MANIFEST_RESET_FAILED')
}

export async function finalizeWithdrawalMetadata(
  projectId: string,
  accessToken: string,
  uid: string,
  requestId: string,
  manifestId: string,
): Promise<void> {
  const now = new Date()
  await commitWrites(projectId, accessToken, [
    // 상태 조회에 필요한 statusTokenHash만 남기고 UID·닉네임·후임 UID가 포함된
    // 처리 원본은 완료 즉시 제거한다. updateMask에 넣고 fields에서 생략한 필드는 삭제된다.
    updateWrite(projectId, `withdrawalRequests/${requestId}`, {
      status: 'complete',
      stage: 'complete',
      updatedAt: now,
      completedAt: now,
    }, [
      'uid', 'manifestId', 'manifestHash', 'sourceHash', 'preview', 'successorByMeeting',
      'status', 'stage', 'updatedAt', 'completedAt', 'scopeMeetingId', 'scopeMeetingName',
      'scopeRevision', 'approvedScopeRevision',
    ], { exists: true }),
    deleteWrite(projectId, `withdrawalManifests/${manifestId}`),
    deleteWrite(projectId, `withdrawalLocks/${uid}`),
  ], 'WITHDRAWAL_FINALIZE_FAILED')
}
