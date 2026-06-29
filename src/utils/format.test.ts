import { describe, it, expect } from 'vitest'
import { formatKRW, truncateMemo } from './format'

describe('formatKRW', () => {
  it('1000 → "1,000원"', () => {
    expect(formatKRW(1000)).toBe('1,000원')
  })
  it('0 → "0원"', () => {
    expect(formatKRW(0)).toBe('0원')
  })
  it('1234567 → "1,234,567원"', () => {
    expect(formatKRW(1234567)).toBe('1,234,567원')
  })
})

describe('truncateMemo', () => {
  it('9자 이하는 그대로 반환한다', () => {
    expect(truncateMemo('저녁 삼겹살')).toBe('저녁 삼겹살')
  })
  it('9자를 넘으면 9자까지만 자르고 ...을 붙인다 (입력 제한 전 과거 메모 보호)', () => {
    expect(truncateMemo('아주아주아주아주아주길게적은메모입니다')).toBe('아주아주아주아주아...')
  })
})
