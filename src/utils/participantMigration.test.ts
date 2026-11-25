import { describe, expect, it } from 'vitest'
import { prepareParticipantMigration } from './participantMigration'
import { buildSettlementSnapshot } from './settlementSnapshot'
import type { MeetingParticipants } from './meetingParticipants'

describe('participant identity migration', () => {
  const oldIds = ['uid-a', 'uid-b', 'uid-c']
  const ids = ['person-a', 'person-b', 'person-c']
  const mapping = new Map(oldIds.map((uid, index) => [uid, ids[index]]))
  const members = { 'person-a': '가', 'person-b': '나', 'person-c': '다' }
  const participants: MeetingParticipants = Object.fromEntries(ids.map((id) => [id, {
    status: 'active', name: members[id as keyof typeof members], departureVersion: 0,
  }]))

  it('changes only identity references for an existing selected expense', () => {
    const result = prepareParticipantMigration(oldIds, mapping, participants, [
      { id: 'x', paidBy: 'uid-b', amount: 101, splitMemberUids: ['uid-a', 'uid-b'], updatedBy: 'uid-b' },
    ])
    expect(result).toEqual({
      expenses: [{ id: 'x', paidBy: 'person-b', createdBy: 'person-b', updatedBy: 'person-b',
        shares: [{ participantId: 'person-a', amount: 50 }, { participantId: 'person-b', amount: 51 }],
        participation: { 'person-b': 0, 'person-a': 0 } }],
      legacyBalance: null,
    })
  })

  it('keeps a non-equivalent legacy settlement as fixed amounts and transfers', () => {
    const expenses = [{ id: 'x', paidBy: 'uid-a', amount: 60 }, { id: 'y', paidBy: 'uid-b', amount: 30 }]
    const result = prepareParticipantMigration(oldIds, mapping, participants, expenses)
    expect(result.legacyBalance).toEqual({
      burdens: { 'person-a': 30, 'person-b': 30, 'person-c': 30 },
      transfers: [{ from: 'person-c', to: 'person-a', amount: 30 }],
    })
    expect(result.expenses.map(({ shares }) => shares)).toEqual([null, null])
    const migrated = result.expenses.map(({ paidBy }, index) => ({ paidBy, amount: expenses[index].amount }))
    const after = buildSettlementSnapshot(ids, members, [
      ...migrated, { paidBy: 'person-a', amount: 5, shares: [{ participantId: 'person-a', amount: 5 }] },
    ], true, result.legacyBalance!)
    expect(after.transfers).toEqual(result.legacyBalance?.transfers)
    expect(after.participantBurdenTotals).toEqual({ 'person-a': 35, 'person-b': 30, 'person-c': 30 })
  })
})
