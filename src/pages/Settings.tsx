import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TextField, Top } from '@toss/tds-mobile'
import { COLORS } from '../styles/tokens'
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'

const NICKNAME_KEY = 'ddingdone_nickname'

function Row({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      onClick={onPress}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 0',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 15, color: '#191919' }}>{label}</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M9 5l7 7-7 7" stroke="#c0c0c0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

function Divider() {
  return <div style={{ height: 1, background: '#f0f0f0' }} />
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 600, color: '#888', margin: '24px 0 8px' }}>{label}</p>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { uid, nickname, setUser } = useUserStore()
  const [value, setValue] = useState(nickname)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [syncError, setSyncError] = useState(false)

  async function handleSave() {
    const trimmed = value.trim()
    if (!trimmed || !uid) return
    // 닉네임이 실제로 바뀌지 않았으면 내가 속한 모든 모임을 다시 읽고
    // 멤버 문서를 전부 다시 쓰는 동기화 자체를 할 필요가 없다 — 그대로
    // 저장 버튼을 누르기만 해도 매번 불필요한 읽기/쓰기가 나가고 있었다.
    if (trimmed === nickname) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      return
    }
    setSaving(true)
    try {
      localStorage.setItem(NICKNAME_KEY, trimmed)
      setUser(uid, trimmed)

      const q = query(collection(db, 'meetings'), where('memberUids', 'array-contains', uid))
      const meetingsSnap = await getDocs(q)
      const batch = writeBatch(db)
      meetingsSnap.docs.forEach((meetingDoc) => {
        batch.update(doc(db, 'meetings', meetingDoc.id, 'members', uid), { nickname: trimmed })
      })
      await batch.commit()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setSyncError(true)
      setTimeout(() => setSyncError(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const canSave = value.trim().length > 0 && !saving

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>설정</Top.TitleParagraph>} />
      <div style={{ padding: '24px 20px 100px' }}>

        {/* 내 정보 */}
        <SectionLabel label="내 정보" />
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '0 16px' }}>
          <div style={{ padding: '16px 0' }}>
            <TextField
              variant="box"
              labelOption="sustain"
              label="닉네임"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setSaved(false)
              }}
              maxLength={20}
            />
            <button
              onClick={handleSave}
              disabled={!canSave}
              style={{
                width: '100%',
                marginTop: 12,
                padding: '14px 0',
                fontSize: 15,
                fontWeight: 700,
                border: 'none',
                borderRadius: 10,
                background: saved ? COLORS.success : canSave ? COLORS.primary : COLORS.disabled,
                color: canSave ? COLORS.background : COLORS.disabledText,
                cursor: canSave ? 'pointer' : 'default',
                transition: 'background 0.2s',
              }}
            >
              {saving ? '저장 중...' : saved ? '저장됐어요!' : '저장하기'}
            </button>
            {syncError && (
              <p style={{ fontSize: 13, color: '#ef4444', margin: '8px 0 0', textAlign: 'center' }}>
                동기화에 실패했어요. 로컬에는 저장됐어요.
              </p>
            )}
          </div>
        </div>

        {/* 정보 */}
        <SectionLabel label="정보" />
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '0 16px' }}>
          <Row label="이용약관" onPress={() => navigate('/terms')} />
          <Divider />
          <Row label="개인정보처리방침" onPress={() => navigate('/privacy')} />
        </div>

      </div>
    </>
  )
}
