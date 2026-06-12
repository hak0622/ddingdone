export type Expense = {
  amount: number
  paidBy: string
}

export type Members = Record<string, string>

export type Settlement = {
  from: string
  fromName: string
  to: string
  toName: string
  amount: number
}

export function calculateSettlements(
  expenses: Expense[],
  members: Members,
): Settlement[] {
  const memberIds = Object.keys(members)
  if (memberIds.length === 0 || expenses.length === 0) return []

  const total = expenses.reduce((sum, e) => sum + e.amount, 0)
  if (total === 0) return []

  const share = total / memberIds.length

  const balances: Record<string, number> = {}
  for (const uid of memberIds) {
    balances[uid] = 0
  }
  for (const expense of expenses) {
    if (balances[expense.paidBy] !== undefined) {
      balances[expense.paidBy] += expense.amount
    }
  }
  for (const uid of memberIds) {
    balances[uid] = Math.round(balances[uid] - share)
  }

  const creditors: Array<{ uid: string; amount: number }> = []
  const debtors: Array<{ uid: string; amount: number }> = []

  for (const uid of memberIds) {
    if (balances[uid] > 0) creditors.push({ uid, amount: balances[uid] })
    else if (balances[uid] < 0) debtors.push({ uid, amount: -balances[uid] })
  }

  const settlements: Settlement[] = []

  let ci = 0
  let di = 0
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]
    const debtor = debtors[di]
    const amount = Math.min(creditor.amount, debtor.amount)

    if (amount >= 1) {
      settlements.push({
        from: debtor.uid,
        fromName: members[debtor.uid],
        to: creditor.uid,
        toName: members[creditor.uid],
        amount,
      })
    }

    creditor.amount -= amount
    debtor.amount -= amount

    if (creditor.amount === 0) ci++
    if (debtor.amount === 0) di++
  }

  return settlements
}
