import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'
import { collection, addDoc, setDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'
import ResultScreen from '../components/ResultScreen'

function getTodayString(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}.${mm}.${dd}`
}

async function createMeeting(
  fields: { name: string; date: string; members: string; memo: string },
  uid: string,
  nickname: string
): Promise<string> {
  const names = fields.members
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && (nickname.length === 0 || n !== nickname))

  const meetingRef = await addDoc(collection(db, 'meetings'), {
    name: fields.name.trim(),
    date: fields.date,
    memo: fields.memo,
    createdBy: uid,
    createdAt: serverTimestamp(),
    photoUrl: null,
    status: 'active',
    memberUids: [uid],
    memberCount: 1 + names.length,
    totalAmount: 0,
    expenseCount: 0,
  })

  await setDoc(doc(db, 'meetings', meetingRef.id, 'members', uid), {
    nickname,
  })

  for (const name of names) {
    const preId = `pre_${Math.random().toString(36).slice(2, 9)}`
    await setDoc(doc(db, 'meetings', meetingRef.id, 'members', preId), {
      nickname: name,
    })
  }

  return meetingRef.id
}

export default function MeetingNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { uid, nickname } = useUserStore()

  const [name, setName] = useState('')
  const [date, setDate] = useState(searchParams.get('date') ?? getTodayString())
  const [members, setMembers] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (name.trim().length === 0 || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const meetingId = await createMeeting({ name, date, members, memo }, uid, nickname)
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
        />
        <TextField
          variant="box"
          labelOption="sustain"
          label="날짜"
          placeholder="예: 2026.06.13"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <div>
          <TextField
            variant="box"
            labelOption="sustain"
            label="참여자"
            placeholder="예: 민수, 지현"
            value={members}
            onChange={(e) => setMembers(e.target.value)}
          />
          <p style={{ fontSize: 12, color: '#888', margin: '6px 0 0 4px' }}>나는 자동으로 포함돼요</p>
        </div>
        <TextField
          variant="box"
          labelOption="sustain"
          label="한줄 메모"
          placeholder="예: 제주 2박 3일"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </div>
      {error && (
        <p
          style={{
            fontSize: 13,
            color: '#ef4444',
            textAlign: 'center',
            padding: '0 20px 12px',
            margin: 0,
          }}
        >
          {error}
        </p>
      )}
      <FixedBottomCTA
        disabled={name.trim().length === 0 || submitting}
        onClick={handleSubmit}
      >
        {submitting ? '생성 중...' : '정산방 만들기'}
      </FixedBottomCTA>
    </>
  )
}
