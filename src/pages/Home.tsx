import { useNavigate } from 'react-router-dom'
import { FixedBottomCTA, ListRow, Top } from '@toss/tds-mobile'
import { useUserStore } from '../store/userStore'
import { useMeetings } from '../hooks/useMeetings'

export default function Home() {
  const navigate = useNavigate()
  const { uid } = useUserStore()
  const { meetings, loading } = useMeetings(uid)

  if (loading) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>띵돈</Top.TitleParagraph>} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px)',
          }}
        >
          <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>불러오는 중...</p>
        </div>
      </>
    )
  }

  if (meetings.length === 0) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>띵돈</Top.TitleParagraph>} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px - 80px)',
            gap: 8,
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            아직 정산방이 없어요
          </p>
          <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>
            모임 후 정산을 시작해보세요
          </p>
        </div>
        <FixedBottomCTA onClick={() => navigate('/meetings/new')}>
          첫 정산방 만들기
        </FixedBottomCTA>
      </>
    )
  }

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>내 정산방</Top.TitleParagraph>} />
      <div style={{ paddingBottom: 80 }}>
        {meetings.map((meeting) => (
          <ListRow
            key={meeting.id}
            contents={
              <ListRow.Texts
                type="2RowTypeA"
                top={meeting.name}
                bottom={`${meeting.date} · ${meeting.memberCount}명 · ${meeting.totalAmount.toLocaleString('ko-KR')}원`}
              />
            }
            onClick={() => navigate(`/meetings/${meeting.id}`)}
          />
        ))}
      </div>
      <FixedBottomCTA onClick={() => navigate('/meetings/new')}>
        + 새 정산방 만들기
      </FixedBottomCTA>
    </>
  )
}
