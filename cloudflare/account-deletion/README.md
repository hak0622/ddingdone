# Account deletion Worker

Firebase 익명 사용자의 ID 토큰을 검증하고 탈퇴 영향 범위를 계산하는 Worker입니다.
제공 API:

- `POST /withdrawal/preview`: 탈퇴 영향 범위와 15분 manifest 생성
- `POST /withdrawal/confirm`: manifest를 검증하고 삭제 Workflow 시작
- `GET /withdrawal/status/{requestId}`: Firebase 토큰 또는 상태 토큰으로 진행 상태 조회

현재 Workflow는 일반 멤버가 공유방에서 탈퇴하는 경우를 처리합니다. 방장 이전,
단독 방 전체 삭제, Cloudinary 사진 삭제는 다음 구현 단계 전까지 확인 요청을
`SPECIAL_HANDLING_NOT_READY`로 중단합니다.

한 방의 비용 삭제, 멤버 문서 삭제, 방 집계 갱신, 정산 스냅샷 익명화는 하나의
Firestore commit으로 처리합니다. Firestore의 500-write 제한 안에서 원자성을
보장하기 위해 비용 문서가 450개를 초과하는 방은 미리보기에서
`DOCUMENT_LIMIT_EXCEEDED`로 중단하며 자동 삭제하지 않습니다.

Workflow가 실제 삭제를 시작하기 전에 실패하면 잠금을 해제합니다. 삭제 시작 뒤
재시도를 모두 소진한 요청은 방과 계정 잠금을 유지하고
`manual-recovery-required`로 표시합니다. 이런 요청은 완료된 단계의 데이터를 직접
수정하거나 Workflow를 처음부터 새로 시작하지 말고, 실패한 단계와 Firestore 요청
문서를 확인한 뒤 복구해야 합니다.

## 필요한 Secret

다음 값은 `wrangler.jsonc`에 넣거나 Git에 커밋하지 않습니다.

```sh
npx wrangler secret put FIREBASE_API_KEY
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
```

서비스 계정은 전용 계정을 사용하고 Firestore 문서 처리 권한과 Firebase
Authentication 사용자 삭제 권한만 부여합니다. 프로젝트 Owner·Editor 같은 광범위한
역할을 부여하지 않습니다.

`withdrawalManifests.expiresAt`과 `withdrawalRequests.expiresAt`에는 Firestore TTL
정책을 설정합니다. 사용자당 manifest는 항상 하나만 유지되고, 상태 조회용 요청
문서는 30일 뒤 자동 정리됩니다.

운영에서는 먼저 이 저장소의 Firestore 규칙을 배포해 탈퇴 중인 계정과 방의 일반
클라이언트 쓰기를 차단한 다음 Worker를 배포합니다. 규칙보다 Worker를 먼저 공개하면
미리보기 이후 삭제 전까지 데이터가 바뀔 수 있으므로 순서를 바꾸지 않습니다.

로컬 실행 시 `.dev.vars.example`을 `.dev.vars`로 복사한 뒤 실제 개발용 값을 입력합니다.
`.dev.vars`는 Git에서 제외됩니다.

## 검증

```sh
npm test
npm run typecheck
npx wrangler deploy --dry-run
```
