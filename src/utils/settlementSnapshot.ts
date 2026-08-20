import { calculateSettlements, type Expense, type Members, type Settlement } from './settle'

export const SETTLEMENT_SNAPSHOT_SCHEMA_VERSION = 1

export type SettlementTransferSnapshot = {
  from: string
  to: string
  amount: number
}

export type SettlementSnapshotCore = {
  schemaVersion: number
  totalAmount: number
  participantCount: number
  participantIds: string[]
  participantNames: Record<string, string>
  participantPaidTotals: Record<string, number>
  transfers: SettlementTransferSnapshot[]
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
): SettlementSnapshotCore {
  const snapshotMembers = orderedMembers(memberIds, members)
  const participantIds = Object.keys(snapshotMembers)
  const participantPaidTotals: Record<string, number> = {}
  for (const uid of participantIds) participantPaidTotals[uid] = 0

  let totalAmount = 0
  for (const expense of expenses) {
    totalAmount += expense.amount
    if (participantPaidTotals[expense.paidBy] !== undefined) {
      participantPaidTotals[expense.paidBy] += expense.amount
    }
  }

  const settlements = calculateSettlements(expenses, snapshotMembers)
  return {
    schemaVersion: SETTLEMENT_SNAPSHOT_SCHEMA_VERSION,
    totalAmount,
    participantCount: participantIds.length,
    participantIds,
    participantNames: snapshotMembers,
    participantPaidTotals,
    transfers: settlements.map(({ from, to, amount }) => ({ from, to, amount })),
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

export function snapshotToSettlements(snapshot: SettlementSnapshotCore): Settlement[] {
  return snapshot.transfers.map(({ from, to, amount }) => ({
    from,
    fromName: snapshot.participantNames[from] ?? '탈퇴한 사용자',
    to,
    toName: snapshot.participantNames[to] ?? '탈퇴한 사용자',
    amount,
  }))
}

