const CLOUDINARY_TIMEOUT_MS = 10_000

export class CloudinaryDeletionError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'CloudinaryDeletionError'
  }
}

function basicAuthorization(apiKey: string, apiSecret: string): string {
  return `Basic ${btoa(`${apiKey}:${apiSecret}`)}`
}

async function deleteFolderIfEmpty(
  cloudName: string,
  authorization: string,
  meetingId: string,
): Promise<void> {
  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/folders/${encodeURIComponent(`ddingdone/${meetingId}`)}`,
      {
        method: 'DELETE',
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(CLOUDINARY_TIMEOUT_MS),
      },
    )
    await response.body?.cancel()
  } catch {
    // 자산 삭제가 끝난 뒤의 빈 폴더 정리는 개인정보 삭제 결과와 무관한 best-effort 작업이다.
  }
}

export async function deleteCloudinaryMeetingImage(
  cloudName: string,
  apiKey: string,
  apiSecret: string,
  meetingId: string,
  publicId: string,
): Promise<void> {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(meetingId) ||
    !publicId.startsWith(`ddingdone/${meetingId}/`)
  ) throw new CloudinaryDeletionError('INVALID_CLOUDINARY_REFERENCE')

  const authorization = basicAuthorization(apiKey, apiSecret)
  const form = new FormData()
  form.append('public_id', publicId)
  form.append('invalidate', 'true')
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`,
    {
      method: 'POST',
      headers: { Authorization: authorization },
      body: form,
      signal: AbortSignal.timeout(CLOUDINARY_TIMEOUT_MS),
    },
  )
  const json: unknown = await response.json().catch(() => null)
  const result = json && typeof json === 'object'
    ? (json as { result?: unknown }).result
    : null
  // Workflow 재시도 때 이미 삭제된 자산은 성공으로 처리한다.
  if (!response.ok || (result !== 'ok' && result !== 'not found')) {
    throw new CloudinaryDeletionError('CLOUDINARY_DELETE_FAILED')
  }

  await deleteFolderIfEmpty(cloudName, authorization, meetingId)
}
