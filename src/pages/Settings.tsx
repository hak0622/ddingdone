import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TextField, Top } from '@toss/tds-mobile'
import { COLORS } from '../styles/tokens'
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
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)

  function handleSave() {
    const trimmed = value.trim()
    if (!trimmed || !uid) return
    try {
      localStorage.setItem(NICKNAME_KEY, trimmed)
      setUser(uid, trimmed)
      setSaveError(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setSaved(false)
      setSaveError(true)
    }
  }

  const canSave = value.trim().length > 0 && !!uid

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
              maxLength={10}
            />
            <button
              onClick={handleSave}
              disabled={!canSave}
              style={{
                width: 'calc(100% - 40px)',
                margin: '12px 20px 0',
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
              {saved ? '저장됐어요!' : '저장하기'}
            </button>
            <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: "12px 20px" }}>
              변경한 닉네임은 앞으로 만들거나 참여하는 모임에 적용돼요.
            </p>
            {saveError && (
              <p style={{ fontSize: 13, color: '#ef4444', margin: '8px 0 0', textAlign: 'center' }}>
                닉네임을 저장하지 못했어요. 다시 시도해 주세요.
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

        {/* 계정 */}
        <SectionLabel label="계정" />
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f0f0f0', padding: '0 16px' }}>
          <Row label="회원 탈퇴" onPress={() => navigate('/settings/withdrawal')} />
        </div>

      </div>
    </>
  )
}
