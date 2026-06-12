/**
 * Cloudinary unsigned upload
 * @returns 업로드된 이미지의 secure_url
 */
export async function uploadImage(file: File): Promise<string> {
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
  return data.secure_url as string
}
