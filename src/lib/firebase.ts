import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously as firebaseSignInAnonymously, signOut } from 'firebase/auth'
import { clearIndexedDbPersistence, initializeFirestore, persistentLocalCache, terminate } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
})

const auth = getAuth(app)

export async function signInAnonymously(): Promise<string> {
  const credential = await firebaseSignInAnonymously(auth)
  return credential.user.uid
}

export async function getIdToken(): Promise<string | null> {
  return auth.currentUser?.getIdToken() ?? null
}

export async function clearFirebaseSessionAndCache(): Promise<void> {
  await signOut(auth)
  await terminate(db)
  await clearIndexedDbPersistence(db)
}

export async function clearPendingFirebaseSessionAndCache(): Promise<void> {
  await signOut(auth)
  // 새 앱 실행에서는 아직 Firestore를 사용하기 전이므로 인스턴스를 종료하지
  // 않고 디스크 캐시만 비운 뒤 같은 인스턴스로 계속 시작할 수 있다.
  await clearIndexedDbPersistence(db)
}
