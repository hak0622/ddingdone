import { calculateSettlements, type Expense, type Members, type Settlement } from './settle'
import { calculateExpensePayments, netPayments, splitExpense, type SplitExpense } from './expenseShares'
import { participantDisplayName, type MeetingParticipants, UNKNOWN_PARTICIPANT_NAME } from './meetingParticipants'

export const SETTLEMENT_SNAPSHOT_SCHEMA_VERSION = 1

export type SettlementTransferSnapshot = {
  from: string
  to: string
  amount: number
}

export interface LegacyBalance {
  burdens: Record<string, number>
  transfers: SettlementTransferSnapshot[]
}

export type SettlementSnapshotCore = {
  schemaVersion: number
  totalAmount: number
  participantCount: number
  participantIds: string[]
  participantNames: Record<string, string>
  participantPaidTotals: Record<string, number>
  transfers: SettlementTransferSnapshot[]
  participantBurdenTotals?: Record<string, number>
}

export type SettlementSnapshot = SettlementSnapshotCore & {
  hash: string
  finalizedBy: string
  settledAt: unknown
}

function orderedMembers(memberIds: string[], members: Members): Members {
  const result: Members = {}
  for (const uid of memberIds) {
    if (typeof members[uid] === 'string') result[uid] = members[uid]
  }
  return result
}

export function buildSettlementSnapshot(
  memberIds: string[],
  members: Members,
  expenses: Expense[],
  individualSplits = false,
  legacyBalance?: LegacyBalance,
): SettlementSnapshotCore {
  const snapshotMembers = orderedMembers(memberIds, members)
  const participantIds = Object.keys(snapshotMembers)
  const participantPaidTotals: Record<string, number> = {}
  for (const uid of participantIds) participantPaidTotals[uid] = 0

  let totalAmount = 0
  for (const expense of expenses) {
    totalAmount += expense.amount
    const paid = participantPaidTotals[expense.paidBy]
    if (paid !== undefined) {
      participantPaidTotals[expense.paidBy] = paid + expense.amount
    }
  }

  const legacy = expenses.filter((expense) => !expense.splitMemberUids && !expense.shares)
  const selected = expenses.flatMap((expense) => {
    const shares = expense.shares ?? (expense.splitMemberUids && splitExpense(expense.amount, expense.splitMemberUids, expense.paidBy))
    return shares ? [{ ...expense, shares }] : []
  })
  const baseline = legacyBalance?.transfers ?? calculateSettlements(legacy, snapshotMembers)
  const settlements = selected.length ? netPayments([...baseline, ...calculateExpensePayments(selected)]) : baseline
  const burdenTotals = Object.fromEntries(participantIds.map((id) => [id, 0]))
  const useIndividualSplits = individualSplits || !!legacyBalance || selected.length > 0
  if (useIndividualSplits && participantIds.length) {
    const baselineTotal = legacy.reduce((sum, expense) => sum + expense.amount, 0)
    if (legacyBalance) {
      Object.assign(burdenTotals, legacyBalance.burdens)
    } else if (baselineTotal) {
      for (const share of splitExpense(baselineTotal, participantIds)) burdenTotals[share.participantId] = share.amount
    }
    for (const { shares } of selected) {
      for (const share of shares) burdenTotals[share.participantId] = (burdenTotals[share.participantId] ?? 0) + share.amount
    }
  }
  return {
    schemaVersion: useIndividualSplits ? 2 : SETTLEMENT_SNAPSHOT_SCHEMA_VERSION,
    totalAmount,
    participantCount: participantIds.length,
    participantIds,
    participantNames: snapshotMembers,
    participantPaidTotals,
    transfers: settlements.map(({ from, to, amount }) => ({ from, to, amount })),
    ...(useIndividualSplits && { participantBurdenTotals: burdenTotals }),
  }
}

export function buildParticipantSnapshot(
  participantIds: string[], expenses: Expense[], legacyBalance?: LegacyBalance, includePastParticipants = false,
): SettlementSnapshotCore {
  const ids = [...new Set(includePastParticipants
    ? [...participantIds, ...expenses.flatMap((expense) => [expense.paidBy, ...(expense.shares ?? []).map((share) => share.participantId)])]
    : participantIds)].sort()
  const names = Object.fromEntries(ids.map((id) => [id, '']))
  const snapshot = buildSettlementSnapshot(ids, names, expenses, true, legacyBalance)
  snapshot.transfers.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  return snapshot
}

export function buildV2SettlementSnapshot(participantIds: string[], expenses: readonly SplitExpense[]): SettlementSnapshotCore {
  const ids = new Set(participantIds)
  for (const expense of expenses) {
    ids.add(expense.paidBy)
    for (const { participantId } of expense.shares) ids.add(participantId)
  }
  const participantNames = Object.fromEntries([...ids].sort().map((id) => [id, '']))
  const orderedIds = Object.keys(participantNames)
  const participantPaidTotals = Object.fromEntries(orderedIds.map((id) => [id, 0]))
  const participantBurdenTotals = { ...participantPaidTotals }
  let totalAmount = 0
  for (const { amount, paidBy, shares } of expenses) {
    totalAmount += amount
    participantPaidTotals[paidBy] = (participantPaidTotals[paidBy] ?? 0) + amount
    for (const { participantId, amount: burden } of shares) {
      participantBurdenTotals[participantId] = (participantBurdenTotals[participantId] ?? 0) + burden
    }
  }
  const transfers = calculateExpensePayments(expenses)
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  return {
    schemaVersion: 2, totalAmount, participantCount: orderedIds.length, participantIds: orderedIds,
    participantNames, participantPaidTotals, participantBurdenTotals, transfers,
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function hashSettlementSnapshot(snapshot: SettlementSnapshotCore): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(snapshot))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function settlementParticipantName(snapshot: SettlementSnapshotCore, id: string, participants?: MeetingParticipants): string {
  if (participants) return participantDisplayName(participants, id)
  return id.startsWith('withdrawn_') ? UNKNOWN_PARTICIPANT_NAME : snapshot.participantNames[id] ?? UNKNOWN_PARTICIPANT_NAME
}

export function snapshotToSettlements(snapshot: SettlementSnapshotCore, participants?: MeetingParticipants): Settlement[] {
  return snapshot.transfers.map(({ from, to, amount }) => ({
    from,
    fromName: settlementParticipantName(snapshot, from, participants),
    to,
    toName: settlementParticipantName(snapshot, to, participants),
    amount,
  }))
}

