import type { FirestoreRecord } from './types'
import { prepareParticipantMigration } from '../../../src/utils/participantMigration'
import { buildParticipantSnapshot, buildSettlementSnapshot, hashSettlementSnapshot, type SettlementSnapshotCore } from '../../../src/utils/settlementSnapshot'
import { splitExpense } from '../../../src/utils/expenseShares'
import { isExpenseFinanciallyLocked, type ExpenseParticipation, type MeetingParticipant, type MeetingParticipants } from '../../../src/utils/meetingParticipants'
import { CURRENT_PARTICIPANT_MODEL, isCurrentRoom, memberUids, participantLinkId, ROOM_COLLECTIONS, RoomError, withRoomTransaction } from './rooms'
import type { ExpenseShare } from '../../../src/utils/expenseShares'
import { sha256Hex, stableStringify } from './crypto'

function readV1Participant(record: FirestoreRecord | null): MeetingParticipant {
  const data = record?.data
  if (!data || !['active', 'left', 'withdrawn'].includes(String(data.status)) ||
      !Number.isSafeInteger(data.departureVersion) || Number(data.departureVersion) < 0 ||
      (data.status === 'active' ? typeof data.name !== 'string' : data.name !== null)) {
    throw new RoomError('INVALID_PARTICIPANT')
  }
  return data as unknown as MeetingParticipant
}

function compareFinancials(snapshot: SettlementSnapshotCore, translate: (id: string) => string) {
  const translatedAmounts = (amounts: Record<string, number>) =>
    Object.fromEntries(Object.entries(amounts).map(([id, amount]) => [translate(id), amount]))
  return stableStringify({
    totalAmount: snapshot.totalAmount,
    participantCount: snapshot.participantCount,
    paidTotals: translatedAmounts(snapshot.participantPaidTotals),
    burdens: translatedAmounts(snapshot.participantBurdenTotals ?? {}),
    transfers: snapshot.transfers.map(({ from, to, amount }) => [translate(from), translate(to), amount])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })
}

