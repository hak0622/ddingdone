# Step 2: style-tokens

## 읽어야 할 파일

- `src/pages/History.tsx`
- `src/pages/Settings.tsx`
- `src/pages/Home.tsx`

## 작업

반복되는 디자인 값들을 상수로 추출하여 코드 중복을 줄인다.  
`ait build`가 CSS modules를 지원하는지 불명확하므로, 인라인 스타일을 유지하되 공유 상수를 사용한다.

### 1. `src/styles/tokens.ts` 생성

```ts
export const COLORS = {
  primary: '#3182F6',
  text: '#191919',
  textSecondary: '#888',
  textMuted: '#bbb',
  border: '#e0e0e0',
  borderLight: '#f0f0f0',
  background: '#fff',
  backgroundGray: '#f5f5f5',
  error: '#ef4444',
  success: '#22c55e',
  disabled: '#e8e8e8',
  disabledText: '#999',
} as const

export const FONT_SIZE = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  xl: 16,
  '2xl': 18,
  '3xl': 20,
  '4xl': 22,
  '5xl': 24,
  hero: 40,
} as const

export const RADIUS = {
  sm: 8,
  md: 10,
  lg: 12,
  full: 20,
  pill: 24,
} as const
```

### 2. `src/pages/History.tsx` 수정

아래 인라인 색상값들을 tokens에서 가져오도록 교체:

- `'#3182F6'` → `COLORS.primary`
- `'#f5f5f5'` → `COLORS.backgroundGray`
- `'#fff'` → `COLORS.background`
- `'#888'` → `COLORS.textSecondary`
- `'#bbb'` → `COLORS.textMuted`
- `'#8b8b8b'` → `COLORS.textSecondary`

파일 상단에 import 추가:
```ts
import { COLORS } from '../styles/tokens'
```

### 3. `src/pages/Settings.tsx` 수정

아래 인라인 색상값들을 tokens에서 가져오도록 교체:

- `'#22c55e'` → `COLORS.success`
- `'#3182F6'` → `COLORS.primary`
- `'#e8e8e8'` → `COLORS.disabled`
- `'#fff'` → `COLORS.background`
- `'#999'` → `COLORS.disabledText`

파일 상단에 import 추가:
```ts
import { COLORS } from '../styles/tokens'
```

## Acceptance Criteria

```bash
npm run test   # 기존 테스트 통과 (회귀 없음)
npm run build  # 컴파일 에러 없이 성공
```

## 검증 절차

1. AC 커맨드를 실행해 확인한다.
2. `phases/3-quality/index.json` step2 status 업데이트:
   - 성공 → `"completed"`, summary: `"src/styles/tokens.ts 생성, History/Settings 인라인 색상 → COLORS 토큰 교체"`
   - 실패 → `"error"` + `"error_message"` 기록

## 금지사항

- 다른 페이지 파일(MeetingDetail.tsx, Home.tsx 등)은 이 step에서 수정하지 말 것.
- 기존 인라인 스타일 객체 구조를 바꾸지 말 것 — 값만 상수로 교체.
- CSS 파일, CSS 모듈(.module.css) 생성 금지.
