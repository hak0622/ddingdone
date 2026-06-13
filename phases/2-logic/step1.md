# Step 1: firebase-hooks

## 읽어야 할 파일

- `src/lib/firebase.ts` (db, auth export 확인)
- `src/store/userStore.ts`
- `src/pages/Home.tsx` (현재 mock 상태)
- `src/pages/MeetingNew.tsx` (현재 console.log만 있는 상태)
- `src/pages/MeetingDetail.tsx` (현재 mock 상태)
- `docs/ARCHITECTURE.md`

## Firestore 데이터 구조

```
meetings/{meetingId}/
  {
    name: string          // 방 이름
    date: string          // "2026.06.12"
    memo: string          // 한줄 메모
    createdBy: string     // uid
    createdAt: Timestamp
    photoUrl: string | null
  }

meetings/{meetingId}/members/{uid}/
  { nickname: string }

meetings/{meetingId}/expenses/{expenseId}/
  { amount: number; paidBy: string; memo: string; createdAt: Timestamp }
```

## 작업

### 1. `src/hooks/useMeeting.ts` 생성

단일 정산방 + 멤버 + 비용 실시간 구독 훅.

```ts
import { useEffect, useState } from 'react'
import { doc, collection, onSnapshot, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'

export interface Meeting {
  id: string
  name: string
  date: string
  memo: string
  createdBy: string
  photoUrl: string | null
}

export interface MemberMap {
  [uid: string]: string  // uid → nickname
}

export interface Expense {
  id: string
  amount: number
  paidBy: string
  memo: string
}

export function useMeeting(meetingId: string | undefined) {
  // meeting, members, expenses, loading 반환
  // onSnapshot으로 실시간 구독
  // meetingId가 없으면 loading: true, 나머지 null 반환
}
```

**반환값:**
```ts
{
  meeting: Meeting | null,
  members: MemberMap,
  expenses: Expense[],
  loading: boolean,
}
```

### 2. `src/hooks/useMeetings.ts` 생성

내가 참여한 정산방 목록 훅 (Home용).

```ts
export interface MeetingListItem {
  id: string
  name: string
  date: string
  memberCount: number
  totalAmount: number
}

export function useMeetings(uid: string) {
  // meetings/{meetingId}/members/{uid} 경로가 존재하는 방만 가져오기
  // uid가 없으면 빈 배열 반환
  // collectionGroup('members')로 uid 문서 쿼리
  // 각 meetingId에 대해 meeting 문서 + expenses 합계 계산
  // 반환: { meetings: MeetingListItem[], loading: boolean }
}
```

**구현 방식:**
```ts
// collectionGroup으로 members 서브컬렉션에서 uid 문서 찾기
const q = query(
  collectionGroup(db, 'members'),
  where(documentId(), '==', uid)  // 이 방식은 작동 안함
)
// 대안: meetings 컬렉션 전체 쿼리 후 클라이언트 필터링
// (초기 MVP이므로 모든 미팅을 불러와 members에 uid가 있는 것만 필터)
```

**실제 구현 방법:**
```ts
// 1. meetings 컬렉션 onSnapshot
// 2. 각 meeting의 members 서브컬렉션에서 uid 문서 존재 여부 확인
// → MVP 규모에서는 허용 가능. meetingIds를 state로 관리하고
//   각 meetingId에 대해 개별 onSnapshot 구독
```

단순화된 방법으로 구현해도 됨:
```ts
// meetings 전체를 onSnapshot으로 구독한 뒤,
// members/{uid} 문서가 있는 것만 필터링 (getDoc으로 확인)
```

### 3. `src/pages/MeetingNew.tsx` 수정

폼 제출 시 Firestore에 실제 저장.

```ts
import { collection, addDoc, setDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'
import { useNavigate } from 'react-router-dom'

async function createMeeting(fields: { name, date, members, memo }, uid: string, nickname: string) {
  // 1. meetings 컬렉션에 addDoc
  const meetingRef = await addDoc(collection(db, 'meetings'), {
    name: fields.name.trim(),
    date: fields.date,
    memo: fields.memo,
    createdBy: uid,
    createdAt: serverTimestamp(),
    photoUrl: null,
  })

  // 2. members 서브컬렉션에 방장(uid → nickname) 저장
  await setDoc(doc(db, 'meetings', meetingRef.id, 'members', uid), {
    nickname,
  })

  // 3. 쉼표 구분 참여자 이름 → pre_{randomId} 키로 저장
  const names = fields.members
    .split(',')
    .map(n => n.trim())
    .filter(n => n.length > 0 && n !== nickname)

  for (const name of names) {
    const preId = `pre_${Math.random().toString(36).slice(2, 9)}`
    await setDoc(doc(db, 'meetings', meetingRef.id, 'members', preId), {
      nickname: name,
    })
  }

  return meetingRef.id
}
```

성공 후 `navigate(`/meetings/${meetingId}`)`.

로딩 상태 처리: 제출 중 버튼 disabled.

### 4. `src/pages/Home.tsx` 수정

`useMeetings(uid)` 훅 사용해서 실제 데이터 표시.

```ts
const { uid } = useUserStore()
const { meetings, loading } = useMeetings(uid)
```

로딩 중: 중앙에 "불러오는 중..." 텍스트 표시 (스피너 대신 텍스트).

### 5. `src/pages/MeetingDetail.tsx` 수정

`useMeeting(id)` 훅 사용해서 mock 데이터 제거.

```ts
const { meeting, members, expenses, loading } = useMeeting(id)
```

로딩 중: "불러오는 중..." 표시.
meeting이 null(존재하지 않는 방): "정산방을 찾을 수 없어요" + 홈으로 버튼.

### 6. `src/pages/ExpenseInput.tsx` 수정

`useMeeting(id)` 훅으로 실제 members 사용.
비용 제출 시 Firestore 저장:

```ts
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'

await addDoc(collection(db, 'meetings', meetingId, 'expenses'), {
  amount: Number(amount),
  paidBy,
  memo,
  createdAt: serverTimestamp(),
})
```

성공 후 navigate(-1).

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
npm run lint    # ESLint 통과
```

## 검증 절차

1. AC 커맨드 실행 및 확인.
2. TypeScript 컴파일 에러 없는지 확인.
3. useMeeting.ts, useMeetings.ts 파일 생성 확인.
4. MeetingNew, Home, MeetingDetail, ExpenseInput이 수정됐는지 확인.
5. phases/2-logic/index.json step1 status 업데이트:
   - 성공 → "completed", summary: "useMeeting/useMeetings 훅 생성, MeetingNew/Home/MeetingDetail/ExpenseInput Firebase 연동 완료"
   - 실패 → "error"

## 금지사항
- eval(), Function() 사용 금지.
- Realtime Database(getDatabase) 사용 금지 — Firestore(getFirestore)만 사용.
- Top 컴포넌트를 빠뜨리지 마라.
- firebase.ts의 firebaseConfig 값을 하드코딩하지 마라.
