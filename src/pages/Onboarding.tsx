import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'

const NICKNAME_KEY = 'ddingdone_nickname'

export default function Onboarding() {
  const navigate = useNavigate()
  const { uid, tossKey, setUser } = useUserStore()
  const [nickname, setNickname] = useState('')

  function handleStart() {
    if (nickname.trim().length === 0) return
    const trimmed = nickname.trim()
    localStorage.setItem(NICKNAME_KEY, trimmed)
    setUser(uid, trimmed, tossKey)
    if (tossKey) {
      setDoc(doc(db, 'users', uid), { nickname: trimmed }, { merge: true }).catch(() => {})
    }
    navigate('/', { replace: true })
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
          maxLength={20}
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
