import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudinaryDeletionError, deleteCloudinaryMeetingImage } from './cloudinary'

describe('deleteCloudinaryMeetingImage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('서버 인증으로 자산을 삭제하고 CDN 캐시를 무효화한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ result: 'ok' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await deleteCloudinaryMeetingImage(
      'cloud-name',
      'api-key',
      'api-secret',
      'meeting-1',
      'ddingdone/meeting-1/photo',
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toMatch(/\/image\/destroy$/u)
    expect(init?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Basic /u) })
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('public_id')).toBe('ddingdone/meeting-1/photo')
    expect((init?.body as FormData).get('invalidate')).toBe('true')
  })

  it('이미 없는 자산은 멱등 성공으로 처리한다', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ result: 'not found' }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))

    await expect(deleteCloudinaryMeetingImage(
      'cloud-name',
      'api-key',
      'api-secret',
      'meeting-1',
      'ddingdone/meeting-1/photo',
    )).resolves.toBeUndefined()
  })

  it('다른 방 폴더의 publicId는 외부 요청 전에 거부한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(deleteCloudinaryMeetingImage(
      'cloud-name',
      'api-key',
      'api-secret',
      'meeting-1',
      'ddingdone/meeting-2/photo',
    )).rejects.toBeInstanceOf(CloudinaryDeletionError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
