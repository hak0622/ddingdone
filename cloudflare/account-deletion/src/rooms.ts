import { splitExpense } from '../../../src/utils/expenseShares'
import {
  type MeetingParticipant, type MeetingParticipants,
} from '../../../src/utils/meetingParticipants'
import { buildV2SettlementSnapshot, hashSettlementSnapshot } from '../../../src/utils/settlementSnapshot'
import { sha256Hex, stableStringify } from './crypto'
import {
  FirestoreError, batchGetRoomDocuments, beginFirestoreTransaction, commitWrites, deleteWrite, readRoomCollection, getFirestoreDocument,
  listChildCollectionIds, queryRoomRecords, rollbackFirestoreTransaction,
  updateWrite, type FirestoreWrite,
} from './firestore'
import type { FirestoreRecord } from './types'

export const CURRENT_PARTICIPANT_MODEL = 2

export function isCurrentRoom(room: FirestoreRecord) {
  return room.data.participantModelVersion === CURRENT_PARTICIPANT_MODEL
}
export const ROOM_COLLECTIONS = ['participants', 'participantLinks', 'expenses', 'settlements', 'photos']
const CATEGORY_NAMES = ['식비', '카페', '숙소', '교통', '기타']

export class RoomError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code) }
}

export function memberUids(room: FirestoreRecord): string[] {
  const value = room.data.memberUids
  if (!Array.isArray(value) || value.some((uid) => typeof uid !== 'string')) throw new RoomError('INVALID_ROOM_DATA')
  return value
}

function key(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value)
}

export interface RoomStore {
  read(path: string): Promise<FirestoreRecord | null>
  readMany(paths: string[]): Promise<Array<FirestoreRecord | null>>
  list(collection: string, limit?: number): Promise<FirestoreRecord[]>
  write(path: string, data: Record<string, unknown>, exists?: boolean, fields?: string[]): void
  remove(path: string): void
  page(collection: string): Promise<{ records: FirestoreRecord[]; hasMore: boolean }>
  collections(): Promise<string[]>
}
export async function withRoomTransaction<T>(
  project: string, token: string, meetingId: string, run: (store: RoomStore, path: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runRoomTransaction(project, token, meetingId, run)
    } catch (error) {
      if (!(error instanceof FirestoreError) || error.code !== 'ROOM_CHANGED' || attempt === 4) throw error
      const jitter = crypto.getRandomValues(new Uint8Array(1))[0]!
      await new Promise((resolve) => setTimeout(resolve, (100 + jitter) * 2 ** attempt))
    }
  }
}

async function runRoomTransaction<T>(
  project: string, token: string, meetingId: string, run: (store: RoomStore, path: string) => Promise<T>,
): Promise<T> {
  const path = `meetings/${meetingId}`
  const transaction = await beginFirestoreTransaction(project, token)
  const writes: FirestoreWrite[] = []
  const readMany = (documents: string[]) => batchGetRoomDocuments(project, documents, token, transaction)
  const store: RoomStore = {
    read: async (document) => (await readMany([document]))[0] ?? null,
    readMany,
    list: async (collection, limit = 450) => {
      const records = await readRoomCollection(project, token, path, collection, transaction, limit + 1)
      if (records.length > limit) throw new RoomError('ROOM_DOCUMENT_LIMIT')
      return records
    },
    write: (document, data, exists, fields = Object.keys(data)) => {
      writes.push(updateWrite(project, document, data, fields, exists === undefined ? undefined : { exists }))
    },
    remove: (document) => { writes.push(deleteWrite(project, document)) },
    page: async (collection) => {
      const records = await readRoomCollection(project, token, path, collection, transaction, 101, true)
      return { records: records.slice(0, 100), hasMore: records.length > 100 }
    },
    collections: () => listChildCollectionIds(project, path, token),
  }
  try {
    const result = await run(store, path)
    if (writes.length > 500) throw new RoomError('ROOM_WRITE_LIMIT')
    if (writes.length) await commitWrites(project, token, writes, 'ROOM_COMMIT_FAILED', transaction)
    else await rollbackFirestoreTransaction(project, token, transaction)
    return result
  } catch (error) {
    await rollbackFirestoreTransaction(project, token, transaction).catch(() => {})
    throw error
  }
}

function roomParticipant(record: FirestoreRecord | null): MeetingParticipant {
  const data = record?.data
  if (data?.status !== 'active' || typeof data.name !== 'string') throw new RoomError('INVALID_PARTICIPANT')
  return { status: 'active', name: data.name, departureVersion: 0 }
}

