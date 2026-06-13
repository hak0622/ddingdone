# Step 0: onboarding-home

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트 구조와 설계 의도를 파악하라:
- `/docs/ARCHITECTURE.md`
- `/docs/PRD.md`
- `/src/App.tsx`
- `/src/pages/Onboarding.tsx`
- `/src/pages/Home.tsx`
- `/src/store/userStore.ts`

TDS 컴포넌트 레퍼런스가 필요하면 `/docs/skills/tds-mobile.md`에서 해당 컴포넌트명을 검색하라.
(예: `rg "FixedBottomCTA" docs/skills/tds-mobile.md | head -20`)

## 작업

Onboarding 페이지와 Home 페이지의 실제 UI를 구현하라.

### 1. `src/pages/Onboarding.tsx` 구현

닉네임을 입력받아 localStorage에 저장하는 온보딩 화면.

**레이아웃:**
```
[Top — "닉네임 설정"]
[본문 영역]
  "반가워요! 어떻게 불러드릴까요?"
  TextField (variant="big", label="닉네임", placeholder="예: 민수")
[FixedBottomCTA.Single — "시작하기" (닉네임 1자 이상 입력 시 활성)]
```

**동작:**
- `useUserStore`에서 `uid`, `setUser` 가져오기
- 닉네임 입력 → `localStorage.setItem('ddingdone_nickname', value)` + `setUser(uid, value)`
- "시작하기" 버튼 클릭 → `/` (Home)으로 navigate

**TDS 컴포넌트:**
- `Top`, `Top.TitleParagraph` — 상단 바
- `TextField` — 닉네임 입력 (`variant="big"`)
- `FixedBottomCTA.Single` — 하단 고정 버튼

**import 경로:** `@toss/tds-mobile`

### 2. `src/pages/Home.tsx` 구현

내 정산방 목록을 보여주는 홈 화면. 이 step에서는 Firebase 연동 없이 UI만 구현한다.
(실제 데이터 연동은 Phase 2에서 한다)

**레이아웃 - 빈 상태 (meetings 배열이 비어있을 때):**
```
[Top — "띵돈"]
[중앙 영역]
  "아직 정산방이 없어요"
  "모임 후 정산을 시작해보세요"
[FixedBottomCTA.Single — "첫 정산방 만들기"]
```

**레이아웃 - 목록 상태 (meetings 배열에 항목이 있을 때):**
```
[Top — "내 정산방"]
[스크롤 영역]
  MeetingCard (방이름 / 날짜 / 참여자 수 / 총 지출)
  ...반복
[하단 고정 버튼 — "+ 새 정산방 만들기"]
```

**MeetingCard 타입 (이 파일 안에 정의):**
```ts
interface MeetingCard {
  id: string
  name: string
  date: string
  memberCount: number
  totalAmount: number
}
```

**동작:**
- "첫 정산방 만들기" / "+ 새 정산방 만들기" 클릭 → `/meetings/new`로 navigate
- MeetingCard 클릭 → `/meetings/{id}`로 navigate
- 초기 상태: `meetings: MeetingCard[] = []` (빈 배열 → 빈 상태 UI 표시)

**TDS 컴포넌트:**
- `Top`, `Top.TitleParagraph`
- `FixedBottomCTA.Single`
- ListRow 또는 커스텀 카드 (TDS에 적합한 컴포넌트 사용)

**금액 포맷:** `toLocaleString('ko-KR')` + "원"

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
npm run lint    # ESLint 통과
```

## 검증 절차

1. AC 커맨드를 실행한다.
2. TypeScript 컴파일 에러가 없는지 확인한다.
3. Onboarding: TextField + FixedBottomCTA 렌더링, 닉네임 입력 시 버튼 활성화 로직이 있는지 확인한다.
4. Home: 빈 상태 / 목록 상태 분기 로직이 있는지 확인한다.
5. phases/1-core-ui/index.json의 step0 status를 업데이트한다:
   - 성공 → "completed", summary: "Onboarding(TextField+FixedBottomCTA), Home(빈상태/목록 분기) UI 구현 완료"
   - 실패 → "error", error_message에 에러 내용 기록

## 금지사항
- Top 컴포넌트를 빠뜨리지 마라. 모든 페이지에 필수 (심사 요구사항).
- eval(), Function() 사용 금지.
- SSR 관련 코드 사용 금지.
- Firebase 직접 호출 금지 (이 step에서는 UI만 구현).
- clipboard, share 기능에 native API 직접 사용 금지 (Bridge API 사용).