export async function migrateParticipantRoom(
  project: string, token: string, id: string, apply: boolean, expectedSource?: string,
  saveBackup?: (snapshot: unknown) => Promise<void>,
  recalculateTestRoom = false,
) {
  return withRoomTransaction(project, token, id, async (store, path) => {
    const room = await store.read(path)
    if (!room) throw new RoomError('ROOM_NOT_FOUND')
    if (isCurrentRoom(room)) return { state: 'already_converted' }
    if (room.data.withdrawalLockRequestId || room.data.roomCleanupPending) throw new RoomError('WITHDRAWAL_IN_PROGRESS')
    if (room.data.legacyBalance != null) throw new RoomError('LEGACY_BALANCE_REQUIRED')
    const version = room.data.participantModelVersion
    const v1 = version === 1
    if (!v1 && version != null && version !== 0) throw new RoomError('UNSUPPORTED_ROOM_VERSION')
    if (recalculateTestRoom && (v1 || room.data.status !== 'active')) throw new RoomError('INVALID_TEST_ROOM')
    const uids = memberUids(room)
    const [members, entries, finals, collections, roster, links] = await Promise.all([
      store.list('members'), store.list('expenses'), store.list('settlements', 2), store.collections(),
      store.list('participants'), store.list('participantLinks'),
    ])
    if (collections.some((collection) => collection !== 'members' && !ROOM_COLLECTIONS.includes(collection)) ||
        (v1 ? collections.includes('members') : collections.includes('participants') || collections.includes('participantLinks'))) {
      throw new RoomError('UNEXPECTED_COLLECTION')
    }
    const locks = await store.readMany([...new Set([...uids, ...links.map(({ id }) => id)])].map((uid) => `withdrawalLocks/${uid}`))
    if (locks.some(Boolean)) throw new RoomError('WITHDRAWAL_IN_PROGRESS')
    const sourceHash = await sha256Hex(stableStringify({
      room, collections: [...collections].sort(),
      documents: [members, entries, finals, roster, links].map((records) => [...records].sort((a, b) => a.id.localeCompare(b.id))),
    }))
    if (apply && expectedSource !== sourceHash) throw new RoomError('MIGRATION_SOURCE_CHANGED')
    if (!uids.length || new Set(uids).size !== uids.length || room.data.memberCount !== uids.length ||
        (!v1 && members.length !== uids.length) || entries.length !== room.data.expenseCount ||
        entries.reduce((sum, { data }) => sum + Number(data.amount), 0) !== room.data.totalAmount) {
      throw new RoomError('INVALID_ROOM_DATA')
    }
    if (1 + entries.length + finals.length + (v1 ? roster.length + links.length : members.length * 3) > 500) {
      throw new RoomError('ROOM_WRITE_LIMIT')
    }

    const participants: MeetingParticipants = Object.fromEntries(roster.map((record) => [record.id, readV1Participant(record)]))
    const mapping = new Map<string, string>()
    const linkedIds = new Set<string>()
    if (v1) {
      for (const link of links) {
        const participantId = participantLinkId(link)
        const participant = participants[participantId]
        if (!participant || linkedIds.has(participantId) || link.data.accountUid !== link.id ||
            link.data.meetingId !== id || participant.status === 'withdrawn' ||
            (participant.status === 'active') !== uids.includes(link.id)) throw new RoomError('UNMAPPED_PARTICIPANT')
        linkedIds.add(participantId)
        if (participant.status === 'active') mapping.set(link.id, participantId)
      }
      if (mapping.size !== uids.length ||
          Object.entries(participants).some(([id, participant]) => participant.status === 'active' && !linkedIds.has(id))) {
        throw new RoomError('UNMAPPED_PARTICIPANT')
      }
    } else {
      for (const uid of uids) {
        const nickname = members.find((member) => member.id === uid)?.data.nickname
        if (typeof nickname !== 'string' || !nickname.trim() || nickname.length > 20) throw new RoomError('UNMAPPED_PARTICIPANT')
        const participantId = crypto.randomUUID()
        mapping.set(uid, participantId)
        participants[participantId] = { name: nickname, status: 'active', departureVersion: 0 }
      }
    }
    function translate(value: string) {
      const participantId = v1 ? value : mapping.get(value)
      if (!participantId || !Object.hasOwn(participants, participantId)) throw new RoomError('UNMAPPED_PARTICIPANT')
      return participantId
    }

    const expenses = entries.map(({ id: expenseId, data }) => {
      const { amount, paidBy, createdBy, updatedBy, splitMemberUids, schemaVersion } = data
      if (!Number.isSafeInteger(amount) || Number(amount) < 1 || typeof paidBy !== 'string' || data.createdAt == null ||
          data.deleted === true || (createdBy != null && typeof createdBy !== 'string') ||
          (updatedBy != null && typeof updatedBy !== 'string')) throw new RoomError('INVALID_EXPENSE')
      if (!v1 && (schemaVersion === 3
        ? !Array.isArray(splitMemberUids) || !splitMemberUids.length ||
          new Set(splitMemberUids).size !== splitMemberUids.length ||
          splitMemberUids.some((member) => typeof member !== 'string' || !mapping.has(member))
        : splitMemberUids != null)) throw new RoomError('INVALID_EXPENSE')

      return { id: expenseId, paidBy, amount: Number(amount), createdBy: typeof createdBy === 'string' ? createdBy : undefined,
        updatedBy: typeof updatedBy === 'string' ? updatedBy : undefined,
        splitMemberUids: schemaVersion === 3 ? splitMemberUids as string[] : undefined }
    })
    const migratedExpenses = v1 ? expenses.map((expense, index) => {
      const data = entries[index]!.data
      if (!Array.isArray(data.shares)) throw new RoomError('LEGACY_BALANCE_REQUIRED')
      const shares = data.shares as ExpenseShare[]
      const payers = [translate(expense.paidBy), ...shares.map((share) => translate(share.participantId))]
      if (data.schemaVersion !== 4 || !expense.createdBy || !shares.length ||
          new Set(shares.map(({ participantId }) => participantId)).size !== shares.length ||
          shares.some(({ amount }) => !Number.isSafeInteger(amount) || amount < 0) ||
          shares.reduce((sum, share) => sum + share.amount, 0) !== expense.amount ||
          !data.participation || typeof data.participation !== 'object' || Array.isArray(data.participation)) {
        throw new RoomError('INVALID_EXPENSE')
      }
      const participation = data.participation as ExpenseParticipation
      if (Object.keys(participation).length !== new Set(payers).size ||
          payers.some((id) => !Number.isSafeInteger(participation[id]) || participation[id]! < 0)) {
        throw new RoomError('INVALID_EXPENSE')
      }
      if (isExpenseFinanciallyLocked(participants, participation) !== payers.some((id) => participants[id]?.status !== 'active')) {
        throw new RoomError('EXPENSE_LOCK_MISMATCH')
      }
      return { ...expense, paidBy: payers[0]!, createdBy: translate(expense.createdBy),
        updatedBy: expense.updatedBy ? translate(expense.updatedBy) : undefined, shares }
    }) : (() => {
      const migration = prepareParticipantMigration(uids, mapping, participants, expenses)
      if (migration.legacyBalance && !recalculateTestRoom) throw new RoomError('LEGACY_BALANCE_REQUIRED')
      return migration.expenses.map((expense, index) => {
        const original = expenses[index]!
        const shares = expense.shares ?? splitExpense(original.amount, uids, original.paidBy)
          .map(({ participantId, amount }) => ({ participantId: translate(participantId), amount }))
        return { ...expense, amount: original.amount, shares }
      })
    })()

    const activeIds = [...mapping.values()]
    const previousIds = v1 ? Object.keys(participants) : [...uids]
    const baseline = v1
      ? buildParticipantSnapshot(previousIds, migratedExpenses)
      : buildSettlementSnapshot(uids, Object.fromEntries(uids.map((uid) => [uid, ''])), expenses, true)
    const after = buildParticipantSnapshot(activeIds, migratedExpenses, undefined, true)
    if (room.data.status === 'active' && !recalculateTestRoom &&
        compareFinancials(after, (key) => key) !== compareFinancials(baseline, translate)) {
      throw new RoomError('FINANCIAL_MISMATCH')
    }

    let finalUpdate: Record<string, unknown> | null = null
    if (room.data.status === 'settled') {
      const final = finals[0]
      if (finals.length !== 1 || final?.id !== 'final') throw new RoomError('SETTLEMENT_SNAPSHOT_MISSING')
      const { schemaVersion, totalAmount, participantCount, participantIds, participantNames,
        participantPaidTotals, transfers, participantBurdenTotals, hash, finalizedBy, settledAt } = final.data
      if ((schemaVersion !== 1 && schemaVersion !== 2) || typeof finalizedBy !== 'string' || !settledAt ||
          !Array.isArray(participantIds) || !Array.isArray(transfers) || totalAmount !== room.data.totalAmount ||
          participantCount !== participantIds.length || new Set(participantIds).size !== participantIds.length ||
          participantIds.some((id) => !previousIds.includes(id))) throw new RoomError('INVALID_SETTLEMENT')
      if (!participantNames || typeof participantNames !== 'object' ||
          !participantPaidTotals || typeof participantPaidTotals !== 'object' ||
          (participantBurdenTotals != null && typeof participantBurdenTotals !== 'object')) {
        throw new RoomError('INVALID_SETTLEMENT')
      }
      const core = { schemaVersion, totalAmount, participantCount, participantIds, participantNames, participantPaidTotals, transfers,
        ...(participantBurdenTotals != null ? { participantBurdenTotals } : {}) } as SettlementSnapshotCore
      if (await hashSettlementSnapshot(core) !== hash) throw new RoomError('INVALID_SETTLEMENT')
      const rewrite = (amounts: Record<string, number>) => Object.fromEntries(Object.entries(amounts).map(([uid, amount]) => [translate(uid), amount]))
      const burdens = core.participantBurdenTotals ?? (Number(totalAmount) === 0
        ? Object.fromEntries<number>(participantIds.map((uid) => [uid, 0]))
        : Object.fromEntries(splitExpense(Number(totalAmount), participantIds).map(({ participantId, amount }) => [participantId, amount])))
      if (Object.keys(burdens).length !== participantIds.length ||
          Object.keys(core.participantPaidTotals).length !== participantIds.length ||
          Object.values(burdens).some((amount) => !Number.isSafeInteger(amount) || amount < 0) ||
          Object.values(burdens).reduce((sum, amount) => sum + amount, 0) !== totalAmount ||
          !participantIds.every((uid) => Number.isSafeInteger(core.participantPaidTotals[uid]) && core.participantPaidTotals[uid]! >= 0 && uid in burdens) ||
          Object.values(core.participantPaidTotals).reduce((sum, amount) => sum + amount, 0) !== totalAmount ||
          core.transfers.some(({ from, to, amount }) => !participantIds.includes(from) || !participantIds.includes(to) || from === to || !Number.isSafeInteger(amount) || amount <= 0)) {
        throw new RoomError('INVALID_SETTLEMENT')
      }
      const next = {
        schemaVersion: 2, totalAmount: Number(totalAmount), participantCount, participantIds: participantIds.map(translate),
        participantNames: Object.fromEntries(participantIds.map((id) => [translate(id), ''])), participantPaidTotals: rewrite(core.participantPaidTotals),
        participantBurdenTotals: rewrite(burdens),
        transfers: core.transfers.map(({ from, to, amount }) => ({ from: translate(from), to: translate(to), amount })),
      }
      if (compareFinancials(next, (key) => key) !== compareFinancials({ ...core, participantBurdenTotals: burdens }, translate)) {
        throw new RoomError('FINANCIAL_MISMATCH')
      }
      finalUpdate = { ...next, hash: await hashSettlementSnapshot(next), finalizedBy: translate(finalizedBy) }
    } else if (room.data.status !== 'active' || finals.length) throw new RoomError('INVALID_ROOM_STATUS')

    if (apply) {
      await saveBackup?.({ project, id, sourceHash, room, members, entries, finals, roster, links })
      for (const [uid, participantId] of mapping) {
        store.write(`${path}/participants/${participantId}`, { name: participants[participantId]!.name, status: 'active' },
          v1, ['name', 'status', 'departureVersion'])
        store.write(`${path}/participantLinks/${uid}`, { participantId },
          v1, ['participantId', 'accountUid', 'meetingId', 'nickname'])
        if (!v1) store.remove(`${path}/members/${uid}`)
      }
      for (const link of links) if (!mapping.has(link.id)) store.remove(`${path}/participantLinks/${link.id}`)
      for (const participant of roster) {
        if (participants[participant.id]?.status !== 'active') store.remove(`${path}/participants/${participant.id}`)
      }
      for (const { id: expenseId, paidBy, createdBy, updatedBy, shares } of migratedExpenses) {
        store.write(`${path}/expenses/${expenseId}`, {
          paidBy, createdBy, updatedBy, shares, schemaVersion: 4, revision: crypto.randomUUID(),
          splitMemberUids: undefined, participation: undefined,
        }, true)
      }
      if (finalUpdate) store.write(`${path}/settlements/final`, finalUpdate, true)
      store.write(path, {
        participantModelVersion: CURRENT_PARTICIPANT_MODEL,
        createdBy: undefined, memberCount: undefined, expenseCount: undefined,
        expenseSplitsEnabled: undefined, legacyBalance: undefined,
      }, true)
    }
    return { state: apply ? 'converted' : 'verified', sourceHash, expenses: expenses.length, participants: activeIds.length,
      settled: Boolean(finalUpdate) }
  })
}
