import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useMeeting } from '../hooks/useMeeting'

export default function ExpenseInput() {
  const { id: meetingId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { members, loading } = useMeeting(meetingId)

  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    setAmount(raw)
  }

  function getDisplayAmount(): string {
    if (!amount) return ''
    return Number(amount).toLocaleString('ko-KR')
  }

  async function handleSubmit() {
    if (Number(amount) === 0 || !paidBy || !meetingId || submitting) return
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'meetings', meetingId, 'expenses'), {
        amount: Number(amount),
        paidBy,
        memo,
        createdAt: serverTimestamp(),
      })
      navigate(-1)
    } finally {
      setSubmitting(false)
    }
  }

  const isValid = Number(amount) > 0 && paidBy !== '' && !submitting

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>비용 추가</Top.TitleParagraph>} />
      <div style={{ padding: '0 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TextField
          variant="big"
          label="얼마를 냈나요?"
          placeholder="0"
          value={getDisplayAmount()}
          onChange={handleAmountChange}
          inputMode="numeric"
        />
        <TextField
          variant="box"
          label="내용"
          placeholder="예: 숙소 비용"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 4px', color: '#191919' }}>
            누가 냈나요?
          </p>
          {loading ? (
            <p style={{ fontSize: 14, color: '#8b8b8b', padding: '14px 0' }}>불러오는 중...</p>
          ) : (
            Object.entries(members).map(([uid, name]) => (
              <div
                key={uid}
                onClick={() => setPaidBy(uid)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 0',
                  borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 15, color: '#191919' }}>{name}</span>
                {paidBy === uid && (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="10" fill="#3182F6" />
                    <path
                      d="M6 10l3 3 5-5"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      <FixedBottomCTA disabled={!isValid} onClick={handleSubmit}>
        {submitting ? '추가 중...' : '추가하기'}
      </FixedBottomCTA>
    </>
  )
}
