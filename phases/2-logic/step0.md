# Step 0: settle-algorithm

## 읽어야 할 파일

- `src/pages/Settle.tsx` (현재 mock 데이터 상태 파악)
- `docs/ARCHITECTURE.md`

## 작업

정산 알고리즘과 단위 테스트를 구현하라.

### 1. `src/utils/settle.ts`

Splitwise 방식의 최소 송금 횟수 정산 알고리즘.

```ts
export type Expense = {
  amount: number
  paidBy: string   // uid
}

export type Members = Record<string, string>  // uid → nickname

export type Settlement = {
  from: string      // uid (보내는 사람)
  fromName: string  // nickname
  to: string        // uid (받는 사람)
  toName: string    // nickname
  amount: number
}

/**
 * Splitwise 알고리즘: 최소 송금 횟수로 정산
 * 1. 각 멤버의 순잔액 = 본인이 낸 금액 합계 - (총액 / 멤버 수)
 * 2. 최대 채권자 ↔ 최대 채무자 greedy 매칭
 * 3. min(채권, 채무) 만큼 정산 후 반복
 */
export function calculateSettlements(
  expenses: Expense[],
  members: Members,
): Settlement[]
```

**엣지 케이스:**
- 멤버가 0명이거나 expenses가 비면 빈 배열 반환
- 총액이 0이면 빈 배열 반환
- 소수점은 Math.round로 처리
- 정산 금액이 1원 미만이면 해당 항목 제외

### 2. `src/utils/settle.test.ts`

Vitest 단위 테스트. `import { describe, it, expect } from 'vitest'` 사용.

테스트 케이스:
```
케이스 1: 3명, 균등 (각자 30,000원씩 → 정산 없음)
케이스 2: 3명, 한 명이 전액 (90,000원) → 두 명이 각 30,000원 보냄
케이스 3: 2명, A가 60,000원 냄 → B가 30,000원 보냄
케이스 4: 빈 expenses → 빈 배열
케이스 5: 멤버 1명 → 빈 배열
```

## Acceptance Criteria

```bash
npx vitest run src/utils/settle.test.ts  # 테스트 전체 통과
npm run build                             # 컴파일 에러 없이 성공
```

## 검증 절차

1. AC 커맨드 실행 및 확인.
2. phases/2-logic/index.json step0 status 업데이트:
   - 성공 → "completed", summary: "settle.ts Splitwise 알고리즘 + 단위테스트 구현 완료"
   - 실패 → "error"

## 금지사항
- eval(), Function() 사용 금지.
- Firebase 직접 호출 금지 (순수 함수만).
