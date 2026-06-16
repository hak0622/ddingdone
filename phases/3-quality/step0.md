# Step 0: vitest-setup

## 읽어야 할 파일

- `package.json` (스크립트 및 의존성 현황)
- `vite.config.ts` (현재 vite 설정)
- `src/utils/settle.test.ts` (기존 테스트 파일 — 이미 동작 중)
- `src/utils/format.ts` (테스트 대상 함수)

## 작업

### 1. `package.json`에 테스트 스크립트 추가

`scripts` 블록에 아래 두 항목을 추가하라:

```json
"test": "vitest run",
"test:watch": "vitest"
```

### 2. `vitest.config.ts` 생성

프로젝트 루트에 아래 내용으로 생성하라:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
```

### 3. `src/utils/format.test.ts` 생성

`formatKRW` 함수에 대한 단위 테스트를 작성하라.

```ts
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
```

## Acceptance Criteria

```bash
npm run test   # settle.test.ts + format.test.ts 모두 통과 (총 8개 이상 테스트)
npm run build  # 컴파일 에러 없이 성공
```

## 검증 절차

1. AC 커맨드를 실행해 확인한다.
2. `phases/3-quality/index.json` step0 status 업데이트:
   - 성공 → `"completed"`, summary: `"vitest 설정 완료, format.test.ts 3개 + settle.test.ts 5개 통과"`
   - 실패 → `"error"` + `"error_message"` 기록

## 금지사항

- 기존 `src/utils/settle.test.ts` 파일을 수정하지 말 것.
- `vite.config.ts`에 test 설정을 추가하지 말 것 — 별도 `vitest.config.ts`를 사용한다.
