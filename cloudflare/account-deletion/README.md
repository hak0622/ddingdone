# Account deletion Worker

Firebase ID 토큰을 검증하고 v2 모임 관리, 비용 등록·수정·삭제, 정산 확정과
회원 탈퇴를 처리하는 Worker입니다. 회원 탈퇴 API는 다음과 같습니다.

- `POST /withdrawal/preview`: 탈퇴 영향 범위와 15분 manifest 생성
- `POST /withdrawal/confirm`: manifest를 검증하고 삭제 Workflow 시작
- `GET /withdrawal/status/{requestId}`: Firebase 토큰 또는 상태 토큰으로 진행 상태 조회

Workflow와 일반 나가기는 같은 Firestore 트랜잭션 함수를 사용합니다. 공유방에서는
현재 참여 권한과 계정 연결을 제거하고 지출·확정 정산·대표 사진을 보존합니다.
마지막 참여자가 나가면 모임과 대표 사진을 포함한 하위 문서를 삭제합니다. 한 번에
지우기 어려운 방은 접근을 먼저 닫고 예약 작업에서 삭제를 이어갑니다.

Workflow가 실제 삭제를 시작하기 전에 실패하면 탈퇴자 계정 잠금을 해제합니다.
삭제 시작 뒤 재시도를 모두 소진한 요청은 탈퇴자 계정 잠금을 유지하고
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

매일 오전 3시 17분(KST)에 Cloudflare Cron이 만료 문서를 정리합니다. 15분이 지난
미확정 `withdrawalManifests`와 30일이 지난 완료 상태의 `withdrawalRequests`만
삭제합니다. 한 번에 컬렉션별 최대 240개까지 처리하며 같은 Cron에서 삭제 대기 중인
닫힌 방도 이어서 정리합니다.
별도의 Firestore TTL 정책이나 추가 Secret은 필요하지 않습니다.

운영에서는 먼저 이 저장소의 Firestore 규칙을 배포해 탈퇴 중인 계정의 쓰기를
차단하고 비용 문서와 방 집계를 원자적으로 갱신하도록 한 다음 Worker를 배포합니다.
공유방의 다른 참여자 쓰기는 계속 허용되며, Worker가 해당 방을 처리할 때 충돌하면
트랜잭션이 최신 데이터로 재시도합니다.

로컬 실행 시 `.dev.vars.example`을 `.dev.vars`로 복사한 뒤 실제 개발용 값을 입력합니다.
`.dev.vars`는 Git에서 제외됩니다.

## 검증

```sh
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

## 운영 전환 기록

운영 Worker와 Firestore 규칙은 v2 모임을 처리합니다. 과거 포맷의 검증과 복구에
사용한 전환 도구는 운영 요청 경로와 분리되어 있습니다. 대표 사진 전환 과정은
[대표 사진 전환 문서](../../docs/cover-photo-rollout.md)에 기록되어 있습니다.

## v2 탈퇴 중 삭제 범위 변경

첫 방을 변경하기 전에 범위가 확대되면 계정 잠금을 풀고 새 미리보기를 받습니다.
이미 처리한 방이 있으면 기존 요청과 잠금을 유지하고 추가로 삭제될 방을 확인합니다.
확인은 기존 Workflow에 전달되고 남은 방부터 이어집니다. 응답 전달에 실패하면 같은
확인을 다시 전송할 수 있습니다. 24시간 내 확인되지 않으면 수동 복구 상태로 전환합니다.
복구 시 요청 상태와 기존 Workflow의 단계, 방 삭제 여부를 함께 검토하고 완료된
장부를 재작성하거나 잠금을 임의 해제하지 않습니다.

## v2 로컬 검증

루트에서 Firebase 에뮬레이터를 `--only auth,firestore --project demo-ddingdone`으로
실행하고, `VITE_USE_FIREBASE_EMULATORS=true npm run dev`로 5173의 앱을 시작합니다.
계정 Worker 폴더에서 다음 명령으로 로컬 Worker와 Workflow를 실행합니다.

```sh
npm run dev -- --ip 127.0.0.1 --port 8787 \
  --var FIREBASE_PROJECT_ID:demo-ddingdone --var FIREBASE_API_KEY:demo-ddingdone \
  --var FIREBASE_CLIENT_EMAIL:demo-ddingdone --var FIREBASE_PRIVATE_KEY:demo-ddingdone
```

Firestore 연동과 규칙은 루트의 `npm run test:rules`로 검증합니다. 이미 실행한
에뮬레이터를 재사용하려면 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run --config vitest.rules.config.ts`
를 실행합니다.
