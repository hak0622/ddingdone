import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearMeetingCache: vi.fn(),
  clearMeetingsCache: vi.fn(),
  clearFirebaseSessionAndCache: vi.fn(async () => {}),
  clearPendingFirebaseSessionAndCache: vi.fn(async () => {}),
}))

vi.mock('../hooks/useMeeting', () => ({ clearMeetingCache: mocks.clearMeetingCache }))
vi.mock('../hooks/useMeetings', () => ({ clearMeetingsCache: mocks.clearMeetingsCache }))
vi.mock('./firebase', () => ({
  clearFirebaseSessionAndCache: mocks.clearFirebaseSessionAndCache,
  clearPendingFirebaseSessionAndCache: mocks.clearPendingFirebaseSessionAndCache,
}))

const NICKNAME_KEY = 'ddingdone_nickname'
const CLEANUP_PENDING_KEY = 'ddingdone_withdrawal_cleanup_pending'
const SIGN_IN_DEFERRED_KEY = 'ddingdone_post_withdrawal_sign_in_deferred'

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('탈퇴 후 로컬 데이터 정리', () => {
  it('닉네임, 사용자 상태, 구독 캐시와 Firebase 데이터를 모두 정리한다', async () => {
    localStorage.setItem(NICKNAME_KEY, '기존 사용자')
    const { finalizeLocalAccountDeletion } = await import('./accountCleanup')
    const { useUserStore } = await import('../store/userStore')
    useUserStore.getState().setUser('old-user', '기존 사용자')

    await finalizeLocalAccountDeletion()

    expect(localStorage.getItem(NICKNAME_KEY)).toBeNull()
    expect(localStorage.getItem(CLEANUP_PENDING_KEY)).toBeNull()
    expect(localStorage.getItem(SIGN_IN_DEFERRED_KEY)).toBe('true')
    expect(useUserStore.getState()).toMatchObject({ uid: '', nickname: '' })
    expect(mocks.clearMeetingsCache).toHaveBeenCalledOnce()
    expect(mocks.clearMeetingCache).toHaveBeenCalledOnce()
    expect(mocks.clearFirebaseSessionAndCache).toHaveBeenCalledOnce()
  })

  it('Firebase 캐시 정리에 실패하면 다음 실행을 위한 표시를 유지한다', async () => {
    mocks.clearFirebaseSessionAndCache.mockRejectedValueOnce(new Error('cache failed'))
    const { finalizeLocalAccountDeletion } = await import('./accountCleanup')
    const { useUserStore } = await import('../store/userStore')
    useUserStore.getState().setUser('old-user', '기존 사용자')

    await expect(finalizeLocalAccountDeletion()).rejects.toThrow('cache failed')

    expect(localStorage.getItem(CLEANUP_PENDING_KEY)).toBe('true')
    expect(useUserStore.getState()).toMatchObject({ uid: '', nickname: '' })
  })

  it('미완료 표시가 있으면 새 로그인 전에 Firebase 캐시를 복구 정리한다', async () => {
    localStorage.setItem(CLEANUP_PENDING_KEY, 'true')
    localStorage.setItem(NICKNAME_KEY, '기존 사용자')
    const { recoverPendingAccountCleanup } = await import('./accountCleanup')

    await recoverPendingAccountCleanup()

    expect(mocks.clearPendingFirebaseSessionAndCache).toHaveBeenCalledOnce()
    expect(localStorage.getItem(NICKNAME_KEY)).toBeNull()
    expect(localStorage.getItem(CLEANUP_PENDING_KEY)).toBeNull()
    expect(localStorage.getItem(SIGN_IN_DEFERRED_KEY)).toBe('true')
  })

  it('사용자가 다시 시작하기 전까지 새 익명 로그인을 미룬다', async () => {
    localStorage.setItem(SIGN_IN_DEFERRED_KEY, 'true')
    const { finishDeferredAnonymousSignIn, shouldDeferAnonymousSignIn } = await import('./accountCleanup')

    expect(shouldDeferAnonymousSignIn()).toBe(true)
    finishDeferredAnonymousSignIn()
    expect(shouldDeferAnonymousSignIn()).toBe(false)
  })
})
