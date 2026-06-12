import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'

import { signInAnonymously } from './lib/firebase'
import { getAnonymousUid } from './lib/bridge'
import { useUserStore } from './store/userStore'
import Onboarding from './pages/Onboarding'
import Home from './pages/Home'
import MeetingNew from './pages/MeetingNew'
import MeetingDetail from './pages/MeetingDetail'
import ExpenseInput from './pages/ExpenseInput'
import Settle from './pages/Settle'

const NICKNAME_KEY = 'ddingdone_nickname'
const UID_KEY = 'ddingdone_uid'

function AppInit() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setUser = useUserStore((s) => s.setUser)

  useEffect(() => {
    async function init() {
      // 1. UID 획득 (토스 앱: getAnonymousKey, 브라우저: Firebase 익명 인증)
      let uid = localStorage.getItem(UID_KEY) ?? ''
      if (!uid) {
        const tossUid = await getAnonymousUid()
        uid = tossUid ?? await signInAnonymously()
        localStorage.setItem(UID_KEY, uid)
      }

      const nickname = localStorage.getItem(NICKNAME_KEY) ?? ''
      setUser(uid, nickname)

      // 2. 초대 딥링크 파라미터 처리
      const meetingId = searchParams.get('meeting')
      if (meetingId) {
        navigate(`/meetings/${meetingId}`, { replace: true })
        return
      }

      // 3. 닉네임 없으면 온보딩
      if (!nickname) {
        navigate('/onboarding', { replace: true })
        return
      }

      navigate('/', { replace: true })
    }

    init()
  }, [])

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/_init" element={<AppInit />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={<Home />} />
        <Route path="/meetings/new" element={<MeetingNew />} />
        <Route path="/meetings/:id" element={<MeetingDetail />} />
        <Route path="/meetings/:id/expense" element={<ExpenseInput />} />
        <Route path="/meetings/:id/settle" element={<Settle />} />
        <Route path="*" element={<Navigate to="/_init" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
