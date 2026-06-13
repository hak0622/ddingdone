# Step 1: router-layout

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트 구조와 설계 의도를 파악하라:
- `/docs/ARCHITECTURE.md`
- `/docs/PRD.md`
- `/src/lib/firebase.ts` (step0 결과)
- `/src/lib/bridge.ts` (step0 결과)
- `/src/main.tsx`
- `/src/App.tsx`

## 작업

라우팅 구조, 앱 진입 로직, 공통 상태를 구현하라.

### 1. `src/store/userStore.ts` 확인/생성 (Zustand)

```ts
import { create } from 'zustand'

interface UserStore {
  uid: string
  nickname: string
  setUser: (uid: string, nickname: string) => void
}

export const useUserStore = create<UserStore>((set) => ({
  uid: '',
  nickname: '',
  setUser: (uid, nickname) => set({ uid, nickname }),
}))
```

### 2. `src/App.tsx` 확인/수정

앱 진입 시 아래 순서로 처리하는 `AppInit` 컴포넌트:
1. localStorage `ddingdone_uid` 확인 → 없으면 `getAnonymousUid()` (토스) 또는 `signInAnonymously()` (Firebase fallback) 호출
2. localStorage에 uid 저장, `setUser` 호출
3. URL 파라미터 `?meeting={id}` 있으면 `/meetings/{id}`로 redirect
4. localStorage `ddingdone_nickname` 없으면 `/onboarding`으로 redirect
5. 위 조건 없으면 `/`(홈)으로

**상수:**
```ts
const NICKNAME_KEY = 'ddingdone_nickname'
const UID_KEY = 'ddingdone_uid'
```

**7개 라우트:**
- `/_init` → AppInit (진입점)
- `/onboarding` → Onboarding.tsx
- `/` → Home.tsx
- `/meetings/new` → MeetingNew.tsx
- `/meetings/:id` → MeetingDetail.tsx
- `/meetings/:id/expense` → ExpenseInput.tsx
- `/meetings/:id/settle` → Settle.tsx
- `*` → Navigate to `/_init` (wildcard)

### 3. 각 페이지 파일 확인/생성 (`src/pages/` 아래 6개)

각 파일은 반드시:
- `@toss/tds-mobile`의 `Top` 컴포넌트를 화면 상단에 배치 (심사 필수)
- 페이지 이름을 표시하는 placeholder 텍스트

```tsx
// 예시: Onboarding.tsx
import { Top } from '@toss/tds-mobile'
export default function Onboarding() {
  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>닉네임 입력</Top.TitleParagraph>} />
    </>
  )
}
```

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
```

## 검증 절차

1. AC 커맨드를 실행한다.
2. 7개 라우트가 모두 정의되어 있는지 확인한다.
3. 모든 페이지에 Top 컴포넌트가 있는지 확인한다.
4. ARCHITECTURE.md 디렉토리 구조를 따르는지 확인한다.
5. phases/0-bootstrap/index.json의 step1 status를 업데이트한다:
   - 성공 → "completed", summary: "라우팅 7개, 페이지 컴포넌트 6개, userStore, AppInit 생성/확인 완료"
   - 실패 → "error", error_message에 에러 내용 기록

## 금지사항
- Top 컴포넌트를 빠뜨리지 마라. 모든 페이지에 필수.
- SSR 관련 코드 사용 금지.
- eval() 사용 금지.
- 기존에 올바르게 구현된 파일은 불필요하게 재작성하지 마라.
