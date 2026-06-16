import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'
import { doc, updateDoc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

export default function MeetingEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!id) return
    getDoc(doc(db, 'meetings', id))
      .then((snap) => {
        if (!snap.exists()) { setLoadError(true); return }
        const data = snap.data()
        setName(data.name ?? '')
        setDate(data.date ?? '')
        setMemo(data.memo ?? '')
        setLoaded(true)
      })
      .catch(() => setLoadError(true))
  }, [id])

  async function handleSubmit() {
    if (!id || !name.trim() || submitting) return
    setSubmitting(true)
    setError('')
    try {
      await updateDoc(doc(db, 'meetings', id), {
        name: name.trim(),
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

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>방 정보 수정</Top.TitleParagraph>} />
      {loaded && (
        <div style={{ padding: '0 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TextField
            variant="box"
            labelOption="sustain"
            label="방 이름"
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
          <TextField
            variant="box"
            labelOption="sustain"
            label="한줄 메모"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      )}
      {error && (
        <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '0 20px 12px', margin: 0 }}>
          {error}
        </p>
      )}
      <FixedBottomCTA disabled={!name.trim() || submitting} onClick={handleSubmit}>
        {submitting ? '수정 중...' : '수정하기'}
      </FixedBottomCTA>
    </>
  )
}
