import {
  getAnonymousKey,
  getTossShareLink,
  share,
} from '@apps-in-toss/web-framework'

// 토스 WebView 환경 여부 확인
export function isInsideTossApp(): boolean {
  return typeof window !== 'undefined' && !!window.__GRANITE_NATIVE_EMITTER
}

// 사용자 고유 키 (토스 앱 내: 토스 계정 기반, 브라우저: null 반환)
export async function getAnonymousUid(): Promise<string | null> {
  if (!isInsideTossApp()) return null
  try {
    const result = await getAnonymousKey()
    if (!result || result === 'ERROR') return null
    return result.hash
  } catch {
    return null
  }
}

// 초대 링크 공유
export async function shareInviteLink(meetingId: string): Promise<void> {
  const deeplink = `intoss://ddingdone?meeting=${meetingId}`
  try {
    const tossLink = await getTossShareLink(deeplink)
    await share({
      message: `띵돈 정산방에 초대됐어요!\n내가 낸 금액을 입력해 주세요.\n${tossLink}`,
    })
  } catch {
    // 브라우저 개발 환경 fallback
    await navigator.clipboard.writeText(deeplink)
  }
}

// 텍스트 공유
export async function shareText(message: string): Promise<void> {
  try {
    await share({ message })
  } catch {
    await navigator.clipboard.writeText(message)
  }
}
