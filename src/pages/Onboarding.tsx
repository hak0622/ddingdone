import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'
import { useUserStore } from '../store/userStore'
import { signInAnonymously } from '../lib/firebase'
import { finishDeferredAnonymousSignIn } from '../lib/accountCleanup'

const NICKNAME_KEY = 'ddingdone_nickname'

export default function Onboarding() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { uid, setUser } = useUserStore()
  const [nickname, setNickname] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(false)

  async function handleStart() {
    if (nickname.trim().length === 0 || starting) return
    setStarting(true)
    setError(false)
    const trimmed = nickname.trim()
    try {
      // 탈퇴 후 첫 실행에서는 AppInit이 새 익명 계정을 자동으로 만들지 않는다.
      // 사용자가 다시 시작하기를 선택한 이 시점에만 새 계정을 생성한다.
      const nextUid = uid || await signInAnonymously()
      localStorage.setItem(NICKNAME_KEY, trimmed)
      finishDeferredAnonymousSignIn()
      setUser(nextUid, trimmed)
      // 앱인토스 "앱 내 기능" 딥링크 등으로 닉네임 없이 들어왔다가 온보딩으로
      // 빠진 경우, 완료 후 원래 가려던 화면으로 이어서 보낸다.
      const next = searchParams.get('next')
      navigate(next && next.startsWith('/') ? next : '/', { replace: true })
    } catch {
      setError(true)
      setStarting(false)
    }
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
      {error && (
        <p role="alert" style={{ padding: '0 20px', color: '#ef4444', fontSize: 13 }}>
          시작할 수 없어요. 네트워크 상태를 확인하고 다시 시도해주세요.
        </p>
      )}
      <FixedBottomCTA
        disabled={nickname.trim().length === 0 || starting}
        onClick={handleStart}
      >
        {starting ? '시작 중...' : '시작하기'}
      </FixedBottomCTA>
    </>
  )
}
