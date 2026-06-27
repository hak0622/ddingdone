import {
  getTossShareLink,
  share,
} from '@apps-in-toss/web-framework'

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
