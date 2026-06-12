import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'
import { collection, addDoc, setDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'

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
  const meetingRef = await addDoc(collection(db, 'meetings'), {
    name: fields.name.trim(),
    date: fields.date,
    memo: fields.memo,
    createdBy: uid,
    createdAt: serverTimestamp(),
    photoUrl: null,
  })

  await setDoc(doc(db, 'meetings', meetingRef.id, 'members', uid), {
    nickname,
  })

  const names = fields.members
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && n !== nickname)

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
  const { uid, nickname } = useUserStore()

  const [name, setName] = useState('')
  const [date, setDate] = useState(getTodayString())
  const [members, setMembers] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (name.trim().length === 0 || submitting) return
    setSubmitting(true)
    try {
      const meetingId = await createMeeting({ name, date, members, memo }, uid, nickname)
      navigate(`/meetings/${meetingId}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={22}>새 정산방</Top.TitleParagraph>}
      />
      <div style={{ padding: '0 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TextField
          variant="box"
          label="방 이름"
          placeholder="예: 제주도 여행"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          variant="box"
          label="날짜"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <TextField
          variant="box"
          label="참여자"
          placeholder="예: 민수, 지현, 나"
          value={members}
          onChange={(e) => setMembers(e.target.value)}
        />
        <TextField
          variant="box"
          label="한줄 메모"
          placeholder="예: 제주 2박 3일"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </div>
      <FixedBottomCTA
        disabled={name.trim().length === 0 || submitting}
        onClick={handleSubmit}
      >
        {submitting ? '생성 중...' : '정산방 만들기'}
      </FixedBottomCTA>
    </>
  )
}
