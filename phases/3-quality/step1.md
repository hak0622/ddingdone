# Step 1: delete-active-meeting

## 읽어야 할 파일

- `src/pages/MeetingDetail.tsx` (전체 — 현재 관리 버튼 조건과 openManage 함수 파악)
- `src/hooks/useMeeting.ts` (meeting.createdBy 필드 확인)

## 현황 파악

현재 MeetingDetail.tsx Top right 영역:

```tsx
right={
  isSettled && uid === meeting.createdBy ? (
    <button onClick={openManage}>관리</button>   // settled + 생성자만
  ) : !isSettled ? (
    <button onClick={() => navigate(`/meetings/${id}/edit`)}>수정</button>  // active인 모든 멤버
  ) : undefined
}
```

현재 `openManage()` 시트 항목:
- 방 정보 수정
- 정산 다시 열기
- 삭제 (빨간색)

## 작업

진행중(active) 방도 생성자가 삭제할 수 있도록 변경한다.

### 1. Top right 버튼 조건 변경

```tsx
right={
  uid === meeting.createdBy ? (
    <button onClick={openManage} style={{ ... }}>관리</button>
  ) : !isSettled ? (
    <button onClick={() => navigate(`/meetings/${id}/edit`)} style={{ ... }}>수정</button>
  ) : undefined
}
```

생성자(`uid === meeting.createdBy`)에게는 항상 "관리" 버튼을 보여준다.  
비생성자에게는 진행중일 때만 "수정" 버튼을 보여준다.

### 2. `openManage()` 함수: 상태에 따라 다른 항목 표시

active 상태일 때 (isSettled = false):
- 방 정보 수정
- 삭제 (빨간색)

settled 상태일 때 (isSettled = true):
- 방 정보 수정
- 정산 다시 열기
- 삭제 (빨간색)

구현 방법: openManage 함수 내 children 안에서 `isSettled`로 조건부 렌더링.

```tsx
children: (
  <div style={{ padding: '0 20px 8px' }}>
    <button
      onClick={() => { closeManageSheet(); navigate(`/meetings/${id}/edit`) }}
      style={{ /* 방 정보 수정 스타일 */ }}
    >
      방 정보 수정
    </button>
    {isSettled && (
      <button
        onClick={handleReopenMeeting}
        style={{ /* 정산 다시 열기 스타일 */ }}
      >
        정산 다시 열기
      </button>
    )}
    <button
      onClick={() => { closeManageSheet(); setConfirmDeleteMeeting(true) }}
      style={{ /* 삭제 스타일 (빨간색, border 없음) */ }}
    >
      삭제
    </button>
  </div>
)
```

## Acceptance Criteria

```bash
npm run test   # 기존 테스트 통과 (회귀 없음)
npm run build  # 컴파일 에러 없이 성공
```

## 검증 절차

1. AC 커맨드를 실행해 확인한다.
2. `phases/3-quality/index.json` step1 status 업데이트:
   - 성공 → `"completed"`, summary: `"진행중 방 생성자에게 관리 버튼 노출, 삭제 기능 활성화"`
   - 실패 → `"error"` + `"error_message"` 기록

## 금지사항

- `handleDeleteMeeting` 로직 변경 금지 (이미 올바르게 구현됨).
- `ConfirmDialog` 컴포넌트 삭제 금지 — 기존 삭제 확인 다이얼로그는 그대로 유지.
- `createdBy` 필드가 없는 방(null/undefined)에서 크래시 발생하지 않도록 옵셔널 체이닝 사용.
