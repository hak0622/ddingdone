import type { MeetingListItem } from '../hooks/useMeetings'

interface Props {
  meeting: MeetingListItem
  onClick: () => void
}

export default function MeetingCard({ meeting, onClick }: Props) {
  const perPerson =
    meeting.memberCount > 0 ? Math.round(meeting.totalAmount / meeting.memberCount) : 0

  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 16,
        overflow: 'hidden',
        cursor: 'pointer',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        padding: '14px 16px',
        gap: 14,
      }}
    >
      {/* 좌측 썸네일 */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 12,
          overflow: 'hidden',
          flexShrink: 0,
          background: '#f0f4ff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {meeting.photoUrl ? (
          <img
            src={meeting.photoUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"
              stroke="#b0c4f8"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="13" r="3.5" stroke="#b0c4f8" strokeWidth="1.5" />
          </svg>
        )}
      </div>

      {/* 우측 정보 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
          <p
            style={{
              fontSize: 16,
              fontWeight: 700,
              margin: 0,
              color: '#191919',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {meeting.name}
          </p>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 20,
              background: meeting.status === 'active' ? '#3182F6' : '#e8e8e8',
              color: meeting.status === 'active' ? '#fff' : '#888',
              flexShrink: 0,
              marginLeft: 8,
            }}
          >
            {meeting.status === 'active' ? '진행중' : '완료'}
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 8px' }}>
          {meeting.memberCount}명 · {meeting.date}
        </p>
        <div style={{ display: 'flex', gap: 16 }}>
          <div>
            <p style={{ fontSize: 11, color: '#aaa', margin: '0 0 1px' }}>총 지출</p>
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#191919' }}>
              {meeting.totalAmount.toLocaleString('ko-KR')}원
            </p>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#aaa', margin: '0 0 1px' }}>1인당</p>
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#191919' }}>
              {perPerson.toLocaleString('ko-KR')}원
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
