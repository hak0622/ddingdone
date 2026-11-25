import { calculateExpensePayments, splitExpense } from './expenseShares.ts'
import type { SplitExpense } from './expenseShares.ts'
import { calculateSettlements } from './settle.ts'

export type ExpenseMigration<T> =
  | { kind: 'convert'; expenses: Array<T & SplitExpense> }
  | { kind: 'preserve'; reason: 'invalid_data' | 'different_shares' | 'different_payments' }

export function compareExpenseMigration<T extends { paidBy: string; amount: number }>(
  expenses: readonly T[],
  participantIds: readonly string[],
): ExpenseMigration<T> {
  const participants = new Set(participantIds)
  if (!participants.size || participants.size !== participantIds.length ||
      expenses.some(({ paidBy, amount }) => !participants.has(paidBy) || !Number.isSafeInteger(amount) || amount <= 0)) {
    return { kind: 'preserve', reason: 'invalid_data' }
  }

  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  if (!Number.isSafeInteger(total)) return { kind: 'preserve', reason: 'invalid_data' }
  if (expenses.length === 0) return { kind: 'convert', expenses: [] }

  const converted = expenses.map((expense) => ({ ...expense, shares: splitExpense(expense.amount, participantIds, expense.paidBy) }))
  const burdens = new Map<string, number>()
  for (const expense of converted) {
    for (const { participantId, amount } of expense.shares) {
      burdens.set(participantId, (burdens.get(participantId) ?? 0) + amount)
    }
  }
  if (splitExpense(total, participantIds).some(({ participantId, amount }) => burdens.get(participantId) !== amount)) {
    return { kind: 'preserve', reason: 'different_shares' }
  }

  const legacy = calculateSettlements([...expenses], Object.fromEntries(participantIds.map((id) => [id, id])))
  const candidate = calculateExpensePayments(converted)
  const paymentAmounts = new Map(legacy.map(({ from, to, amount }) => [JSON.stringify([from, to]), amount]))
  if (legacy.length !== candidate.length || candidate.some(({ from, to, amount }) =>
    paymentAmounts.get(JSON.stringify([from, to])) !== amount)) {
    return { kind: 'preserve', reason: 'different_payments' }
  }

  return { kind: 'convert', expenses: converted }
}
