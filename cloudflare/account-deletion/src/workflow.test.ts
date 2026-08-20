import { describe, expect, it } from 'vitest'
import { sha256Hex, stableStringify } from './crypto'
import type { FirestoreRecord } from './types'
import { anonymizeSettlementSnapshot } from './anonymization'

describe('anonymizeSettlementSnapshot', () => {
  it('탈퇴자 UID를 방별 익명 ID로 치환하고 새 해시를 만든다', async () => {
    const settlement: FirestoreRecord = {
      id: 'final',
      data: {
        schemaVersion: 1,
        totalAmount: 3000,
        participantCount: 2,
        participantIds: ['user-1', 'user-2'],
        participantNames: { 'user-1': '탈퇴자', 'user-2': '남은 사람' },
        participantPaidTotals: { 'user-1': 1000, 'user-2': 2000 },
        transfers: [{ from: 'user-1', to: 'user-2', amount: 500 }],
        finalizedBy: 'user-1',
        hash: 'old-hash',
      },
    }

    const result = await anonymizeSettlementSnapshot('request-1', 'user-1', 'meeting-1', settlement)
    const anonymousId = (result.participantIds as string[])[0]
    expect(anonymousId).toMatch(/^withdrawn_[0-9a-f]{24}$/u)
    expect(stableStringify(result)).not.toContain('user-1')
    expect(result.participantNames).toMatchObject({ [anonymousId]: '탈퇴한 사용자' })
    expect(result.finalizedBy).toBe(anonymousId)

    const core = {
      schemaVersion: result.schemaVersion,
      totalAmount: result.totalAmount,
      participantCount: result.participantCount,
      participantIds: result.participantIds,
      participantNames: result.participantNames,
      participantPaidTotals: result.participantPaidTotals,
      transfers: result.transfers,
    }
    expect(result.hash).toBe(await sha256Hex(stableStringify(core)))
  })
})
