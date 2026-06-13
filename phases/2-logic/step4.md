# Step 4: settle-deeplink

## 읽어야 할 파일

- `src/utils/settle.ts` (step0 결과 — calculateSettlements 함수)
- `src/hooks/useMeeting.ts` (step1 결과)
- `src/lib/bridge.ts` (shareText 함수 확인)
- `src/pages/Settle.tsx` (현재 mock 데이터 상태)
- `src/store/userStore.ts`
- `docs/ARCHITECTURE.md`

## 작업

### 1. `src/pages/Settle.tsx` — 실제 데이터 + 정산 알고리즘 + 딥링크 연결

#### 데이터 연결

mock 데이터를 제거하고 실제 훅 사용:

```ts
import { useMeeting } from '../hooks/useMeeting'
import { calculateSettlements } from '../utils/settle'
import { useUserStore } from '../store/userStore'
import { shareText } from '../lib/bridge'

const { id: meetingId } = useParams<{ id: string }>()
const { uid } = useUserStore()
const { meeting, members, expenses, loading } = useMeeting(meetingId)

// 정산 계산
const settlements = useMemo(() => {
  if (!expenses.length || !Object.keys(members).length) return []
  return calculateSettlements(
    expenses.map(e => ({ amount: e.amount, paidBy: e.paidBy })),
    members,
  )
}, [expenses, members])

const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0)
const memberCount = Object.keys(members).length
const perPerson = memberCount > 0 ? Math.round(totalAmount / memberCount) : 0

const myPayments = settlements.filter(s => s.from === uid)
const myReceivables = settlements.filter(s => s.to === uid)
```

#### 토스로 보내기 딥링크

```ts
function handleSendToToss(s: Settlement) {
  // 토스 앱 내에서만 동작. 실기기 검증 필요.
  const url = `supertoss://send?amount=${s.amount}&bank=토스&accountNo=&origin=정산&message=${encodeURIComponent(`${s.fromName}→${s.toName} 정산`)}`
  window.location.href = url
}
```

"토스로 보내기" 버튼 onClick을 handleSendToToss로 연결.

#### 정산 결과 공유하기

```ts
async function handleShare() {
  if (!meeting) return
  const lines = [
    `[띵돈] ${meeting.name} 정산 결과`,
    `📅 ${meeting.date}`,
    `💰 총 지출 ${totalAmount.toLocaleString('ko-KR')}원 · 1인당 ${perPerson.toLocaleString('ko-KR')}원`,
    '',
    ...settlements.map(s =>
      `${s.fromName} → ${s.toName}: ${s.amount.toLocaleString('ko-KR')}원`
    ),
  ]
  await shareText(lines.join('\n'))
}
```

FixedBottomCTA의 onClick을 handleShare로 연결.

#### UI 수정 사항

- 로딩 중: "정산 결과를 계산하는 중..." 텍스트 표시
- settlements가 비어있고 로딩 아닐 때: "정산이 완료됐어요!" 메시지 (모든 계산이 균등)
- meeting.photoUrl이 있으면 img 태그로 표시 (objectFit: cover)

#### 완성된 Settle 화면 구조:
```
[Top — "정산 결과"]
[대표 사진 또는 회색 박스 160px]
[방 이름 bold]
[날짜 · 메모 gray]

[총 지출 N원]
[1인당 N원]

[보낼 돈 섹션] (myPayments)
  각 Settlement: "나 → {toName}  {amount}원  [토스로 보내기]"

[받을 돈 섹션] (myReceivables)
  각 Settlement: "{fromName} → 나  +{amount}원"

[settlements 빈 경우: "정산이 완료됐어요!"]

[FixedBottomCTA "정산 결과 공유하기"]
```

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
npm run lint    # ESLint 통과
```

## 검증 절차

1. AC 커맨드 실행.
2. Settle.tsx에서 mock 데이터가 제거되고 useMeeting + calculateSettlements 사용하는지 확인.
3. "토스로 보내기" 클릭 시 window.location.href = supertoss://... 연결되는지 확인.
4. "정산 결과 공유하기" 클릭 시 shareText 호출하는지 확인.
5. phases/2-logic/index.json step4 status 업데이트:
   - 성공 → "completed", summary: "Settle.tsx 실제 데이터 연동, supertoss:// 딥링크, shareText 공유 완료"
   - 실패 → "error"

## 금지사항
- eval(), Function() 사용 금지.
- navigator.clipboard, window.navigator.share 직접 사용 금지 → shareText 사용.
- Top 컴포넌트 제거 금지.
- supertoss:// URL을 console.log로만 출력하지 마라 — window.location.href로 실제 연결.