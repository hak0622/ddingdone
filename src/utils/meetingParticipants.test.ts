import { describe, expect, it } from 'vitest'
import {
  captureExpenseParticipation, isExpenseFinanciallyLocked, markParticipantDeparture,
  participantDisplayName, restoreParticipant, type MeetingParticipants,
} from './meetingParticipants'
import { buildSettlementSnapshot, snapshotToSettlements } from './settlementSnapshot'

describe('meeting participant history', () => {
  const participants: MeetingParticipants = {
    a: { status: 'active', name: '아무개', departureVersion: 0 },
    b: { status: 'active', name: '하이루', departureVersion: 0 },
    c: { status: 'active', name: '민수', departureVersion: 0 },
  }

  it('preserves a financial lock after the same account rejoins', () => {
    const shared = captureExpenseParticipation(participants, 'a', ['b', 'c'])
    const unrelated = captureExpenseParticipation(participants, 'a', ['a', 'c'])
    const left = markParticipantDeparture(participants.b!, 'leave')
    const afterLeave = { ...participants, b: left }
    expect(participantDisplayName(afterLeave, 'b')).toBe('알 수 없음')
    expect(isExpenseFinanciallyLocked(afterLeave, shared)).toBe(true)
    expect(isExpenseFinanciallyLocked(afterLeave, unrelated)).toBe(false)
    expect(() => captureExpenseParticipation(afterLeave, 'a', ['b'])).toThrow('PARTICIPANT_NOT_ACTIVE')

    const afterJoin = { ...afterLeave, b: restoreParticipant(left, '하이루') }
    expect(participantDisplayName(afterJoin, 'b')).toBe('하이루')
    expect(isExpenseFinanciallyLocked(afterJoin, shared)).toBe(true)
    const newExpense = captureExpenseParticipation(afterJoin, 'b', ['a'])
    expect(isExpenseFinanciallyLocked(afterJoin, newExpense)).toBe(false)
  })

  it('treats repeated departure as idempotent and prevents a deleted identity from being restored', () => {
    const left = markParticipantDeparture(participants.b!, 'leave')
    expect(markParticipantDeparture(left, 'leave')).toBe(left)
    const withdrawn = markParticipantDeparture(left, 'withdraw')
    expect(withdrawn.departureVersion).toBe(left.departureVersion)
    expect(markParticipantDeparture(withdrawn, 'withdraw')).toBe(withdrawn)
    expect(() => restoreParticipant(withdrawn, '하이루')).toThrow('PARTICIPANT_WITHDRAWN')
  })

  it('keeps equal display names separate and uses saved shares for settlement', () => {
    const snapshot = buildSettlementSnapshot(['a', 'b', 'c'], { a: '나', b: '하이루', c: '민수' }, [
      { paidBy: 'a', amount: 101, shares: [{ participantId: 'b', amount: 90 }, { participantId: 'c', amount: 11 }] },
    ])
    expect(snapshotToSettlements(snapshot, {
      ...participants,
      b: markParticipantDeparture(participants.b!, 'leave'),
      c: markParticipantDeparture(participants.c!, 'withdraw'),
    })).toEqual([
      { from: 'b', fromName: '알 수 없음', to: 'a', toName: '아무개', amount: 90 },
      { from: 'c', fromName: '알 수 없음', to: 'a', toName: '아무개', amount: 11 },
    ])
  })
})
