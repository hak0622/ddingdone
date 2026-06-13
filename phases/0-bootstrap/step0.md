# Step 0: firebase-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트 구조와 설계 의도를 파악하라:
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/src/main.tsx`
- `/src/App.tsx`

## 작업

Firebase(Firestore) + Cloudinary + Bridge API 연동 파일을 구현하라.

### 1. `src/lib/firebase.ts` 확인/생성

**중요: 이 프로젝트는 Realtime DB가 아닌 Firestore를 사용한다.**

- `import.meta.env.VITE_*` 환경변수로 firebaseConfig를 구성하라
- `initializeApp`, `getAuth`, `getFirestore` 초기화
- `signInAnonymously` 함수를 export하라 (Firebase Anonymous Auth — 개발 환경 fallback용)
- 사용하는 환경변수: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID

```ts
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously as firebaseSignInAnonymously } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)

export async function signInAnonymously(): Promise<string> {
  const credential = await firebaseSignInAnonymously(auth)
  return credential.user.uid
}
```

### 2. `src/lib/bridge.ts` 확인/생성

토스 앱 환경 감지 + Bridge API 래퍼:
- `isInsideTossApp()`: `window.__GRANITE_NATIVE_EMITTER` 존재 여부로 판단
- `getAnonymousUid()`: 토스 앱에서는 `getAnonymousKey()`, 브라우저에서는 null 반환
- `shareInviteLink(meetingId)`: `getTossShareLink()` + `share()` 조합
- `shareText(message)`: `share()` 래핑, fallback: `navigator.clipboard.writeText`

```ts
import { getAnonymousKey, getTossShareLink, share } from '@apps-in-toss/web-framework'

export function isInsideTossApp(): boolean {
  return typeof window !== 'undefined' && !!window.__GRANITE_NATIVE_EMITTER
}

export async function getAnonymousUid(): Promise<string | null> {
  if (!isInsideTossApp()) return null
  try {
    const result = await getAnonymousKey()
    if (!result || result === 'ERROR') return null
    return result.hash
  } catch { return null }
}

export async function shareInviteLink(meetingId: string): Promise<void> {
  const deeplink = `intoss://ddingdone?meeting=${meetingId}`
  try {
    const tossLink = await getTossShareLink(deeplink)
    await share({ message: `띵돈 정산방에 초대됐어요!\n내가 낸 금액을 입력해 주세요.\n${tossLink}` })
  } catch {
    await navigator.clipboard.writeText(deeplink)
  }
}

export async function shareText(message: string): Promise<void> {
  try { await share({ message }) } catch { await navigator.clipboard.writeText(message) }
}
```

### 3. `src/lib/cloudinary.ts` 확인/생성

Cloudinary unsigned upload:

```ts
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

export async function uploadImage(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', UPLOAD_PRESET)
  formData.append('folder', 'ddingdone')
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  )
  if (!res.ok) throw new Error('사진 업로드에 실패했어요')
  const data = await res.json()
  return data.secure_url as string
}
```

### 4. `src/vite-env.d.ts` 확인/수정

Window 타입에 `__GRANITE_NATIVE_EMITTER` 추가:

```ts
interface Window {
  __GRANITE_NATIVE_EMITTER?: unknown
}
```

### 5. `.env.local` 확인

`.env.local`이 이미 존재하고 값이 채워져 있으면 **수정하지 마라**.
존재하지 않으면 아래 내용으로 생성하라:

```
VITE_FIREBASE_API_KEY=여기에_입력
VITE_FIREBASE_AUTH_DOMAIN=여기에_입력
VITE_FIREBASE_PROJECT_ID=여기에_입력
VITE_FIREBASE_STORAGE_BUCKET=여기에_입력
VITE_FIREBASE_MESSAGING_SENDER_ID=여기에_입력
VITE_FIREBASE_APP_ID=여기에_입력
VITE_CLOUDINARY_CLOUD_NAME=여기에_입력
VITE_CLOUDINARY_UPLOAD_PRESET=여기에_입력
```

### 6. `.gitignore` 확인

`.env.local`이 `.gitignore`에 포함되어 있는지 확인하라. 없으면 추가하라.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
```

## 검증 절차

1. AC 커맨드를 실행한다.
2. src/lib/firebase.ts가 Firestore를 올바르게 초기화하는지 확인한다.
3. src/lib/bridge.ts가 @apps-in-toss/web-framework를 올바르게 사용하는지 확인한다.
4. .env.local이 .gitignore에 포함되어 있는지 확인한다.
5. phases/0-bootstrap/index.json의 step0 status를 업데이트한다:
   - 성공 → "completed", summary: "firebase.ts(Firestore), bridge.ts, cloudinary.ts, vite-env.d.ts 생성/확인 완료"
   - 실패 → "error", error_message에 에러 내용 기록

## 금지사항
- firebaseConfig 값을 코드에 하드코딩하지 마라. 반드시 환경변수 사용.
- Realtime Database(getDatabase) 사용 금지. Firestore(getFirestore)만 사용.
- eval() 사용 금지.
- .env.local이 이미 값이 채워져 있으면 덮어쓰지 마라.
