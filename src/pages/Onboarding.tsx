import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'
import { useUserStore } from '../store/userStore'

const NICKNAME_KEY = 'ddingdone_nickname'

export default function Onboarding() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { uid, setUser } = useUserStore()
  const [nickname, setNickname] = useState('')

  function handleStart() {
    if (nickname.trim().length === 0) return
    const trimmed = nickname.trim()
    localStorage.setItem(NICKNAME_KEY, trimmed)
    setUser(uid, trimmed)
    // 앱인토스 "앱 내 기능" 딥링크 등으로 닉네임 없이 들어왔다가 온보딩으로
    // 빠진 경우, 완료 후 원래 가려던 화면으로 이어서 보낸다.
    const next = searchParams.get('next')
    navigate(next && next.startsWith('/') ? next : '/', { replace: true })
  }

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>닉네임 설정</Top.TitleParagraph>} />
      <div style={{ padding: '32px 20px 0' }}>
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>
          반가워요! 어떻게 불러드릴까요?
        </p>
        <TextField
          variant="big"
          label="닉네임"
          placeholder="예: 민수"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={10}
        />
      </div>
      <FixedBottomCTA
        disabled={nickname.trim().length === 0}
        onClick={handleStart}
      >
        시작하기
      </FixedBottomCTA>
    </>
  )
}
