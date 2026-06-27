import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Asset, TextField, Top } from '@toss/tds-mobile'
import DatePicker from '../components/DatePicker'
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { generatePreMemberId } from '../lib/meetingMembers'
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
  fields: { name: string; date: string; members: string[]; memo: string },
  uid: string,
  nickname: string
): Promise<string> {
  const names = fields.members.filter((n) => nickname.length === 0 || n !== nickname)

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
    memberCount: 1 + names.length,
    totalAmount: 0,
    expenseCount: 0,
  })

  batch.set(doc(db, 'meetings', meetingRef.id, 'members', uid), { nickname })

  for (const name of names) {
    batch.set(doc(db, 'meetings', meetingRef.id, 'members', generatePreMemberId()), { nickname: name })
  }

  await batch.commit()
  return meetingRef.id
}

export default function MeetingNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { uid, nickname } = useUserStore()

  const [name, setName] = useState('')
  const [date, setDate] = useState(searchParams.get('date') ?? getTodayString())
  const [members, setMembers] = useState<string[]>([])
  const [memberInput, setMemberInput] = useState('')
  const [memberError, setMemberError] = useState(false)
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const isDateValid = /^\d{4}\.\d{2}\.\d{2}$/.test(date)

  function addMember() {
    const trimmed = memberInput.trim()
    if (trimmed.length === 0) {
      setMemberInput('')
      return
    }
    // '나'(내 닉네임)는 이미 자동으로 포함되므로 같은 이름을 또 추가하면 막아야 한다.
    // 막지 않으면 createMeeting()에서 조용히 걸러지기만 해서, 사용자는 추가했다고
    // 생각한 참여자가 아무 안내 없이 사라지는 것처럼 보인다.
    if (members.includes(trimmed) || trimmed === nickname) {
      setMemberError(true)
      return
    }
    setMembers((prev) => [...prev, trimmed])
    setMemberInput('')
    setMemberError(false)
  }

  function removeMember(name: string) {
    setMembers((prev) => prev.filter((m) => m !== name))
  }

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
          maxLength={30}
        />
        <DatePicker value={date} onChange={setDate} />
        <TextField
          variant="box"
          labelOption="sustain"
          label="참여자"
          placeholder="이름 입력 후 추가"
          value={memberInput}
          onChange={(e) => {
            setMemberInput(e.target.value)
            setMemberError(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addMember()
            }
          }}
          help={
            <>
              {memberError ? (
                <span style={{ color: '#ef4444' }}>이미 추가된 참여자예요</span>
              ) : (
                "'나'는 자동으로 포함돼요"
              )}
              {members.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {members.map((name) => (
                    <span
                      key={name}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 6px 4px 10px',
                        fontSize: 13,
                        border: '1px solid #e8e8e8',
                        borderRadius: 20,
                        background: '#f5f5f5',
                        color: '#333',
                      }}
                    >
                      {name}
                      <button
                        onClick={() => removeMember(name)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          border: 'none',
                          background: '#ccc',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                          lineHeight: 1,
                          padding: 0,
                          flexShrink: 0,
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </>
          }
          right={
            <button
              type="button"
              onClick={addMember}
              disabled={memberInput.trim().length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                padding: 4,
                cursor: memberInput.trim().length === 0 ? 'default' : 'pointer',
                opacity: memberInput.trim().length === 0 ? 0.4 : 1,
              }}
            >
              <Asset.Icon
                frameShape={Asset.frameShape.CleanW24}
                backgroundColor="transparent"
                name="icon-plus-circle-blue"
                aria-hidden={true}
                ratio="1/1"
              />
            </button>
          }
        />
        <TextField
          variant="box"
          labelOption="sustain"
          label="한줄 메모"
          placeholder="예: 제주 2박 3일"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={50}
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
