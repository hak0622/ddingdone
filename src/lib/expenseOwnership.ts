export const EXPENSE_SCHEMA_VERSION = 2

type ExpenseOwnershipFields = {
  createdBy?: unknown
  paidBy?: unknown
}

// 2026-06-29 운영 시작 당시 비용 문서에는 createdBy가 없었지만, 앱과 보안
// 규칙이 paidBy를 요청자의 Firebase UID로 강제했다. 기존 문서는 paidBy를
// 작성자로 사용하고, 신규 문서는 명시적인 createdBy를 우선 사용한다.
export function getExpenseAuthorUid(expense: ExpenseOwnershipFields): string {
  if (typeof expense.createdBy === 'string' && expense.createdBy.length > 0) {
    return expense.createdBy
  }
  return typeof expense.paidBy === 'string' ? expense.paidBy : ''
}

