export interface UploadedImage {
  url: string
  publicId: string
}

/**
 * Cloudinary unsigned upload
 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary 환경변수가 설정되지 않았습니다.')
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', uploadPreset)

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
 */
export async function deleteImage(publicId: string): Promise<void> {
  const workerUrl = import.meta.env.VITE_CLOUDINARY_CLEANUP_WORKER_URL
  const token = import.meta.env.VITE_CLOUDINARY_CLEANUP_TOKEN

  if (!workerUrl || !token) {
    throw new Error('Cloudinary 정리용 Worker 환경변수가 설정되지 않았습니다.')
  }

  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ publicId }),
  })

  if (!res.ok) throw new Error('이미지 삭제 실패')
}
