import { getPhotoClient } from './firebase'

const MAX_SIZE = 200 * 1024

async function compressPhoto(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('PHOTO_CANVAS_UNAVAILABLE')
    for (const [maxSide, quality] of [[1200, 0.82], [1200, 0.7], [960, 0.7], [720, 0.65], [480, 0.6]]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob?.type === 'image/jpeg' && blob.size > 0 && blob.size <= MAX_SIZE) {
        return new Uint8Array(await blob.arrayBuffer())
      }
    }
    throw new Error('PHOTO_COMPRESSION_FAILED')
  } finally {
    bitmap.close()
  }
}

const UNCERTAIN_COMMIT = new Set(['aborted', 'cancelled', 'deadline-exceeded', 'internal', 'unavailable', 'unknown'])

export async function saveMeetingPhoto(meetingId: string, file: File) {
  const bytes = await compressPhoto(file)
  const version = crypto.randomUUID()
  const { sdk, firestore } = await getPhotoClient()
  const meeting = sdk.doc(firestore, 'meetings', meetingId)
  const batch = sdk.writeBatch(firestore)
  batch.set(sdk.doc(meeting, 'photos', 'cover'), { version, bytes: sdk.Bytes.fromUint8Array(bytes) })
  batch.update(meeting, { photoVersion: version })
  try {
    await batch.commit()
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (!code || !UNCERTAIN_COMMIT.has(code)) throw error
    const saved = navigator.onLine
      ? await sdk.getDoc(meeting).then((snap) => snap.data()?.photoVersion, () => undefined)
      : undefined
    if (saved !== version) throw new Error('PHOTO_SAVE_UNCONFIRMED')
  }
}