export function participantLinkId(link: FirestoreRecord | null): string {
  if (!key(link?.data.participantId)) throw new RoomError('PARTICIPANT_LINK_MISSING')
  return link.data.participantId
}

export async function closeRoom(store: RoomStore, path: string, room: FirestoreRecord) {
  const collections = await store.collections()
  if (collections.some((collection) => !ROOM_COLLECTIONS.includes(collection))) throw new RoomError('UNKNOWN_CHILD_COLLECTION')
  const pages = await Promise.all(collections.map((collection) => store.page(collection)))
  const complete = pages.every((page) => !page.hasMore) &&
    pages.reduce((count, page) => count + page.records.length, 0) <= 498
  if (room.data.photoPublicId != null || room.data.photoUrl != null) throw new RoomError('PHOTO_REFERENCE_NOT_RETIRED')
  if (complete) {
    pages.forEach((page, index) => page.records.forEach(({ id }) => store.remove(`${path}/${collections[index]}/${id}`)))
    store.remove(path)
  } else if (!room.data.roomCleanupPending) {
    store.write(path, { memberUids: [], roomCleanupPending: true })
  } else {
    // Leave account links discoverable until the remaining child records can be deleted together.
    const removable = pages.flatMap((page, index) => page.records
      .filter(() => collections[index] !== 'participantLinks')
      .map(({ id }) => `${path}/${collections[index]}/${id}`))
    if (!removable.length) {
      const index = collections.indexOf('participantLinks')
      pages[index]?.records.forEach(({ id }) => store.remove(`${path}/participantLinks/${id}`))
    } else removable.slice(0, 400).forEach((document) => store.remove(document))
  }
  return complete
}

export async function cleanupClosedRooms(project: string, token: string) {
  const rooms = await queryRoomRecords(project, token, 'meetings', 'roomCleanupPending', true)
  for (const { id } of rooms.slice(0, 5)) {
    await withRoomTransaction(project, token, id, async (store, path) => {
      const latest = await store.read(path)
      if (latest?.data.roomCleanupPending === true) await closeRoom(store, path, latest)
    })
  }
}

export async function departRoom(
  store: RoomStore, path: string, room: FirestoreRecord, uid: string,
  reason: 'leave' | 'withdraw', expectedVersion?: unknown, approvedSolo?: boolean,
) {
  const linkPath = `${path}/participantLinks/${uid}`
  const link = await store.read(linkPath)
  if (!link) {
    if (memberUids(room).includes(uid)) throw new RoomError('PARTICIPANT_LINK_MISSING')
    return { departed: true }
  }
  if (room.data.roomCleanupPending && reason === 'withdraw') {
    store.remove(linkPath)
    return { departed: true }
  }
  const participantPath = `${path}/participants/${participantLinkId(link)}`
  if (reason === 'leave' && expectedVersion !== participantLinkId(link)) throw new RoomError('ROOM_CHANGED')
  const members = memberUids(room)
  if (!members.includes(uid)) throw new RoomError('INVALID_ROOM_DATA')
  const remaining = members.filter((member) => member !== uid)
  if (!remaining.length && approvedSolo === false) throw new RoomError('DELETION_SCOPE_CHANGED')
  if (!remaining.length) {
    if (await closeRoom(store, path, room)) return { departed: true }
  } else {
    store.write(path, { memberUids: remaining }, true)
  }
  store.remove(linkPath)
  store.remove(participantPath)
  return { departed: true, cleanupPending: !remaining.length }

}

export async function joinRoom(store: RoomStore, path: string, room: FirestoreRecord, uid: string, body: Record<string, unknown>) {
  if (room.data.status !== 'active') throw new RoomError('ROOM_SETTLED')
  const linkPath = `${path}/participantLinks/${uid}`
  const link = await store.read(linkPath)
  const members = memberUids(room)
  if (members.includes(uid)) return { participantId: participantLinkId(link) }
  if (link) throw new RoomError('INVALID_ROOM_DATA')
  const participantId = crypto.randomUUID()
  store.write(linkPath, { participantId }, false)
  store.write(`${path}/participants/${participantId}`, { name: roomText(body.nickname, 20), status: 'active' }, false)
  store.write(path, { memberUids: [...members, uid] }, true)
  return { participantId }

}

