import { useLocation, useNavigate } from 'react-router-dom'

function HomeIcon({ active }: { active: boolean }) {
  const color = active ? '#3182F6' : '#aaaaaa'
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-5a1 1 0 00-1-1h-4a1 1 0 00-1 1v5H4a1 1 0 01-1-1V10.5z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HistoryIcon({ active }: { active: boolean }) {
  const color = active ? '#3182F6' : '#aaaaaa'
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="2" width="16" height="20" rx="2.5" stroke={color} strokeWidth="1.8" />
      <path d="M8 7h8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 11h8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 15h5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function SettingsIcon({ active }: { active: boolean }) {
  const color = active ? '#3182F6' : '#aaaaaa'
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke={color} strokeWidth="1.8" />
      <path
        d="M4 20c0-4 3.582-7 8-7s8 3 8 7"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

const TABS = [
  { path: '/', label: '홈', Icon: HomeIcon },
  { path: '/history', label: '내역', Icon: HistoryIcon },
  { path: '/settings', label: '설정', Icon: SettingsIcon },
]

const MAIN_PATHS = new Set(['/', '/history', '/settings'])

export default function BottomTabBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  if (!MAIN_PATHS.has(pathname)) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        left: 16,
        right: 16,
        height: 60,
        background: '#fff',
        borderRadius: 20,
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        display: 'flex',
        zIndex: 100,
      }}
    >
      {TABS.map(({ path, label, Icon }) => {
        const active = pathname === path
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <Icon active={active} />
            <span
              style={{
                fontSize: 10,
                color: active ? '#3182F6' : '#aaaaaa',
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
