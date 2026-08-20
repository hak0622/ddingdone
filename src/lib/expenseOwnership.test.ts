import { describe, expect, it } from 'vitest'
import { getExpenseAuthorUid } from './expenseOwnership'

describe('getExpenseAuthorUid', () => {
  it('신규 비용은 createdBy를 작성자로 사용한다', () => {
    expect(getExpenseAuthorUid({ createdBy: 'creator', paidBy: 'payer' })).toBe('creator')
  })

  it('기존 비용은 paidBy를 작성자로 사용한다', () => {
    expect(getExpenseAuthorUid({ paidBy: 'legacy-payer' })).toBe('legacy-payer')
  })

  it('유효한 식별자가 없으면 빈 문자열을 반환한다', () => {
    expect(getExpenseAuthorUid({ createdBy: null, paidBy: null })).toBe('')
  })
})

