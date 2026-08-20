import { describe, expect, it } from 'vitest'
import { readBearerToken } from './auth'

describe('readBearerToken', () => {
  it('Bearer 토큰만 허용한다', () => {
    expect(readBearerToken(new Request('https://worker.test', {
      headers: { Authorization: 'Bearer valid-token' },
    }))).toBe('valid-token')
    expect(readBearerToken(new Request('https://worker.test', {
      headers: { Authorization: 'Basic valid-token' },
    }))).toBeNull()
    expect(readBearerToken(new Request('https://worker.test', {
      headers: { Authorization: 'Bearer token with spaces' },
    }))).toBeNull()
  })
})
