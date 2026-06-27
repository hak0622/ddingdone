export function formatKRW(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}

const MEMBER_NAME_MAX_LENGTH = 3

export function truncateName(name: string): string {
  return name.length > MEMBER_NAME_MAX_LENGTH ? `${name.slice(0, MEMBER_NAME_MAX_LENGTH)}...` : name
}
