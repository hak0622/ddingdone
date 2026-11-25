export interface ExpenseShare {
  participantId: string
  amount: number
}

export interface SplitExpense {
  paidBy: string
  amount: number
  shares: readonly ExpenseShare[]
}

export interface Payment {
  from: string
  to: string
  amount: number
}

export function splitExpense(amount: number, participantIds: readonly string[], paidBy?: string): ExpenseShare[] {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !participantIds.length ||
      new Set(participantIds).size !== participantIds.length) {
    throw new RangeError('Invalid expense amount or participants')
  }

  const base = Math.floor(amount / participantIds.length)
  const remainder = amount % participantIds.length
  // When the payer shares this expense, allocate the first extra won to them.
  // Otherwise use the recorded participant order, including for old room totals.
  const remainderOrder = paidBy && participantIds.includes(paidBy)
    ? [paidBy, ...participantIds.filter((id) => id !== paidBy)]
    : participantIds
  const extraWonRecipients = new Set(remainderOrder.slice(0, remainder))
  return participantIds.map((participantId) => ({
    participantId,
    amount: base + Number(extraWonRecipients.has(participantId)),
  }))
}

export function netPayments(payments: Iterable<Payment>): Payment[] {
  const pairs = new Map<string, Payment>()
  for (const { from, to, amount } of payments) {
    if (from === to || amount === 0) continue
    const [first, second] = from < to ? [from, to] : [to, from]
    const key = JSON.stringify([first, second])
    const total = (pairs.get(key)?.amount ?? 0) + (from === first ? amount : -amount)
    pairs.set(key, { from: first, to: second, amount: total })
  }

  return [...pairs.values()].flatMap(({ from, to, amount }) => {
    if (amount === 0) return []
    return [amount > 0 ? { from, to, amount } : { from: to, to: from, amount: -amount }]
  })
}

export function calculateExpensePayments(expenses: readonly SplitExpense[]): Payment[] {
  return netPayments(expenses.flatMap(({ paidBy, shares }) => shares.map((share) => ({
    from: share.participantId,
    to: paidBy,
    amount: share.amount,
  }))))
}

export function groupExpensesByPayer<T extends { paidBy: string; amount: number }>(expenses: readonly T[]) {
  const groups = new Map<string, { paidBy: string; total: number; expenses: T[] }>()
  for (const expense of expenses) {
    const group = groups.get(expense.paidBy)
    if (group) {
      group.total += expense.amount
      group.expenses.push(expense)
    } else {
      groups.set(expense.paidBy, { paidBy: expense.paidBy, total: expense.amount, expenses: [expense] })
    }
  }
  return [...groups.values()]
}
