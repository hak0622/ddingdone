import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Top } from '@toss/tds-mobile'
import { collection, getDoc, doc, serverTimestamp, increment, writeBatch } from 'firebase/firestore'
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
  // 정산 완료 여부는 같은 모임을 보고 있는 다른 화면(상세 등)과 공유되는
  // 구독에서 그대로 가져온다 — 화면마다 따로 getDoc을 또 호출할 필요가 없다.
  const { meeting, members, loading } = useMeeting(meetingId)

  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [memo, setMemo] = useState('')
  const [paidBy, setPaidBy] = useState(uid)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [originalAmount, setOriginalAmount] = useState(0)
  const [editLoaded, setEditLoaded] = useState(!editId)
  // 수정 모드에서 처음 불러온 값을 기억해, 제출 시 실제로 바뀐 게 있는지
  // 비교한다 — 아무것도 안 바꾸고 수정하기를 눌러도 쓰기가 나가지 않게 한다.
  const originalRef = useRef({ category: '', memo: '', paidBy: '' })

  useEffect(() => {
    if (!loading && meeting?.status === 'settled') navigate(-1)
  }, [loading, meeting])

  useEffect(() => {
    if (!editId || !meetingId) return
    getDoc(doc(db, 'meetings', meetingId, 'expenses', editId)).then((snap) => {
      if (!snap.exists()) {
        navigate(-1)
        return
      }
      const data = snap.data()
      setAmount(String(data.amount ?? ''))
      setOriginalAmount(data.amount ?? 0)
      setCategory(data.category ?? '')
      setMemo(data.memo ?? '')
      setPaidBy(data.paidBy ?? '')
      originalRef.current = { category: data.category ?? '', memo: data.memo ?? '', paidBy: data.paidBy ?? '' }
      setEditLoaded(true)
    }).catch(() => {
      setError('비용을 불러오지 못했어요.')
      setEditLoaded(true)
    })
  }, [editId, meetingId])

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
    if (editId) {
      const original = originalRef.current
      const unchanged = Number(amount) === originalAmount && category === original.category &&
        memo === original.memo && paidBy === original.paidBy
      if (unchanged) {
        navigate(-1)
        return
      }
    }
    setSubmitting(true)
    setError('')
    try {
      const batch = writeBatch(db)
      if (editId) {
        batch.update(doc(db, 'meetings', meetingId, 'expenses', editId), {
          amount: Number(amount),
          category,
          paidBy,
          memo,
        })
        batch.update(doc(db, 'meetings', meetingId), {
          totalAmount: increment(Number(amount) - originalAmount),
        })
      } else {
        const expenseRef = doc(collection(db, 'meetings', meetingId, 'expenses'))
        batch.set(expenseRef, {
          amount: Number(amount),
          category,
          paidBy,
          memo,
          createdAt: serverTimestamp(),
        })
        batch.update(doc(db, 'meetings', meetingId), {
          totalAmount: increment(Number(amount)),
          expenseCount: increment(1),
        })
      }
      await batch.commit()
      navigate(-1)
    } catch {
      setError(editId ? '비용을 수정하지 못했어요. 다시 시도해주세요.' : '비용을 추가하지 못했어요. 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  const isValid = Number(amount) > 0 && paidBy !== '' && !submitting && editLoaded

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>{editId ? '비용 수정' : '비용 추가'}</Top.TitleParagraph>} />
      <div style={{ padding: '0 20px 32px' }}>

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
              fontSize: 16,
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
              {Object.entries(members)
                .sort(([a], [b]) => {
                  if (a === uid) return -1
                  if (b === uid) return 1
                  return 0
                })
                .map(([memberUid, name]) => (
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

        {error && (
          <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '12px 0 0', margin: 0 }}>
            {error}
          </p>
        )}
        <button
          disabled={!isValid}
          onClick={handleSubmit}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 24,
            height: 56,
            background: isValid ? '#3182F6' : '#e0e0e0',
            color: isValid ? '#fff' : '#aaa',
            border: 'none',
            borderRadius: 12,
            fontSize: 17,
            fontWeight: 600,
            cursor: isValid ? 'pointer' : 'default',
          }}
        >
          {editId ? (submitting ? '수정 중...' : '수정하기') : (submitting ? '추가 중...' : '추가하기')}
        </button>
      </div>
    </>
  )
}
