# Step 0: firebase-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트 구조와 설계 의도를 파악하라:
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/src/main.tsx`
- `/src/App.tsx`

## 작업

Firebase 연동 파일과 환경변수 설정을 구현하라.

### 1. `src/lib/firebase.ts` 생성
- `import.meta.env.VITE_*` 환경변수로 firebaseConfig를 구성하라
- `initializeApp`, `getAuth`, `getDatabase`, `getStorage` 초기화
- `signInAnonymously` 함수를 export하라
- 사용하는 환경변수: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_DATABASE_URL, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_APP_ID

### 2. `src/lib/bridge.ts` 생성
- `@apps-in-toss/web-framework`에서 shareLink, shareText를 import해서 래핑하여 export
- 브라우저 환경(개발 시)에서도 에러 없이 동작하도록 try/catch 처리

### 3. `.env.local` 파일 생성 (루트에)
아래 내용으로 생성하라. 값은 placeholder로 두고 사용자가 채우도록 주석을 달아라:
```
# Firebase 콘솔(console.firebase.google.com)에서 프로젝트 설정 > 웹 앱에서 복사
VITE_FIREBASE_API_KEY=여기에_입력
VITE_FIREBASE_AUTH_DOMAIN=여기에_입력
VITE_FIREBASE_DATABASE_URL=여기에_입력
VITE_FIREBASE_PROJECT_ID=ddingdone
VITE_FIREBASE_STORAGE_BUCKET=여기에_입력
VITE_FIREBASE_APP_ID=여기에_입력
```

### 4. `.gitignore`에 `.env.local` 추가 (없으면)

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
```

## 검증 절차

1. AC 커맨드를 실행한다.
2. src/lib/firebase.ts가 환경변수를 올바르게 읽는지 확인한다.
3. .env.local이 .gitignore에 포함되어 있는지 확인한다.
4. phases/0-bootstrap/index.json의 step0 status를 업데이트한다:
   - 성공 → "completed", summary: "firebase.ts, bridge.ts, .env.local 생성 완료"
   - .env.local 값 미입력 상태여도 빌드만 되면 completed 처리 (값은 사용자가 채움)

## 금지사항
- firebaseConfig 값을 코드에 하드코딩하지 마라. 반드시 환경변수 사용.
- eval() 사용 금지.
