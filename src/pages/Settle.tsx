import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FixedBottomCTA, Top } from '@toss/tds-mobile'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { formatKRW } from '../utils/format'
import { COLORS } from '../styles/tokens'
import { useMeeting } from '../hooks/useMeeting'
import { calculateSettlements, type Settlement } from '../utils/settle'
import { useUserStore } from '../store/userStore'
import { shareText } from '../lib/bridge'
import ResultScreen from '../components/ResultScreen'

export default function Settle() {
  const { id: meetingId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { uid } = useUserStore()
  const { meeting, members, expenses, loading, error } = useMeeting(meetingId)
  const [settling, setSettling] = useState(false)
  const [settleSuccess, setSettleSuccess] = useState(false)
  const [settleError, setSettleError] = useState('')

  const settlements = useMemo<Settlement[]>(() => {
    if (!expenses.length || !Object.keys(members).length) return []
    return calculateSettlements(
      expenses.map((e) => ({ amount: e.amount, paidBy: e.paidBy })),
      members,
    )
  }, [expenses, members])

  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0)
  const memberCount = Object.keys(members).length
  const perPerson = memberCount > 0 ? Math.floor(totalAmount / memberCount) : 0

  const myPayments = settlements.filter((s) => s.from === uid)
  const myReceivables = settlements.filter((s) => s.to === uid)
  const isSettled = meeting?.status === 'settled'

  async function handleShare() {
    if (!meeting) return
    const lines = [
      `[띵돈] ${meeting.name} 정산 결과`,
      `📅 ${meeting.date}`,
      `💰 총 지출 ${totalAmount.toLocaleString('ko-KR')}원 · 1인당 ${perPerson.toLocaleString('ko-KR')}원`,
      '',
      ...settlements.map(
        (s) => `${s.fromName} → ${s.toName}: ${s.amount.toLocaleString('ko-KR')}원`,
      ),
    ]
    try {
      await shareText(lines.join('\n'))
    } catch {
      // 공유 취소 또는 Bridge 오류 — 사용자 액션이므로 조용히 무시
    }
  }

  async function handleSettle() {
    if (!meetingId || settling) return
    setSettling(true)
    setSettleError('')
    try {
      await updateDoc(doc(db, 'meetings', meetingId), { status: 'settled' })
      setSettleSuccess(true)
    } catch {
      setSettleError('정산 완료 처리하지 못했어요. 다시 시도해주세요.')
      setTimeout(() => setSettleError(''), 3000)
    } finally {
      setSettling(false)
    }
  }

  if (loading) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>정산 결과</Top.TitleParagraph>} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px)',
          }}
        >
          <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>계산하는 중...</p>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>정산 결과</Top.TitleParagraph>} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 56px)', gap: 8 }}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#191919' }}>정보를 불러오지 못했어요</p>
          <p style={{ fontSize: 14, color: '#888', margin: '0 0 16px' }}>잠시 후 다시 시도해주세요</p>
          <button onClick={() => navigate(-1)} style={{ padding: '12px 24px', fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 10, background: '#3182F6', color: '#fff', cursor: 'pointer' }}>
            돌아가기
          </button>
        </div>
      </>
    )
  }

  if (!meeting) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>정산 결과</Top.TitleParagraph>} />
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

  if (!members[uid]) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>정산 결과</Top.TitleParagraph>} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 56px)', gap: 8 }}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#191919' }}>참여하지 않은 정산방이에요</p>
          <p style={{ fontSize: 14, color: '#888', margin: '0 0 16px' }}>먼저 정산방에 참여해주세요</p>
          <button onClick={() => navigate(-1)} style={{ padding: '12px 24px', fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 10, background: '#3182F6', color: '#fff', cursor: 'pointer' }}>
            돌아가기
          </button>
        </div>
      </>
    )
  }

  if (settleSuccess) {
    return (
      <ResultScreen
        title="정산이 완료됐어요!"
        subtitle={`${meeting.name} · ${formatKRW(totalAmount)}`}
        onConfirm={() => navigate(-1)}
      />
    )
  }

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>{meeting.name}</Top.TitleParagraph>} />

      <div style={{ paddingBottom: 100 }}>
        <div style={{ padding: '20px 20px 0' }}>
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
              <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{formatKRW(perPerson)}</p>
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
                  <span style={{ fontSize: 15, color: '#191919', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>나 → {s.toName}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.error, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {formatKRW(s.amount)}
                  </span>
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
                  <span style={{ fontSize: 15, color: '#191919', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{s.fromName} → 나</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.primary, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    +{formatKRW(s.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {settlements.length === 0 && (
            <p style={{ fontSize: 14, color: '#aaa', textAlign: 'center', padding: '24px 0' }}>
              모두 정산됐어요!
            </p>
          )}

        </div>
      </div>

      {settleError && (
        <div style={{ position: 'fixed', bottom: 80, left: 0, right: 0, background: 'rgba(0,0,0,0.75)', color: '#fff', textAlign: 'center', padding: '12px 20px', fontSize: 14, zIndex: 100 }}>
          {settleError}
        </div>
      )}

      {isSettled ? (
        <FixedBottomCTA onClick={handleShare}>정산 결과 공유하기</FixedBottomCTA>
      ) : (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            gap: 8,
            padding: '12px 20px',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
            background: '#fff',
            borderTop: '1px solid #f0f0f0',
          }}
        >
          <button
            onClick={handleShare}
            style={{
              flex: 1,
              padding: '14px 0',
              borderRadius: 12,
              border: '1.5px solid #3182F6',
              background: '#fff',
              color: '#3182F6',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            결과 공유하기
          </button>
          <button
            onClick={handleSettle}
            disabled={settling}
            style={{
              flex: 1,
              padding: '14px 0',
              borderRadius: 12,
              border: 'none',
              background: settling ? '#aaa' : '#3182F6',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: settling ? 'default' : 'pointer',
            }}
          >
            {settling ? '처리 중...' : '정산 완료'}
          </button>
        </div>
      )}
    </>
  )
}
