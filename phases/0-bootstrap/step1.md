# Step 1: router-layout

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트 구조와 설계 의도를 파악하라:
- `/docs/ARCHITECTURE.md`
- `/docs/PRD.md`
- `/src/lib/firebase.ts` (step0 결과)
- `/src/main.tsx`
- `/src/App.tsx`

## 작업

라우팅 구조, 앱 진입 로직, 공통 상태를 구현하라.

### 1. `src/main.tsx` 수정
- `BrowserRouter`로 App을 감싸라 (`react-router-dom` 사용)

### 2. `src/App.tsx` 수정
앱 진입 시 아래 순서로 처리하라:
- Firebase Anonymous Auth `signInAnonymously` 호출 → UID 획득
- URL 파라미터 `?meeting={id}` 있으면 `/meetings/{id}`로 redirect
- localStorage에 `ddingdone_nickname`이 없으면 `/onboarding`으로 redirect
- 위 조건 없으면 `/`(홈)으로

6개 라우트를 정의하라 (빈 페이지 컴포넌트로):
- `/onboarding` → `src/pages/Onboarding.tsx`
- `/` → `src/pages/Home.tsx`
- `/meetings/new` → `src/pages/MeetingNew.tsx`
- `/meetings/:id` → `src/pages/MeetingDetail.tsx`
- `/meetings/:id/expense` → `src/pages/ExpenseInput.tsx`
- `/meetings/:id/settle` → `src/pages/Settle.tsx`

### 3. `src/store/userStore.ts` 생성 (Zustand)
```ts
interface UserStore {
  uid: string;
  nickname: string;
  setUser: (uid: string, nickname: string) => void;
}
```

### 4. 각 페이지 파일 생성 (`src/pages/` 아래 6개)
각 파일은 최소한 아래를 포함해야 한다:
- `@apps-in-toss/web-framework`의 `Top` 컴포넌트를 화면 상단에 배치 (심사 필수)
- 페이지 이름을 표시하는 placeholder 텍스트

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
npm run dev     # 브라우저에서 / 접근 시 홈 페이지 렌더링 확인
```

## 검증 절차

1. AC 커맨드를 실행한다.
2. 6개 라우트가 모두 접근 가능한지 확인한다.
3. ARCHITECTURE.md 디렉토리 구조를 따르는지 확인한다.
4. phases/0-bootstrap/index.json의 step1 status를 업데이트한다:
   - 성공 → "completed", summary: "라우팅 6개, 페이지 컴포넌트, userStore 생성 완료"

## 금지사항
- Top 컴포넌트를 빠뜨리지 마라. 모든 페이지에 필수.
- SSR 관련 코드 사용 금지.
- eval() 사용 금지.
