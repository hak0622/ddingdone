# Step 3: invite-deeplink

## 읽어야 할 파일

- `src/lib/bridge.ts` (shareInviteLink 함수 확인)
- `src/pages/MeetingDetail.tsx` (step2 결과 — "초대 링크 공유" 버튼 현재 console.log 상태)
- `src/store/userStore.ts`
- `docs/ARCHITECTURE.md`

## 작업

### 1. `src/pages/MeetingDetail.tsx` 수정 — "초대 링크 공유" 버튼 연결

기존 "초대 링크 공유" 버튼의 console.log를 실제 bridge 함수로 교체.

```ts
import { shareInviteLink } from '../lib/bridge'

async function handleShare() {
  if (!id) return
  try {
    await shareInviteLink(id)
  } catch (err) {
    console.error('공유 실패', err)
  }
}
```

버튼 onClick을 `handleShare`로 연결.

### 2. 초대 참여자 등록 흐름 구현 (MeetingDetail)

링크로 들어온 사용자(uid가 members에 없는 경우) 처리.

**조건:** `useMeeting` 훅에서 members가 로드된 후, 현재 uid가 members에 없으면 참여 UI 표시.

**참여 UI (간단한 오버레이 또는 조건부 렌더링):**
```
"이 정산방에 참여하시겠어요?"

기존 참여자 이름 목록 (pre_ 키로 등록된 멤버들):
  [민수] [지현]   ← 클릭하면 해당 pre_ 키를 내 uid로 교체

또는 직접 입력:
  TextField — "새 닉네임으로 참여"
  [참여하기] 버튼
```

**Firestore 처리:**
```ts
import { doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore'

// 기존 pre_ 멤버를 내 uid로 교체
async function claimPreMember(meetingId: string, preUid: string, myUid: string, nickname: string) {
  await setDoc(doc(db, 'meetings', meetingId, 'members', myUid), { nickname })
  await deleteDoc(doc(db, 'meetings', meetingId, 'members', preUid))
  // expenses의 paidBy도 교체해야 하지만 MVP에서는 생략
}

// 새 참여자로 신규 추가
async function joinAsNew(meetingId: string, myUid: string, nickname: string) {
  await setDoc(doc(db, 'meetings', meetingId, 'members', myUid), { nickname })
}
```

**pre_ 멤버 필터링:**
```ts
const preMembers = Object.entries(members).filter(([uid]) => uid.startsWith('pre_'))
```

참여 완료 후: 페이지 자동 갱신 (onSnapshot이 members 변화를 감지).

**참여 UI 표시 조건:**
```ts
const isNotMember = !loading && uid && !members[uid]
```

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
npm run lint    # ESLint 통과
```

## 검증 절차

1. AC 커맨드 실행.
2. MeetingDetail에서 "초대 링크 공유" 버튼이 shareInviteLink 호출하는지 확인.
3. uid가 members에 없는 경우 참여 UI가 렌더링되는지 확인 (isNotMember 조건).
4. phases/2-logic/index.json step3 status 업데이트:
   - 성공 → "completed", summary: "초대 링크 공유(bridge.shareInviteLink) + 참여자 등록 흐름 구현 완료"
   - 실패 → "error"

## 금지사항
- eval(), Function() 사용 금지.
- 클립보드/공유에 navigator.clipboard 또는 window.navigator.share 직접 사용 금지.
  → bridge.ts의 shareInviteLink만 사용 (내부에서 fallback 처리됨).
- Top 컴포넌트 제거 금지.
