import { compareExpenseMigration } from './expenseMigration'
import { splitExpense, type ExpenseShare } from './expenseShares'
import { captureExpenseParticipation, type ExpenseParticipation, type MeetingParticipants } from './meetingParticipants'
import type { Expense } from './settle'
import { buildSettlementSnapshot, type LegacyBalance } from './settlementSnapshot'

interface MigratedExpense {
  id: string
  paidBy: string
  createdBy: string
  updatedBy: string
  shares: ExpenseShare[] | null
  participation: ExpenseParticipation
}

export function prepareParticipantMigration(
  orderedUids: readonly string[],
  idByUid: ReadonlyMap<string, string>,
  participants: MeetingParticipants,
  expenses: readonly (Expense & { id: string; createdBy?: string; updatedBy?: string })[],
): { expenses: MigratedExpense[]; legacyBalance: LegacyBalance | null } {
  function translate(uid: string) {
    const participantId = idByUid.get(uid)
    if (!participantId || !Object.prototype.hasOwnProperty.call(participants, participantId)) throw new Error('UNMAPPED_PARTICIPANT')
    return participantId
  }

  if (new Set(orderedUids.map(translate)).size !== orderedUids.length || !orderedUids.length) {
    throw new Error('INVALID_PARTICIPANT_MAPPING')
  }
  const legacy = expenses.filter((expense) => !expense.splitMemberUids)
  const comparison = compareExpenseMigration(legacy, orderedUids)
  if (comparison.kind === 'preserve' && comparison.reason === 'invalid_data') throw new Error('INVALID_LEGACY_EXPENSES')
  const legacyShares = comparison.kind === 'convert'
    ? new Map(comparison.expenses.map(({ id, shares }) => [id, shares]))
    : new Map<string, ExpenseShare[]>()
  const baseline = comparison.kind === 'preserve'
    ? buildSettlementSnapshot([...orderedUids], Object.fromEntries(orderedUids.map((uid) => [uid, uid])), legacy, true)
    : null
  const legacyBalance = baseline && {
    burdens: Object.fromEntries(Object.entries(baseline.participantBurdenTotals ?? {}).map(([uid, amount]) => [translate(uid), amount])),
    transfers: baseline.transfers.map(({ from, to, amount }) => ({ from: translate(from), to: translate(to), amount })),
  }

  return {
    legacyBalance,
    expenses: expenses.map((expense) => {
      const paidBy = translate(expense.paidBy)
      const oldShares = expense.splitMemberUids
        ? splitExpense(expense.amount, expense.splitMemberUids, expense.paidBy)
        : legacyShares.get(expense.id)
      const shares = oldShares?.map(({ participantId, amount }) => ({ participantId: translate(participantId), amount })) ?? null
      return {
        id: expense.id,
        paidBy,
        createdBy: translate(expense.createdBy || expense.paidBy),
        updatedBy: translate(expense.updatedBy || expense.createdBy || expense.paidBy),
        shares,
        participation: shares ? captureExpenseParticipation(participants, paidBy, shares.map(({ participantId }) => participantId)) : {},
      }
    }),
  }
}
