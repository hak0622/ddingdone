import { describe, expect, it } from 'vitest'
import {
  buildSettlementSnapshot,
  hashSettlementSnapshot,
  snapshotToSettlements,
} from './settlementSnapshot'

describe('settlement snapshot', () => {
  it('방의 memberUids 순서를 유지하며 납부 합계와 송금 결과를 고정한다', () => {
    const snapshot = buildSettlementSnapshot(
      ['uid2', 'uid1'],
      { uid1: '민수', uid2: '지현' },
      [
        { amount: 10000, paidBy: 'uid1' },
        { amount: 20000, paidBy: 'uid1' },
      ],
    )

    expect(snapshot.participantIds).toEqual(['uid2', 'uid1'])
    expect(snapshot.participantPaidTotals).toEqual({ uid2: 0, uid1: 30000 })
    expect(snapshot.totalAmount).toBe(30000)
    expect(snapshot.transfers).toEqual([{ from: 'uid2', to: 'uid1', amount: 15000 }])
  })

  it('같은 데이터는 객체 키 순서와 무관하게 같은 해시를 만든다', async () => {
    const first = buildSettlementSnapshot(
      ['uid1', 'uid2'],
      { uid1: '민수', uid2: '지현' },
      [{ amount: 10000, paidBy: 'uid1' }],
    )
    const second = {
      ...first,
      participantNames: { uid2: '지현', uid1: '민수' },
      participantPaidTotals: { uid2: 0, uid1: 10000 },
    }

    await expect(hashSettlementSnapshot(first)).resolves.toBe(await hashSettlementSnapshot(second))
  })

  it('저장된 UID와 이름으로 화면용 정산 결과를 복원한다', () => {
    const snapshot = buildSettlementSnapshot(
      ['uid1', 'uid2'],
      { uid1: '민수', uid2: '지현' },
      [{ amount: 20000, paidBy: 'uid1' }],
    )
    expect(snapshotToSettlements(snapshot)).toEqual([
      { from: 'uid2', fromName: '지현', to: 'uid1', toName: '민수', amount: 10000 },
    ])
  })
})

