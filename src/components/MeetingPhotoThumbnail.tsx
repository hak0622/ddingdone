import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MeetingListItem } from '../hooks/useMeetings'
import { useMeetingPhoto } from '../hooks/useMeetingPhoto'

export default function MeetingPhotoThumbnail({ meeting, children }: {
  meeting: MeetingListItem
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [failedSrc, setFailedSrc] = useState<string>()
  useEffect(() => {
    if (!ref.current || visible || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisible(true)
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [visible])
  const allowed = meeting.photoAccessConfirmed === true
  const photo = useMeetingPhoto(meeting.id, meeting.photoVersion, allowed,
    visible || typeof IntersectionObserver === 'undefined')
  const src = photo

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      {src && src !== failedSrc ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : children}
    </div>
  )
}
