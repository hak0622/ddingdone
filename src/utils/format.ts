export function formatKRW(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}

const MEMBER_NAME_MAX_LENGTH = 3

export function truncateName(name: string): string {
  return name.length > MEMBER_NAME_MAX_LENGTH ? `${name.slice(0, MEMBER_NAME_MAX_LENGTH)}...` : name
}

// 비용 메모 입력창의 글자수 제한(9자)과 맞춘다. 입력 제한은 새로 적는
// 메모에만 적용되므로, 제한이 생기기 전에 길게 적힌 과거 메모를 보여줄 때도
// 화면이 깨지지 않도록 표시 시점에 한 번 더 잘라준다.
const EXPENSE_MEMO_MAX_LENGTH = 9

export function truncateMemo(memo: string): string {
  return memo.length > EXPENSE_MEMO_MAX_LENGTH ? `${memo.slice(0, EXPENSE_MEMO_MAX_LENGTH)}...` : memo
}
