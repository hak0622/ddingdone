import { useState, useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'

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
  const [ready, setReady] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setUser = useUserStore((s) => s.setUser)

  useEffect(() => {
    async function init() {
      let uid = localStorage.getItem(UID_KEY) ?? ''
      if (!uid) {
        const tossUid = await getAnonymousUid()
        uid = tossUid ?? (await signInAnonymously())
        localStorage.setItem(UID_KEY, uid)
      }

      const nickname = localStorage.getItem(NICKNAME_KEY) ?? ''
      setUser(uid, nickname)
      setReady(true)

      const meetingId = searchParams.get('meeting')
      if (meetingId) {
        navigate(`/meetings/${meetingId}`, { replace: true })
        return
      }

      if (!nickname) {
        navigate('/onboarding', { replace: true })
      }
    }

    init()
  }, [])

  if (!ready) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>불러오는 중...</p>
      </div>
    )
  }

  return <Outlet />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppInit />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/" element={<Home />} />
          <Route path="/meetings/new" element={<MeetingNew />} />
          <Route path="/meetings/:id" element={<MeetingDetail />} />
          <Route path="/meetings/:id/expense" element={<ExpenseInput />} />
          <Route path="/meetings/:id/settle" element={<Settle />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