function roomText(value: unknown, limit: number, optional = false): string {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > limit) {
    throw new RoomError('INVALID_ROOM_INPUT', 400)
  }
  return value.trim()
}

export async function createRoom(project: string, token: string, uid: string, body: Record<string, unknown>) {
  const { roomId } = body
  if (!key(roomId) || !/^[0-9a-f-]{36}$/u.test(roomId)) throw new RoomError('INVALID_ROOM_INPUT', 400)
  const name = roomText(body.name, 11)
  const date = roomText(body.date, 10)
  if (!/^\d{4}\.\d{2}\.\d{2}$/u.test(date)) throw new RoomError('INVALID_ROOM_INPUT', 400)
  const memo = roomText(body.memo, 16, true)
  const nickname = roomText(body.nickname, 20)
  return withRoomTransaction(project, token, roomId, async (store, path) => {
    const [room, lock, member] = await store.readMany([path, `withdrawalLocks/${uid}`, `${path}/participantLinks/${uid}`])
    if (lock) throw new RoomError('WITHDRAWAL_IN_PROGRESS')
    if (room) {
      if (isCurrentRoom(room) && !room.data.roomCleanupPending && member && memberUids(room).includes(uid)) return { roomId }
      throw new RoomError('ROOM_CHANGED')
    }
    const participantId = crypto.randomUUID()
    store.write(path, {
      participantModelVersion: CURRENT_PARTICIPANT_MODEL, name, date, memo,
      createdAt: new Date(), status: 'active', memberUids: [uid], totalAmount: 0,
    }, false)
    store.write(`${path}/participants/${participantId}`, { name: nickname, status: 'active' }, false)
    store.write(`${path}/participantLinks/${uid}`, { participantId }, false)
    return { roomId }
  })
}

export async function changeExpense(store: RoomStore, path: string, room: FirestoreRecord, actor: string, body: Record<string, unknown>) {
  const { expenseId, action } = body
  if (!key(expenseId) || (action !== 'create' && action !== 'edit' && action !== 'delete')) {
    throw new RoomError('INVALID_EXPENSE', 400)
  }
  const selected = body.participantIds
  if (action !== 'delete' && (!Array.isArray(selected) || !selected.length || selected.length > 500 ||
      !selected.every(key) || new Set(selected).size !== selected.length ||
      !Number.isSafeInteger(body.amount) || Number(body.amount) < 1 || Number(body.amount) > 9999999 ||
      typeof body.memo !== 'string' || body.memo.length > 200 ||
      typeof body.category !== 'string' || !CATEGORY_NAMES.includes(body.category) || !key(body.requestId))) throw new RoomError('INVALID_EXPENSE', 400)
  let creationHash: string | undefined
  if (action === 'create') {
    if (body.requestId !== expenseId) throw new RoomError('EXPENSE_REQUEST_CONFLICT')
    creationHash = await sha256Hex(stableStringify({
      expenseId, actor, amount: body.amount, category: body.category, memo: body.memo, participantIds: selected,
    }))
  }
  const expensePath = `${path}/expenses/${expenseId}`
  const existing = await store.read(expensePath)
  if (action === 'create' && existing) {
    if (existing.data.creationKey === body.requestId && existing.data.creationHash === creationHash) return { expenseId }
    throw new RoomError('EXPENSE_REQUEST_CONFLICT')
  }
  if (action === 'delete' && (!existing || existing.data.deleted === true)) return { expenseId }
  if (action === 'create' ? existing : !existing || existing.data.createdBy !== actor) throw new RoomError('EXPENSE_FORBIDDEN', 403)
  if (existing && !Array.isArray(existing.data.shares)) throw new RoomError('EXPENSE_LOCKED')
  if (existing && existing.data.revision !== body.revision) throw new RoomError('EXPENSE_CHANGED')
  const paidBy = existing?.data.paidBy ?? actor
  if (!key(paidBy)) throw new RoomError('INVALID_EXPENSE')
  const oldIds = [paidBy, ...((existing?.data.shares ?? []) as Array<{ participantId: string }>).map(({ participantId }) => participantId)]
  const ids = [...new Set([paidBy, ...oldIds, ...(action !== 'delete' ? selected as string[] : [])])]
  const records = await store.readMany(ids.map((id) => `${path}/participants/${id}`))
  const participants: MeetingParticipants = Object.fromEntries(ids.flatMap((id, index) =>
    !records[index] ? [] : [[id, roomParticipant(records[index] ?? null)]]))
  if (oldIds.some((id) => participants[id]?.status !== 'active')) throw new RoomError('EXPENSE_LOCKED')
  const oldAmount = Number(existing?.data.amount ?? 0)
  const newAmount = action === 'delete' ? 0 : Number(body.amount)
  if (action === 'delete' && existing) {
      store.write(expensePath, {
        deleted: true, creationKey: existing.data.creationKey,
        ...(typeof existing.data.creationHash === 'string' ? { creationHash: existing.data.creationHash } : {}),
      }, true,
        [...new Set([...Object.keys(existing.data), 'deleted'])])
  } else {
    const participantIds = selected as string[]
    if (participantIds.some((id) => participants[id]?.status !== 'active')) throw new RoomError('ROOM_CHANGED')
    store.write(expensePath, {
      paidBy, createdBy: actor, updatedBy: actor, amount: newAmount,
      category: body.category, memo: body.memo, schemaVersion: 4,
      shares: splitExpense(newAmount, participantIds, paidBy),
      revision: body.requestId, updatedAt: new Date(),
      ...(existing ? {} : { creationKey: body.requestId, createdAt: new Date() }),
      ...(creationHash === undefined ? {} : { creationHash }),
    }, Boolean(existing))
  }
  store.write(path, {
    totalAmount: Number(room.data.totalAmount) - oldAmount + newAmount,
  }, true)
  return { expenseId }
}

