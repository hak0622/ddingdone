import { clearMeetingCache } from '../hooks/useMeeting'
import { clearMeetingsCache } from '../hooks/useMeetings'
import { useUserStore } from '../store/userStore'
import { clearFirebaseSessionAndCache, clearPendingFirebaseSessionAndCache } from './firebase'

const NICKNAME_KEY = 'ddingdone_nickname'
const CLEANUP_PENDING_KEY = 'ddingdone_withdrawal_cleanup_pending'
const SIGN_IN_DEFERRED_KEY = 'ddingdone_post_withdrawal_sign_in_deferred'

let cleanupPromise: Promise<void> | null = null

async function runLocalCleanup(): Promise<void> {
  // 앱이 중간에 종료되더라도 다음 시작에서 로그인보다 캐시 정리를 먼저 하도록
  // 완료 표시를 가장 먼저 남긴다.
  localStorage.setItem(CLEANUP_PENDING_KEY, 'true')
  localStorage.removeItem(NICKNAME_KEY)
  useUserStore.getState().setUser('', '')
  clearMeetingsCache()
  clearMeetingCache()

  await clearFirebaseSessionAndCache()
  localStorage.setItem(SIGN_IN_DEFERRED_KEY, 'true')
  localStorage.removeItem(CLEANUP_PENDING_KEY)
}

export function finalizeLocalAccountDeletion(): Promise<void> {
  cleanupPromise ??= runLocalCleanup()
  return cleanupPromise
}

export async function recoverPendingAccountCleanup(): Promise<void> {
  if (localStorage.getItem(CLEANUP_PENDING_KEY) !== 'true') return

  localStorage.removeItem(NICKNAME_KEY)
  useUserStore.getState().setUser('', '')
  await clearPendingFirebaseSessionAndCache()
  localStorage.setItem(SIGN_IN_DEFERRED_KEY, 'true')
  localStorage.removeItem(CLEANUP_PENDING_KEY)
}

export function shouldDeferAnonymousSignIn(): boolean {
  return localStorage.getItem(SIGN_IN_DEFERRED_KEY) === 'true'
}

export function finishDeferredAnonymousSignIn(): void {
  localStorage.removeItem(SIGN_IN_DEFERRED_KEY)
}
