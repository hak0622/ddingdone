import { sha256Hex, stableStringify } from './crypto'
import type { FirestoreRecord } from './types'

export class SnapshotAnonymizationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'SnapshotAnonymizationError'
  }
}

function mapField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export async function anonymizeSettlementSnapshot(
  requestId: string,
  uid: string,
  meetingId: string,
  settlement: FirestoreRecord | null,
): Promise<Record<string, unknown>> {
  if (!settlement) throw new SnapshotAnonymizationError('SETTLEMENT_SNAPSHOT_MISSING')
  const data = settlement.data
  const participantIds = Array.isArray(data.participantIds)
    ? data.participantIds.filter((value): value is string => typeof value === 'string')
    : []
  const participantNames = mapField(data.participantNames)
  const participantPaidTotals = mapField(data.participantPaidTotals)
  const transfers = Array.isArray(data.transfers) ? data.transfers : null
  if (!participantNames || !participantPaidTotals || !transfers || !participantIds.includes(uid)) {
    throw new SnapshotAnonymizationError('SETTLEMENT_SNAPSHOT_INVALID')
  }

  const anonymousId = `withdrawn_${(await sha256Hex(`${requestId}:${meetingId}`)).slice(0, 24)}`
  const nextIds = participantIds.map((participantUid) => participantUid === uid ? anonymousId : participantUid)
  const nextNames = { ...participantNames }
  const nextPaidTotals = { ...participantPaidTotals }
  nextNames[anonymousId] = '탈퇴한 사용자'
  nextPaidTotals[anonymousId] = nextPaidTotals[uid]
  delete nextNames[uid]
  delete nextPaidTotals[uid]
  const nextTransfers = transfers.map((transfer) => {
    if (!transfer || typeof transfer !== 'object' || Array.isArray(transfer)) {
      throw new SnapshotAnonymizationError('SETTLEMENT_SNAPSHOT_INVALID')
    }
    const record = transfer as Record<string, unknown>
    return {
      from: record.from === uid ? anonymousId : record.from,
      to: record.to === uid ? anonymousId : record.to,
      amount: record.amount,
    }
  })
  const core = {
    schemaVersion: data.schemaVersion,
    totalAmount: data.totalAmount,
    participantCount: data.participantCount,
    participantIds: nextIds,
    participantNames: nextNames,
    participantPaidTotals: nextPaidTotals,
    transfers: nextTransfers,
  }
  return {
    ...core,
    hash: await sha256Hex(stableStringify(core)),
    ...(data.finalizedBy === uid ? { finalizedBy: anonymousId } : {}),
    anonymizedParticipantCount:
      (typeof data.anonymizedParticipantCount === 'number' ? data.anonymizedParticipantCount : 0) + 1,
    anonymizedAt: new Date(),
  }
}
