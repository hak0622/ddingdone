import { useState, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FixedBottomCTA, Top } from '@toss/tds-mobile'
import { collection, addDoc, updateDoc, getDoc, doc, serverTimestamp, increment } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useMeeting } from '../hooks/useMeeting'
import { useUserStore } from '../store/userStore'

const CATEGORIES = [
  { id: '식비', emoji: '🍖' },
  { id: '카페', emoji: '☕' },
  { id: '숙소', emoji: '🏨' },
  { id: '교통', emoji: '🚕' },
  { id: '기타', emoji: '🎟️' },
]

export default function ExpenseInput() {
  const { id: meetingId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('editId')
  const { uid } = useUserStore()
  const { members, loading } = useMeeting(meetingId)

  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [memo, setMemo] = useState('')
  const [paidBy, setPaidBy] = useState(uid)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [originalAmount, setOriginalAmount] = useState(0)

  useEffect(() => {
    if (!editId || !meetingId) return
    getDoc(doc(db, 'meetings', meetingId, 'expenses', editId)).then((snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      setAmount(String(data.amount ?? ''))
      setOriginalAmount(data.amount ?? 0)
      setCategory(data.category ?? '')
      setMemo(data.memo ?? '')
      setPaidBy(data.paidBy ?? uid)
    })
  }, [editId, meetingId, uid])

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
    setError('')
    try {
      if (editId) {
        await updateDoc(doc(db, 'meetings', meetingId, 'expenses', editId), {
          amount: Number(amount),
          category,
          paidBy,
          memo,
        })
        await updateDoc(doc(db, 'meetings', meetingId), {
          totalAmount: increment(Number(amount) - originalAmount),
        })
      } else {
        await addDoc(collection(db, 'meetings', meetingId, 'expenses'), {
          amount: Number(amount),
          category,
          paidBy,
          memo,
          createdAt: serverTimestamp(),
        })
        await updateDoc(doc(db, 'meetings', meetingId), {
          totalAmount: increment(Number(amount)),
          expenseCount: increment(1),
        })
      }
      navigate(-1)
    } catch {
      setError(editId ? '비용을 수정하지 못했어요. 다시 시도해주세요.' : '비용을 추가하지 못했어요. 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  const isValid = Number(amount) > 0 && paidBy !== '' && !submitting

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>{editId ? '비용 수정' : '비용 추가'}</Top.TitleParagraph>} />
      <div style={{ padding: '0 20px 100px' }}>

        {/* 금액 */}
        <div style={{ textAlign: 'center', padding: '20px 0 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
            <input
              style={{
                fontSize: 40,
                fontWeight: 700,
                border: 'none',
                outline: 'none',
                textAlign: 'right',
                background: 'transparent',
                width: '55%',
                color: '#191919',
              }}
              placeholder="0"
              value={getDisplayAmount()}
              onChange={handleAmountChange}
              inputMode="numeric"
            />
            <span style={{ fontSize: 24, fontWeight: 700, color: '#191919' }}>원</span>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #f0f0f0', margin: '0 -20px 20px' }} />

        {/* 카테고리 — 한 줄 */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#888', margin: '0 0 8px' }}>카테고리</p>
          <div style={{ display: 'flex', gap: 6 }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id === category ? '' : cat.id)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  background: category === cat.id ? '#3182F6' : '#f5f5f5',
                  color: category === cat.id ? '#fff' : '#555',
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 2 }}>{cat.emoji}</div>
                {cat.id}
              </button>
            ))}
          </div>
        </div>

        {/* 메모 */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#888', margin: '0 0 8px' }}>
            메모 <span style={{ fontWeight: 400 }}>(선택)</span>
          </p>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예: 저녁 삼겹살"
            style={{
              width: '100%',
              padding: '12px 14px',
              fontSize: 14,
              border: '1px solid #e0e0e0',
              borderRadius: 10,
              outline: 'none',
              boxSizing: 'border-box',
              color: '#191919',
              background: '#fff',
            }}
          />
        </div>

        {/* 결제자 */}
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#888', margin: '0 0 8px' }}>결제자</p>
          {loading ? (
            <p style={{ fontSize: 14, color: '#8b8b8b' }}>불러오는 중...</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(members).map(([memberUid, name]) => (
                <button
                  key={memberUid}
                  onClick={() => setPaidBy(memberUid)}
                  style={{
                    padding: '10px 22px',
                    borderRadius: 24,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 15,
                    fontWeight: 600,
                    background: paidBy === memberUid ? '#3182F6' : '#f5f5f5',
                    color: paidBy === memberUid ? '#fff' : '#555',
                  }}
                >
                  {uid === memberUid ? '나' : name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '0 20px 12px', margin: 0 }}>
          {error}
        </p>
      )}
      <FixedBottomCTA disabled={!isValid} onClick={handleSubmit}>
        {editId ? (submitting ? '수정 중...' : '수정하기') : (submitting ? '추가 중...' : '추가하기')}
      </FixedBottomCTA>
    </>
  )
}
