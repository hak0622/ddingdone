import { describe, it, expect } from 'vitest'
import { calculateSettlements } from './settle'

describe('calculateSettlements', () => {
  it('케이스 1: 3명 균등 분담 → 정산 없음', () => {
    const expenses = [
      { amount: 30000, paidBy: 'uid1' },
      { amount: 30000, paidBy: 'uid2' },
      { amount: 30000, paidBy: 'uid3' },
    ]
    const members = { uid1: '민수', uid2: '지현', uid3: '하늘' }
    const result = calculateSettlements(expenses, members)
    expect(result).toEqual([])
  })

  it('케이스 2: 3명, 한 명이 전액(90,000원) → 두 명이 각 30,000원 보냄', () => {
    const expenses = [{ amount: 90000, paidBy: 'uid1' }]
    const members = { uid1: '민수', uid2: '지현', uid3: '하늘' }
    const result = calculateSettlements(expenses, members)
    expect(result).toHaveLength(2)
    const totalSent = result.reduce((sum, s) => sum + s.amount, 0)
    expect(totalSent).toBe(60000)
    for (const s of result) {
      expect(s.to).toBe('uid1')
      expect(s.amount).toBe(30000)
    }
  })

  it('케이스 3: 2명, A가 60,000원 냄 → B가 30,000원 보냄', () => {
    const expenses = [{ amount: 60000, paidBy: 'uid1' }]
    const members = { uid1: 'A', uid2: 'B' }
    const result = calculateSettlements(expenses, members)
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe('uid2')
    expect(result[0].to).toBe('uid1')
    expect(result[0].amount).toBe(30000)
  })

  it('케이스 4: 빈 expenses → 빈 배열', () => {
    const result = calculateSettlements([], { uid1: '민수', uid2: '지현' })
    expect(result).toEqual([])
  })

  it('케이스 5: 멤버 1명 → 빈 배열', () => {
    const expenses = [{ amount: 10000, paidBy: 'uid1' }]
    const result = calculateSettlements(expenses, { uid1: '민수' })
    expect(result).toEqual([])
  })
})
