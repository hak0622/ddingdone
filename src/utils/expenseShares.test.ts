import { describe, expect, it } from 'vitest'
import { calculateExpensePayments, groupExpensesByPayer, splitExpense } from './expenseShares'
import { compareExpenseMigration } from './expenseMigration'
import { buildParticipantSnapshot, buildSettlementSnapshot, buildV2SettlementSnapshot, hashSettlementSnapshot } from './settlementSnapshot'

describe('expense shares', () => {
  it('v2 앱의 정산 해시는 기존 계정 Worker의 정산 해시와 일치한다', async () => {
    const members = ['b', 'a', 'solo']
    const expenses = [
      { paidBy: 'a', amount: 11, shares: splitExpense(11, ['retired', 'b', 'a'], 'a') },
      { paidBy: 'b', amount: 8, shares: splitExpense(8, ['a', 'b'], 'b') },
    ]
    const current = buildV2SettlementSnapshot(members, expenses)
    const deployed = buildParticipantSnapshot(members, expenses, undefined, true)
    expect(current).toEqual(deployed)
    expect(await hashSettlementSnapshot(current)).toBe(await hashSettlementSnapshot(deployed))
  })

  it('preserves whole won and uses the given participant order for the remainder', () => {
    expect(splitExpense(10, ['b', 'a', 'c'])).toEqual([
      { participantId: 'b', amount: 4 },
      { participantId: 'a', amount: 3 },
      { participantId: 'c', amount: 3 },
    ])
    expect(() => splitExpense(10, ['a', 'a'])).toThrow(RangeError)
  })

  it('assigns the first remainder to the payer only when included in the split', () => {
    expect(splitExpense(5, ['a', 'b'], 'b').map(({ amount }) => amount)).toEqual([2, 3])
    expect(splitExpense(5, ['a', 'b'], 'c').map(({ amount }) => amount)).toEqual([3, 2])
  })

  it('nets only opposite payments between the same pair', () => {
    const expense = (paidBy: string, amount: number, participantIds: string[]) => ({
      paidBy, amount, shares: splitExpense(amount, participantIds, paidBy),
    })
    expect(calculateExpensePayments([
      expense('b', 12, ['a']), expense('a', 5, ['b']), expense('c', 7, ['b']),
      expense('c', 2, ['a']), expense('a', 2, ['c']), expense('c', 8, ['c']),
    ])).toEqual([
      { from: 'a', to: 'b', amount: 7 }, { from: 'b', to: 'c', amount: 7 },
    ])
  })

  it('keeps item details under the respective payer and updates the group total', () => {
    const expenses = [
      { id: 'food', paidBy: 'a', amount: 12 },
      { id: 'stay', paidBy: 'b', amount: 30 },
      { id: 'coffee', paidBy: 'a', amount: 5 },
    ]
    expect(groupExpensesByPayer(expenses)).toEqual([
      { paidBy: 'a', total: 17, expenses: [expenses[0], expenses[2]] },
      { paidBy: 'b', total: 30, expenses: [expenses[1]] },
    ])
  })
})

describe('legacy expense conversion', () => {
  it('converts when both the shares and payment relationships agree', () => {
    expect(compareExpenseMigration([{ paidBy: 'a', amount: 30 }], ['a', 'b', 'c']).kind).toBe('convert')
  })

  it('preserves legacy results if per-expense rounding changes the burdens', () => {
    expect(compareExpenseMigration(Array.from({ length: 3 }, () => ({ paidBy: 'a', amount: 1 })), ['a', 'b', 'c']))
      .toEqual({ kind: 'preserve', reason: 'different_shares' })
  })

  it('preserves legacy results when equal burdens produce different payment relationships', () => {
    expect(compareExpenseMigration([{ paidBy: 'a', amount: 60 }, { paidBy: 'b', amount: 30 }], ['a', 'b', 'c']))
      .toEqual({ kind: 'preserve', reason: 'different_payments' })
  })
})

describe('selected participants in a settlement', () => {
  it('owes nothing when the same two participants each pay the same odd amount', () => {
    const ids = ['a', 'b']
    const snapshot = buildSettlementSnapshot(ids, { a: '나', b: '하이루' }, [
      { paidBy: 'a', amount: 1_111_111, splitMemberUids: ids },
      { paidBy: 'b', amount: 1_111_111, splitMemberUids: ids },
    ])
    expect(snapshot.participantBurdenTotals).toEqual({ a: 1_111_111, b: 1_111_111 })
    expect(snapshot.transfers).toEqual([])
  })

  it('assigns nothing to an unselected member and keeps a separate legacy balance', () => {
    const ids = ['a', 'b']
    const members = { a: '나', b: '하이루' }
    const soloExpense = { paidBy: 'a', amount: 20_000, splitMemberUids: ['a'] }
    expect(buildSettlementSnapshot(ids, members, [soloExpense]).participantBurdenTotals).toEqual({ a: 20_000, b: 0 })
    expect(buildSettlementSnapshot(ids, members, [soloExpense]).transfers).toEqual([])

    const shared = buildSettlementSnapshot(ids, members, [
      soloExpense, { paidBy: 'a', amount: 20_000, splitMemberUids: ids },
      { paidBy: 'b', amount: 4_000 },
    ])
    expect(shared.participantBurdenTotals).toEqual({ a: 32_000, b: 12_000 })
    expect(shared.transfers).toEqual([{ from: 'b', to: 'a', amount: 8_000 }])
  })
})
