import { useParams } from 'react-router-dom'
import { FixedBottomCTA, Top } from '@toss/tds-mobile'
import { useUserStore } from '../store/userStore'

type Settlement = {
  from: string
  fromName: string
  to: string
  toName: string
  amount: number
}

function formatKRW(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}

export default function Settle() {
  const { id: meetingId } = useParams<{ id: string }>()
  const { uid } = useUserStore()

  const meeting = {
    name: '제주도 여행',
    date: '2026.06.11',
    memo: '제주 2박 3일',
    photoUrl: null as string | null,
  }
  const totalAmount = 90000
  const memberCount = 3

  const settlements: Settlement[] = [
    { from: 'uid2', fromName: '지현', to: 'uid1', toName: '민수', amount: 30000 },
  ]

  const myPayments = settlements.filter((s) => s.from === uid)
  const myReceivables = settlements.filter((s) => s.to === uid)

  void meetingId

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>정산 결과</Top.TitleParagraph>} />

      <div style={{ paddingBottom: 100 }}>
        {/* 대표 사진 영역 */}
        {meeting.photoUrl ? (
          <img
            src={meeting.photoUrl}
            alt="대표 사진"
            style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              height: 160,
              background: '#e8e8e8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <p style={{ fontSize: 14, color: '#888', margin: 0 }}>사진 없음</p>
          </div>
        )}

        <div style={{ padding: '20px 20px 0' }}>
          {/* 방 이름 + 날짜/메모 */}
          <p style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px', color: '#191919' }}>
            {meeting.name}
          </p>
          <p style={{ fontSize: 14, color: '#888', margin: '0 0 20px' }}>
            {meeting.date}
            {meeting.memo ? ` · ${meeting.memo}` : ''}
          </p>

          {/* 요약 */}
          <div
            style={{
              background: '#f7f7f7',
              borderRadius: 12,
              padding: '16px 20px',
              marginBottom: 24,
              display: 'flex',
              gap: 32,
            }}
          >
            <div>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 2px' }}>총 지출</p>
              <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{formatKRW(totalAmount)}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 2px' }}>1인당</p>
              <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
                {formatKRW(Math.floor(totalAmount / memberCount))}
              </p>
            </div>
          </div>

          {/* 보낼 돈 섹션 */}
          {myPayments.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#555', margin: '0 0 8px' }}>
                보낼 돈
              </p>
              {myPayments.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <span style={{ fontSize: 15, color: '#191919' }}>
                    나 → {s.toName}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#ef4444' }}>
                      {formatKRW(s.amount)}
                    </span>
                    <button
                      onClick={() =>
                        console.log(
                          `supertoss://send?amount=${s.amount}&bank=토스&accountNo=&origin=띵돈`,
                        )
                      }
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        border: 'none',
                        borderRadius: 6,
                        background: '#3182F6',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      토스로 보내기
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 받을 돈 섹션 */}
          {myReceivables.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#555', margin: '0 0 8px' }}>
                받을 돈
              </p>
              {myReceivables.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <span style={{ fontSize: 15, color: '#191919' }}>
                    {s.fromName} → 나
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#22c55e' }}>
                    +{formatKRW(s.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 섹션이 둘 다 없을 때 */}
          {myPayments.length === 0 && myReceivables.length === 0 && (
            <p style={{ fontSize: 14, color: '#aaa', textAlign: 'center', padding: '24px 0' }}>
              정산이 완료됐어요
            </p>
          )}
        </div>
      </div>

      <FixedBottomCTA.Single onClick={() => console.log('정산 결과 공유 — Phase 2에서 bridge.shareText 연결')}>
        정산 결과 공유하기
      </FixedBottomCTA.Single>
    </>
  )
}
