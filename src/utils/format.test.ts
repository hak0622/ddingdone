import { describe, it, expect } from 'vitest'
import { formatKRW } from './format'

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
