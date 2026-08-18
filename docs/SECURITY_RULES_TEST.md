# Firestore Security Rules 검증 기록

**검증 일자:** 2026-07-28
**검증 방법:** Firebase Console Rules Playground (시뮬레이션)
**대상 Rules:** `firestore.rules`

---

## 테스트 환경

| 항목 | 값 |
|---|---|
| 모임 ID | `p3cVW6WNEp0688eXCgi3` |
| 방장 UID | `R2EvHEnl5FS7mTjNT1RpEn4qFV62` |
| 일반 멤버 UID (본인) | `7c6WOn8jflb7gb2ad53PZLgtrHN2` |

---

## 시나리오 1 — createdBy 탈취 시도

**의도:** 일반 멤버가 `createdBy` 필드를 본인 UID로 바꿔 방장 권한(모임 삭제 등)을 탈취

| 항목 | 값 |
|---|---|
| Operation | `update` |
| Path | `/databases/(default)/documents/meetings/p3cVW6WNEp0688eXCgi3` |
| Auth UID | `7c6WOn8jflb7gb2ad53PZLgtrHN2` (일반 멤버) |
| Request data | `{ "createdBy": "7c6WOn8jflb7gb2ad53PZLgtrHN2" }` |

**결과: 거부 (deny)** ✓

관련 Rules 조건:
```
!request.resource.data.diff(resource.data).affectedKeys().hasAny(['createdBy', 'memberUids', 'memberCount'])
```

---

## 시나리오 2 — 가짜 멤버 삽입 시도

**의도:** memberUids에 없는 외부인이 members 서브컬렉션에 직접 문서를 생성해 perPerson 정산 금액 조작

| 항목 | 값 |
|---|---|
| Operation | `create` |
| Path | `/databases/(default)/documents/meetings/p3cVW6WNEp0688eXCgi3/members/fakeUID123` |
| Auth UID | `fakeUID123` (비멤버) |
| Request data | `{ "nickname": "침입자" }` |

**결과: Playground 실행 오류 (skip)**

> Rules 내 `isMember()` 함수가 `get()`으로 부모 문서를 조회하는데, 존재하지 않는 UID로 시뮬레이션할 때 Playground가 처리하지 못하는 알려진 한계. Rules 로직상 `isMember()` 가 false를 반환하므로 차단됨.

---

## 시나리오 3 — 타인 명의 비용 등록 시도

**의도:** 멤버가 다른 사람의 UID를 `paidBy`로 지정해 남의 이름으로 비용을 등록

| 항목 | 값 |
|---|---|
| Operation | `create` |
| Path | `/databases/(default)/documents/meetings/p3cVW6WNEp0688eXCgi3/expenses/testExp` |
| Auth UID | `7c6WOn8jflb7gb2ad53PZLgtrHN2` (일반 멤버) |
| Request data | `{ "paidBy": "R2EvHEnl5FS7mTjNT1RpEn4qFV62", "amount": 10000, "memo": "", "category": "" }` |

**결과: 거부 (deny)** ✓

관련 Rules 조건:
```
request.resource.data.paidBy == request.auth.uid
```

---

## 결론

| 시나리오 | 결과 |
|---|---|
| createdBy 탈취 | 차단 확인 ✓ |
| 가짜 멤버 삽입 | Playground 한계로 시뮬레이션 불가 (Rules 로직상 차단) |
| 타인 명의 비용 등록 | 차단 확인 ✓ |
