# Step 1: meeting-flow

## 읽어야 할 파일

먼저 아래 파일들을 읽고 이전 step의 구현을 파악하라:
- `/docs/ARCHITECTURE.md`
- `/src/pages/Onboarding.tsx` (step0 결과)
- `/src/pages/Home.tsx` (step0 결과)
- `/src/pages/MeetingNew.tsx`
- `/src/pages/MeetingDetail.tsx`
- `/src/store/userStore.ts`

TDS 컴포넌트 레퍼런스가 필요하면 `/docs/skills/tds-mobile.md`에서 검색하라.

## 작업

MeetingNew (방 만들기)와 MeetingDetail (정산방 상세) 페이지 UI를 구현하라.
Firebase 연동 없이 UI 레이아웃과 상태 관리만 구현한다.

### 1. `src/pages/MeetingNew.tsx` 구현

모임을 만들기 위한 입력 폼 화면.

**레이아웃:**
```
[Top — "새 정산방"]
[스크롤 폼 영역]
  TextField — 방 이름 (variant="box", label="방 이름", placeholder="예: 제주도 여행", 필수)
  TextField — 날짜 (variant="box", label="날짜", 기본값: 오늘 "YYYY.MM.DD" 형식, type="date" 또는 text)
  TextField — 참여자 (variant="box", label="참여자", placeholder="예: 민수, 지현, 나", 쉼표로 구분)
  TextField — 한줄 메모 (variant="box", label="한줄 메모", placeholder="예: 제주 2박 3일", 선택)
[FixedBottomCTA.Single — "정산방 만들기" (방 이름 1자 이상 입력 시 활성)]
```

**동작:**
- 날짜 기본값: `new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace('.', '')` 형식 또는 `YYYY.MM.DD`
- "정산방 만들기" 클릭 → 현재는 console.log로 폼 데이터 출력 (Firebase 연동은 Phase 2)
- Top에 뒤로가기 처리: `useNavigate`의 `navigate(-1)`

**TDS 컴포넌트:**
- `Top`, `Top.TitleParagraph`
- `TextField` (variant="box")
- `FixedBottomCTA.Single`

### 2. `src/pages/MeetingDetail.tsx` 구현

정산방의 전체 내용을 보여주는 메인 화면.

**레이아웃:**
```
[Top — 방 이름 (placeholder: "정산방")]
[대표 사진 영역]
  사진 없음 상태:
    배경: 회색 박스 (높이 200px)
    텍스트: "오늘을 대표할 사진을 추가해보세요"
    버튼: "사진 추가" (클릭 시 console.log — Phase 2에서 구현)
[정보 영역]
  날짜 · 한줄 메모
  참여자 칩 목록 (닉네임 태그들)
  총 지출 N원 · 1인당 N원
[비용 목록]
  비용 없음 상태: "아직 비용이 없어요"
  비용 있음 상태: 각 항목 (paidBy 닉네임 · 금액 · 메모)
[하단 버튼 영역 — FixedBottomCTA.Double 또는 버튼 3개]
  "내가 낸 비용 추가" → /meetings/:id/expense
  "정산 결과 보기" → /meetings/:id/settle
  "초대 링크 공유" → console.log (Phase 2에서 shareInviteLink 연결)
```

**Props/State (mock 데이터로 UI 확인):**
```ts
// MeetingDetail 내부 mock 상태 (나중에 Firebase 훅으로 교체)
const meeting = {
  name: '제주도 여행',
  date: '2026.06.11',
  memo: '제주 2박 3일',
  photoUrl: null as string | null,
}
const members: Record<string, string> = { 'uid1': '민수', 'uid2': '지현' }
const expenses: Array<{ id: string; amount: number; paidBy: string; memo: string }> = []
```

**동작:**
- URL에서 `useParams`로 `id` 추출
- 총 지출 = expenses 합계, 1인당 = 총 지출 / member 수 (0이면 "0원")
- 금액 포맷: `toLocaleString('ko-KR')` + "원"

**TDS 컴포넌트:**
- `Top`, `Top.TitleParagraph`
- `FixedBottomCTA` (버튼 2개 또는 3개에 맞게 선택)
- 참여자 칩: TDS Badge 또는 커스텀 span 태그

**하단 버튼 배치 방법:**
- FixedBottomCTA.Single로 "내가 낸 비용 추가" 배치
- 그 위에 일반 버튼 2개 ("정산 결과 보기", "초대 링크 공유") 배치

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
npm run lint    # ESLint 통과
```

## 검증 절차

1. AC 커맨드를 실행한다.
2. TypeScript 컴파일 에러가 없는지 확인한다.
3. MeetingNew: 4개 TextField + FixedBottomCTA, 방 이름 validation 로직 확인.
4. MeetingDetail: 사진 없음 상태, 참여자 칩, 비용 없음 상태, 하단 버튼 3개 확인.
5. phases/1-core-ui/index.json의 step1 status를 업데이트한다:
   - 성공 → "completed", summary: "MeetingNew(폼 4개), MeetingDetail(사진/참여자/비용/버튼 레이아웃) UI 구현 완료"
   - 실패 → "error", error_message에 에러 내용 기록

## 금지사항
- Top 컴포넌트를 빠뜨리지 마라.
- eval(), Function() 사용 금지.
- Firebase 직접 호출 금지 (UI만).
- 이미지 처리에 eval() 또는 Function() 사용 금지.
