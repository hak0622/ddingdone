import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'
import { doc, updateDoc } from 'firebase/firestore'
import DatePicker from '../components/DatePicker'
import { db } from '../lib/firebase'
import { useMeeting } from '../hooks/useMeeting'
import { useUserStore } from '../store/userStore'

export default function MeetingEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { uid } = useUserStore()
  // MeetingDetail 등 같은 모임을 보는 다른 화면과 구독을 공유한다 — 이 화면만을
  // 위해 모임 문서를 또 getDoc으로 읽지 않는다.
  const { meeting, members, loading: meetingLoading, error: meetingError } = useMeeting(id)

  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [notMember, setNotMember] = useState(false)

  // 폼 입력값은 처음 들어왔을 때 한 번만 채운다 — 실시간 구독이라 그 뒤에
  // 데이터가 갱신될 때마다(예: 다른 사람이 동시에 수정) 입력 중인 값을
  // 덮어쓰면 안 되기 때문이다.
  const seededRef = useRef(false)
  // 처음 불러온 값을 따로 기억해둔다 — 제출 시 실제로 바뀐 게 있는지 비교해서,
  // 아무것도 안 바꾸고 수정하기를 눌러도 불필요한 쓰기가 나가지 않게 한다.
  const originalRef = useRef({ name: '', date: '', memo: '' })
  useEffect(() => {
    if (meetingLoading || seededRef.current) return
    if (meetingError || !meeting) { setLoadError(true); return }
    if (!members[uid]) { setNotMember(true); return }
    setName(meeting.name ?? '')
    setDate(meeting.date ?? '')
    setMemo(meeting.memo ?? '')
    setLoaded(true)
    originalRef.current = { name: meeting.name ?? '', date: meeting.date ?? '', memo: meeting.memo ?? '' }
    seededRef.current = true
  }, [meetingLoading, meeting, meetingError, members, uid])

  async function handleSubmit() {
    if (!id || !name.trim() || submitting) return
    const trimmedName = name.trim()
    const original = originalRef.current
    // 이름/날짜/메모 중 실제로 바뀐 게 하나도 없으면 Firestore에 쓸 필요가 없다.
    if (trimmedName === original.name && date === original.date && memo === original.memo) {
      navigate(-1)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await updateDoc(doc(db, 'meetings', id), {
        name: trimmedName,
        date,
        memo,
      })
      navigate(-1)
    } catch {
      setError('수정하지 못했어요. 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  if (notMember) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>방 정보 수정</Top.TitleParagraph>} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 56px)', gap: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>수정 권한이 없어요</p>
          <button onClick={() => navigate(-1)} style={{ padding: '10px 20px', fontSize: 14, border: '1px solid #d8d8d8', borderRadius: 8, background: '#fff', cursor: 'pointer' }}>
            돌아가기
          </button>
        </div>
      </>
    )
  }

  if (loadError) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>방 정보 수정</Top.TitleParagraph>} />
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
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>방 정보를 불러오지 못했어요</p>
          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              border: '1px solid #d8d8d8',
              borderRadius: 8,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            돌아가기
          </button>
        </div>
      </>
    )
  }

  const isDateValid = /^\d{4}\.\d{2}\.\d{2}$/.test(date)

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>방 정보 수정</Top.TitleParagraph>} />
      {!loaded ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 56px - 60px)' }}>
          <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>불러오는 중...</p>
        </div>
      ) : (
        <div style={{ padding: '0 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TextField
            variant="box"
            labelOption="sustain"
            label="방 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
          />
          <DatePicker value={date} onChange={setDate} />
          <TextField
            variant="box"
            labelOption="sustain"
            label="한줄 메모"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={16}
          />
        </div>
      )}
      {error && (
        <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '0 20px 12px', margin: 0 }}>
          {error}
        </p>
      )}
      <FixedBottomCTA disabled={!name.trim() || !isDateValid || submitting} onClick={handleSubmit}>
        {submitting ? '수정 중...' : '수정하기'}
      </FixedBottomCTA>
    </>
  )
}
