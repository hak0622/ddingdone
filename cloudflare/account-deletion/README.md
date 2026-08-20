# Account deletion Worker

Firebase 익명 사용자의 ID 토큰을 검증하고 탈퇴 영향 범위를 계산하는 Worker입니다.
현재 구현 범위는 `POST /withdrawal/preview`뿐이며 실제 삭제는 수행하지 않습니다.

## 필요한 Secret

다음 값은 `wrangler.jsonc`에 넣거나 Git에 커밋하지 않습니다.

```sh
npx wrangler secret put FIREBASE_API_KEY
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
```

서비스 계정은 전용 계정을 사용하고, 현재 단계에서는 Firestore의 관련 문서 조회와
`withdrawalManifests` 생성에 필요한 최소 권한만 부여합니다. 실제 계정 삭제 권한은
삭제 Workflow를 구현하는 단계에서 별도로 추가합니다.

`withdrawalManifests.expiresAt`에는 Firestore TTL 정책을 설정합니다. 사용자당 문서는
항상 하나만 유지되지만, 탈퇴 기능을 더 이상 사용하지 않는 계정의 만료 manifest도
자동 정리되도록 하기 위함입니다.

로컬 실행 시 `.dev.vars.example`을 `.dev.vars`로 복사한 뒤 실제 개발용 값을 입력합니다.
`.dev.vars`는 Git에서 제외됩니다.

## 검증

```sh
npm test
npm run typecheck
npx wrangler deploy --dry-run
```
