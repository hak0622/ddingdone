# 아키텍처

## 디렉토리 구조 (ddingdone/ 루트 기준)
```
src/
  pages/
    Onboarding.tsx      닉네임 입력 (/onboarding)
    Home.tsx            모임 목록 (/)
    MeetingNew.tsx      모임 생성 (/meetings/new)
    MeetingDetail.tsx   모임 상세 (/meetings/:id)
    ExpenseInput.tsx    비용 입력 (/meetings/:id/expense)
    Settle.tsx          정산 결과 (/meetings/:id/settle)
  components/           재사용 컴포넌트
  hooks/                커스텀 훅 (useMeeting, useExpenses 등)
  store/
    userStore.ts        Zustand — uid, nickname
  utils/
    settle.ts           정산 알고리즘 (Splitwise)
  lib/
    firebase.ts         Firebase 초기화 (환경변수로 config 읽기)
    bridge.ts           Bridge API 래퍼 (shareLink, shareText, getClipboardText)
```

## 라우팅
- /onboarding           닉네임 입력 (localStorage에 nickname 없으면 자동 리다이렉트)
- /                     홈 — 내 모임 목록
- /meetings/new         모임 생성
- /meetings/:id         모임 상세 (비용 목록, 사진)
- /meetings/:id/expense 비용 입력
- /meetings/:id/settle  정산 결과 + supertoss:// 버튼

## Firebase 데이터 구조
```
meetings/{meetingId}/
  info: { name, date, createdBy, createdAt }
  members: { uid: nickname }
  expenses: { expenseId: { amount, paidBy, category, createdAt } }
  photo: { url, uploadedAt }
```

## 정산 알고리즘 (utils/settle.ts)
Splitwise 방식:
1. 각 멤버 순잔액 = 낸 금액 합계 - (총액 / 멤버 수)
2. 최대 채권자 ↔ 최대 채무자 매칭
3. min(채권, 채무)만큼 정산 후 반복
입력: expenses[], members[]
출력: [{ from, to, amount }]

## 초대 딥링크
intoss://ddingdone?meeting={meetingId}
앱 진입 시 URL 파라미터 파싱 → 해당 모임으로 자동 이동
