import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TextField, Top } from '@toss/tds-mobile'
import DatePicker from '../components/DatePicker'
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'
import ResultScreen from '../components/ResultScreen'
import { shareInviteLink } from '../lib/bridge'

function getTodayString(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}.${mm}.${dd}`
}

async function createMeeting(
  fields: { name: string; date: string; memo: string },
  uid: string,
  nickname: string
): Promise<string> {
  const meetingRef = doc(collection(db, 'meetings'))
  const batch = writeBatch(db)

  batch.set(meetingRef, {
    name: fields.name.trim(),
    date: fields.date,
    memo: fields.memo,
    createdBy: uid,
    createdAt: serverTimestamp(),
    photoUrl: null,
    photoPublicId: null,
    status: 'active',
    memberUids: [uid],
    memberCount: 1,
    totalAmount: 0,
    expenseCount: 0,
  })

  batch.set(doc(db, 'meetings', meetingRef.id, 'members', uid), { nickname })

  await batch.commit()
  return meetingRef.id
}

export default function MeetingNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { uid, nickname } = useUserStore()

  const [name, setName] = useState('')
  const [date, setDate] = useState(searchParams.get('date') ?? getTodayString())
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const isDateValid = /^\d{4}\.\d{2}\.\d{2}$/.test(date)

  async function handleSubmit() {
    if (name.trim().length === 0 || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const meetingId = await createMeeting({ name, date, memo }, uid, nickname)
      setCreatedId(meetingId)
    } catch {
      setError('정산방을 만들지 못했어요. 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  if (createdId) {
    return (
      <ResultScreen
        title={`${name.trim()}을 만들었어요!`}
        subtitle="친구들을 초대하고 비용을 함께 기록해보세요"
        onInvite={async () => {
          try { await shareInviteLink(createdId) } catch { /* 공유 취소 무시 */ }
          navigate(`/meetings/${createdId}`)
        }}
        onConfirm={() => navigate(`/meetings/${createdId}`)}
      />
    )
  }

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>새 정산방</Top.TitleParagraph>} />
      <div style={{ padding: '0 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TextField
          variant="box"
          labelOption="sustain"
          label="방 이름"
          placeholder="예: 제주도 여행"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={11}
        />
        <DatePicker value={date} onChange={setDate} />
        <TextField
          variant="box"
          labelOption="sustain"
          label="한줄 메모"
          placeholder="예: 제주 2박 3일"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={16}
        />
        <button
          disabled={name.trim().length === 0 || !isDateValid || submitting}
          onClick={handleSubmit}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 8,
            height: 56,
            background: name.trim().length === 0 || !isDateValid || submitting ? '#e0e0e0' : '#3182F6',
            color: name.trim().length === 0 || !isDateValid || submitting ? '#aaa' : '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 17,
            fontWeight: 600,
            cursor: name.trim().length === 0 || !isDateValid || submitting ? 'default' : 'pointer',
          }}
        >
          {submitting ? '생성 중...' : '정산방 만들기'}
        </button>
      </div>
      {error && (
        <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '0 20px 12px', margin: 0 }}>
          {error}
        </p>
      )}
    </>
  )
}
