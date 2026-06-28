import { getIdToken } from './firebase'

export interface UploadedImage {
  url: string
  publicId: string
}

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

/**
 * 업로드 전에 화면에 보일 용도로는 과한 카메라 원본 해상도를 줄이고
 * 재압축한다. EXIF 방향 정보(imageOrientation: 'from-image')를 반영해야
 * 세로로 찍은 사진이 캔버스에 옆으로 누운 채로 그려지지 않는다. 어떤
 * 이유로든 압축이 실패하면(지원하지 않는 형식 등) 원본 파일을 그대로
 * 반환해 업로드 자체가 막히지 않게 한다.
 */
async function compressImage(file: File, maxDimension = MAX_DIMENSION, quality = JPEG_QUALITY): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close(); return file }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/**
 * Cloudinary unsigned upload.
 * meetingId를 폴더로 지정해 publicId가 항상 `ddingdone/{meetingId}/...` 형태가
 * 되도록 한다 — Worker가 "이 publicId가 진짜 이 모임 소속인지"를 문자열만으로
 * 검증할 수 있어야, 멤버십 검사만으로는 못 막는 "내 모임 멤버지만 남의 모임
 * 사진을 지우려는" 시도까지 막을 수 있다.
 */
export async function uploadImage(file: File, meetingId: string): Promise<UploadedImage> {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary 환경변수가 설정되지 않았습니다.')
  }

  const compressed = await compressImage(file)

  const formData = new FormData()
  formData.append('file', compressed)
  formData.append('upload_preset', uploadPreset)
  formData.append('folder', `ddingdone/${meetingId}`)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: formData }
  )

  if (!res.ok) throw new Error('이미지 업로드 실패')
  const data = await res.json()
  return { url: data.secure_url as string, publicId: data.public_id as string }
}

/**
 * Cloudflare Worker를 통해 Cloudinary 이미지를 삭제한다.
 * API Secret은 Worker에만 보관되어 있어 클라이언트에서 직접 삭제 API를 호출할 수 없다.
 * 고정 비밀번호 대신 본인의 Firebase ID 토큰을 보내고, Worker가 그 토큰을 검증한
 * 뒤 해당 사용자가 meetingId의 실제 멤버인지까지 확인한다 — 고정값은 앱 코드에
 * 그대로 박혀서 누구나 꺼내 쓸 수 있지만, ID 토큰은 매번 새로 발급되고 본인 것만
 * 유효하므로 훔쳐서 재사용할 수 없다.
 */
export async function deleteImage(publicId: string, meetingId: string): Promise<void> {
  const workerUrl = import.meta.env.VITE_CLOUDINARY_CLEANUP_WORKER_URL
  if (!workerUrl) {
    throw new Error('Cloudinary 정리용 Worker 환경변수가 설정되지 않았습니다.')
  }

  const idToken = await getIdToken()
  if (!idToken) throw new Error('로그인 정보가 없어요.')

  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ publicId, meetingId }),
  })

  if (!res.ok) throw new Error('이미지 삭제 실패')
}
