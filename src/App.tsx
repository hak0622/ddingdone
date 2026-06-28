import { useState, useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'

import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore'
import { db, signInAnonymously } from './lib/firebase'
import { useUserStore } from './store/userStore'
import BottomTabBar from './components/BottomTabBar'
import Onboarding from './pages/Onboarding'
import Home from './pages/Home'
import History from './pages/History'
import Settings from './pages/Settings'
import MeetingNew from './pages/MeetingNew'
import MeetingDetail from './pages/MeetingDetail'
import ExpenseInput from './pages/ExpenseInput'
import Settle from './pages/Settle'
import MeetingEdit from './pages/MeetingEdit'
import TermsOfService from './pages/TermsOfService'
import PrivacyPolicy from './pages/PrivacyPolicy'

const NICKNAME_KEY = 'ddingdone_nickname'

function AppInit() {
  const [ready, setReady] = useState(false)
  const [initError, setInitError] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const setUser = useUserStore((s) => s.setUser)

  useEffect(() => {
    async function init() {
      try {
        const uid = await signInAnonymously()

        if (!uid) {
          setInitError(true)
          setReady(true)
          return
        }

        let nickname = localStorage.getItem(NICKNAME_KEY) ?? ''

        if (!nickname) {
          // Fallback: localStorage가 비어있어도 내가 속한 모임의 멤버 문서에서 닉네임 복구
          try {
            const q = query(collection(db, 'meetings'), where('memberUids', 'array-contains', uid), limit(1))
            const snap = await getDocs(q)
            if (!snap.empty) {
              const memberDoc = await getDoc(doc(db, 'meetings', snap.docs[0].id, 'members', uid))
              const fetched = memberDoc.exists() ? (memberDoc.data().nickname as string) : ''
              if (fetched) {
                nickname = fetched
                localStorage.setItem(NICKNAME_KEY, fetched)
              }
            }
          } catch { /* 조회 실패 시 onboarding으로 진행 */ }
        }

        setUser(uid, nickname)
        setReady(true)

        const meetingId = searchParams.get('meeting')
        if (meetingId) {
          navigate(`/meetings/${meetingId}`, { replace: true })
          return
        }

        // /meetings/:id(실제 모임)로 직접 들어온 경우(초대 링크 query param 없이
        // URL을 바로 입력하는 경우, 앱인토스 "앱 내 기능" 딥링크 등)는 온보딩으로
        // 보내지 않는다 — 그 모임의 "참여하시겠어요?" 화면에서 자연스럽게 닉네임을
        // 받을 수 있으므로, 닉네임이 없다는 이유로 원래 가려던 모임을 잃어버리고
        // 홈으로 빠지게 할 필요가 없다.
        // /meetings/new는 이 예외에서 제외한다 — 닉네임을 받는 화면이 아니라서,
        // 닉네임 없이 그대로 들어오면 빈 이름으로 모임이 만들어진다.
        const meetingIdMatch = location.pathname.match(/^\/meetings\/([^/]+)$/)
        const isExistingMeetingLink = !!meetingIdMatch && meetingIdMatch[1] !== 'new'
        if (!nickname && !isExistingMeetingLink) {
          // 온보딩을 거친 뒤 원래 가려던 화면(예: 앱인토스 "앱 내 기능" 딥링크로
          // 들어온 /meetings/new)으로 이어서 보내기 위해 목적지를 같이 넘긴다.
          const next = encodeURIComponent(location.pathname + location.search)
          navigate(`/onboarding?next=${next}`, { replace: true })
        }
      } catch {
        setInitError(true)
        setReady(true)
      }
    }

    init()
  }, [])

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>불러오는 중...</p>
      </div>
    )
  }

  if (initError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12 }}>
        <p style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#191919' }}>앱을 시작할 수 없어요</p>
        <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>잠시 후 다시 시도해주세요</p>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: 8, padding: '12px 28px', fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 10, background: '#3182F6', color: '#fff', cursor: 'pointer' }}
        >
          다시 시도
        </button>
      </div>
    )
  }

  return (
    <>
      <Outlet />
      <BottomTabBar />
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<AppInit />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<Home />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/meetings/new" element={<MeetingNew />} />
            <Route path="/meetings/:id" element={<MeetingDetail />} />
            <Route path="/meetings/:id/edit" element={<MeetingEdit />} />
            <Route path="/meetings/:id/expense" element={<ExpenseInput />} />
            <Route path="/meetings/:id/settle" element={<Settle />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
