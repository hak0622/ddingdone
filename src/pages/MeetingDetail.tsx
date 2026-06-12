import { useNavigate, useParams } from 'react-router-dom'
import { FixedBottomCTA, Top } from '@toss/tds-mobile'
import { useMeeting } from '../hooks/useMeeting'

function formatKRW(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}

export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { meeting, members, expenses, loading } = useMeeting(id)

  if (loading) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>정산방</Top.TitleParagraph>} />
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

  if (!meeting) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>정산방</Top.TitleParagraph>} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px)',
            gap: 16,
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>정산방을 찾을 수 없어요</p>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              border: '1px solid #d8d8d8',
              borderRadius: 8,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            홈으로
          </button>
        </div>
      </>
    )
  }

  const memberList = Object.values(members)
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0)
  const perPerson = memberList.length > 0 ? Math.floor(totalAmount / memberList.length) : 0

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={22}>{meeting.name}</Top.TitleParagraph>}
      />

      {meeting.photoUrl ? (
        <img
          src={meeting.photoUrl}
          alt="대표 사진"
          style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            height: 200,
            background: '#e8e8e8',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          <p style={{ fontSize: 14, color: '#888', margin: 0 }}>
            오늘을 대표할 사진을 추가해보세요
          </p>
          <button
            onClick={() => console.log('사진 추가 — Phase 2에서 구현')}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              border: '1px solid #ccc',
              borderRadius: 8,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            사진 추가
          </button>
        </div>
      )}

      <div style={{ padding: '20px 20px 0' }}>
        <p style={{ fontSize: 14, color: '#555', margin: '0 0 8px' }}>
          {meeting.date}
          {meeting.memo ? ` · ${meeting.memo}` : ''}
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {memberList.map((name) => (
            <span
              key={name}
              style={{
                padding: '4px 10px',
                fontSize: 13,
                border: '1px solid #d8d8d8',
                borderRadius: 20,
                background: '#f5f5f5',
              }}
            >
              {name}
            </span>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 2px' }}>총 지출</p>
            <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{formatKRW(totalAmount)}</p>
          </div>
          <div>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 2px' }}>1인당</p>
            <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{formatKRW(perPerson)}</p>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          {expenses.length === 0 ? (
            <p style={{ fontSize: 14, color: '#aaa', textAlign: 'center', padding: '24px 0' }}>
              아직 비용이 없어요
            </p>
          ) : (
            expenses.map((expense) => (
              <div
                key={expense.id}
                style={{
                  padding: '12px 0',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <p style={{ fontSize: 14, margin: '0 0 2px' }}>{expense.memo || '—'}</p>
                  <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
                    {members[expense.paidBy] ?? expense.paidBy} 납부
                  </p>
                </div>
                <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                  {formatKRW(expense.amount)}
                </p>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 100 }}>
          <button
            onClick={() => navigate(`/meetings/${id}/settle`)}
            style={{
              flex: 1,
              padding: '14px 0',
              fontSize: 15,
              fontWeight: 600,
              border: '1px solid #d8d8d8',
              borderRadius: 10,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            정산 결과 보기
          </button>
          <button
            onClick={() => console.log('초대 링크 공유 — Phase 2에서 shareInviteLink 연결')}
            style={{
              flex: 1,
              padding: '14px 0',
              fontSize: 15,
              fontWeight: 600,
              border: '1px solid #d8d8d8',
              borderRadius: 10,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            초대 링크 공유
          </button>
        </div>
      </div>

      <FixedBottomCTA onClick={() => navigate(`/meetings/${id}/expense`)}>
        내가 낸 비용 추가
      </FixedBottomCTA>
    </>
  )
}
