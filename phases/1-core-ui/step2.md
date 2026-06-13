# Step 2: expense-settle-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 이전 step의 구현을 파악하라:
- `/docs/ARCHITECTURE.md`
- `/src/pages/MeetingNew.tsx` (step1 결과)
- `/src/pages/MeetingDetail.tsx` (step1 결과)
- `/src/pages/ExpenseInput.tsx`
- `/src/pages/Settle.tsx`
- `/src/store/userStore.ts`

TDS 컴포넌트 레퍼런스가 필요하면 `/docs/skills/tds-mobile.md`에서 검색하라.

## 작업

ExpenseInput (비용 입력)과 Settle (정산 결과) 페이지 UI를 구현하라.
Firebase 연동 없이 UI 레이아웃과 상태 관리만 구현한다.

### 1. `src/pages/ExpenseInput.tsx` 구현

내가 낸 비용을 입력하는 화면.

**레이아웃:**
```
[Top — "비용 추가"]
[스크롤 폼 영역]
  TextField — 금액 (variant="big" 또는 "hero", label="얼마를 냈나요?", placeholder="0", inputMode="numeric", 필수)
    → 입력 시 천단위 콤마 표시 (toLocaleString)
  TextField — 메모 (variant="box", label="내용", placeholder="예: 숙소 비용", 선택)
  [누가 냈나요? 섹션]
    "누가 냈나요?" 라벨
    참여자 목록을 라디오/선택 형태로 표시
    (각 항목: 닉네임 텍스트, 선택 시 체크 표시)
[FixedBottomCTA.Single — "추가하기" (금액 > 0 && paidBy 선택 시 활성)]
```

**Props/State:**
```ts
// URL에서 meetingId 추출
const { id: meetingId } = useParams()

// mock 참여자 (Phase 2에서 Firebase 훅으로 교체)
const members: Record<string, string> = { 'uid1': '민수', 'uid2': '지현', 'uid3': '나' }

// 폼 상태
const [amount, setAmount] = useState('')
const [memo, setMemo] = useState('')
const [paidBy, setPaidBy] = useState('')
```

**동작:**
- 금액 입력: 숫자만 허용, 표시는 콤마 포함 (예: "30,000")
- "추가하기" 클릭 → console.log(금액, 메모, paidBy) — Phase 2에서 Firestore 저장 연결
- 완료 후 navigate(-1) (이전 화면으로)

**TDS 컴포넌트:**
- `Top`, `Top.TitleParagraph`
- `TextField`
- `FixedBottomCTA.Single`
- 참여자 선택: ListRow 또는 커스텀 선택 UI

### 2. `src/pages/Settle.tsx` 구현

정산 결과를 보여주는 화면. 정산 알고리즘은 Phase 2에서 연결하므로 이 step에서는 UI 레이아웃만 구현한다.

**레이아웃:**
```
[Top — "정산 결과"]
[스크롤 영역]
  [대표 사진 영역]
    사진 없음: 회색 박스 (높이 160px)
    사진 있음: img 태그
  방 이름 (bold)
  날짜 · 한줄 메모 (secondary text)

  [요약]
  총 지출 N원
  1인당 N원

  [보낼 돈 섹션] (현재 uid가 from인 settlement들)
    ListRow 형태:
      왼쪽: "나 → 민수"
      오른쪽: "30,000원" + [토스로 보내기] 버튼
    → "토스로 보내기" 클릭: console.log(`supertoss://send?...`) — Phase 2에서 window.location 연결

  [받을 돈 섹션] (현재 uid가 to인 settlement들)
    ListRow 형태:
      왼쪽: "민수 → 나"
      오른쪽: "+30,000원"

[FixedBottomCTA.Single — "정산 결과 공유하기"]
  → 클릭 시 console.log — Phase 2에서 bridge.shareText 연결
```

**Props/State (mock 데이터로 UI 확인):**
```ts
const { id: meetingId } = useParams()
const { uid } = useUserStore()

// mock (Phase 2에서 Firebase 훅 + 정산 알고리즘으로 교체)
const meeting = { name: '제주도 여행', date: '2026.06.11', memo: '제주 2박 3일', photoUrl: null as string | null }
const totalAmount = 90000
const memberCount = 3

type Settlement = { from: string; fromName: string; to: string; toName: string; amount: number }
const settlements: Settlement[] = [
  { from: 'uid2', fromName: '지현', to: 'uid1', toName: '민수', amount: 30000 },
]

const myPayments = settlements.filter(s => s.from === uid)
const myReceivables = settlements.filter(s => s.to === uid)
```

**TDS 컴포넌트:**
- `Top`, `Top.TitleParagraph`
- `FixedBottomCTA.Single`
- ListRow 또는 커스텀 항목 UI

**금액 포맷:** `toLocaleString('ko-KR')` + "원"

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
npm run lint    # ESLint 통과
```

## 검증 절차

1. AC 커맨드를 실행한다.
2. TypeScript 컴파일 에러가 없는지 확인한다.
3. ExpenseInput: 금액/메모 TextField, 참여자 선택 UI, FixedBottomCTA 확인.
4. Settle: 사진 영역, 요약 수치, 보낼 돈/받을 돈 섹션, "토스로 보내기" 버튼, FixedBottomCTA 확인.
5. phases/1-core-ui/index.json의 step2 status를 업데이트한다:
   - 성공 → "completed", summary: "ExpenseInput(금액/메모/paidBy 선택), Settle(보낼돈/받을돈/공유 레이아웃) UI 구현 완료"
   - 실패 → "error", error_message에 에러 내용 기록

## 금지사항
- Top 컴포넌트를 빠뜨리지 마라.
- eval(), Function() 사용 금지.
- Firebase 직접 호출 금지 (UI만).
- supertoss:// 딥링크를 실제로 window.location에 연결하지 마라 (console.log로만).
- 클립보드/공유에 native API 직접 사용 금지 (Phase 2에서 Bridge API 사용).
