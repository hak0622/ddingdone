import { Bytes, doc, runTransaction } from 'firebase/firestore'
import { db } from './firebase'

const MAX_SIZE = 200 * 1024

async function compressPhoto(file: File): Promise<Bytes> {
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
        return Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer()))
      }
    }
    throw new Error('PHOTO_COMPRESSION_FAILED')
  } finally {
    bitmap.close()
  }
}

export async function saveMeetingPhoto(meetingId: string, file: File) {
  const bytes = await compressPhoto(file)
  const version = crypto.randomUUID()
  const meeting = doc(db, 'meetings', meetingId)
  await runTransaction(db, async (transaction) => {
    const data = (await transaction.get(meeting)).data()
    if (!data || data.status !== 'active' || data.participantModelVersion !== 2) {
      throw new Error('PHOTO_MEETING_UNAVAILABLE')
    }
    transaction.set(doc(meeting, 'photos', 'cover'), { version, bytes })
    transaction.update(meeting, { photoVersion: version })
  })
}