export async function roomOperation(
  project: string, token: string, id: string, uid: string, action: string, body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (action === 'access') {
    const path = `meetings/${id}`
    const room = await getFirestoreDocument(project, path, token)
    if (!room || room.data.roomCleanupPending) throw new RoomError('ROOM_NOT_FOUND', 404)
    if (!isCurrentRoom(room)) throw new RoomError('ROOM_NOT_FOUND', 404)
    const link = await getFirestoreDocument(project, `${path}/participantLinks/${uid}`, token)
    const participant = link
      ? roomParticipant(await getFirestoreDocument(project, `${path}/participants/${participantLinkId(link)}`, token))
      : null
    const active = participant?.status === 'active' && memberUids(room).includes(uid)
    return {
      mode: 'participants', modelVersion: room.data.participantModelVersion, name: room.data.name, canJoin: room.data.status === 'active',
      ...(active ? { participantId: participantLinkId(link) } : {}),
      departureVersion: participant?.departureVersion ?? null,
    }
  }
  return withRoomTransaction(project, token, id, async (store, path) => {
    const [room, lock] = await store.readMany([path, `withdrawalLocks/${uid}`])
    if (lock) throw new RoomError('WITHDRAWAL_IN_PROGRESS')
    if (!room || room.data.roomCleanupPending) {
      if (action === 'leave') return { departed: true }
      throw new RoomError('ROOM_NOT_FOUND', 404)
    }
    if (!isCurrentRoom(room) || room.data.withdrawalLockRequestId) throw new RoomError('ROOM_CHANGED')
    if (action === 'join') return joinRoom(store, path, room, uid, body)
    if (action === 'leave') return departRoom(store, path, room, uid, 'leave', body.participantId)
    if (!memberUids(room).includes(uid)) throw new RoomError('ROOM_FORBIDDEN', 403)
    const actor = participantLinkId(await store.read(`${path}/participantLinks/${uid}`))
    if (room.data.status === 'settled' && action === 'settle') return { settled: true }
    if (room.data.status !== 'active') throw new RoomError('ROOM_SETTLED')
    if (action === 'expense') return changeExpense(store, path, room, actor, body)

    const [expenseDocuments, participantDocuments] = await Promise.all([
      store.list('expenses', 5000), store.list('participants', 5000),
    ])
    const ids = participantDocuments.map(({ id: participantId }) => participantId).sort()
    const expenses = expenseDocuments.filter(({ data }) => data.deleted !== true).map(({ data }) => data as unknown as Parameters<typeof buildV2SettlementSnapshot>[1][number])
    const snapshot = buildV2SettlementSnapshot(ids, expenses)
    if (snapshot.totalAmount !== room.data.totalAmount) throw new RoomError('INVALID_ROOM_DATA')
    const hash = await hashSettlementSnapshot(snapshot)
    if (hash !== body.hash) throw new RoomError('ROOM_CHANGED')
    store.write(`${path}/settlements/final`, { ...snapshot, hash, finalizedBy: actor, settledAt: new Date() }, false)
    store.write(path, { status: 'settled' }, true)
    return { settled: true }
  })
}
