import { describe, it, expect } from 'vitest'
import { cloudinaryThumbnail } from './cloudinary'

describe('cloudinaryThumbnail', () => {
  it('/upload/ 바로 뒤에 변환 파라미터를 끼워 넣는다', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/ddingdone/m1/photo.jpg'
    expect(cloudinaryThumbnail(url, 150)).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_150,h_150,c_fill,g_auto,q_auto,f_auto/v1/ddingdone/m1/photo.jpg'
    )
  })

  it('/upload/가 없는 URL은 그대로 반환한다', () => {
    const url = 'https://example.com/photo.jpg'
    expect(cloudinaryThumbnail(url, 150)).toBe(url)
  })
})
