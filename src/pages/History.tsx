import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Asset, Top } from '@toss/tds-mobile'
import { useUserStore } from '../store/userStore'
import { useMeetings } from '../hooks/useMeetings'
import MeetingCard from '../components/MeetingCard'
import { COLORS } from '../styles/tokens'

type FilterStatus = 'all' | 'active' | 'settled'

function parseDate(d: string) {
  return Number(d.replace(/\./g, ''))
}

export default function History() {
  const navigate = useNavigate()
  const { uid } = useUserStore()
  const { meetings, loading } = useMeetings(uid)
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [sortNewest, setSortNewest] = useState(true)

  const activeCount = meetings.filter((m) => m.status === 'active').length
  const settledCount = meetings.filter((m) => m.status === 'settled').length

  const filtered = useMemo(() =>
    meetings
      .filter((m) => filter === 'all' || m.status === filter)
      .sort((a, b) =>
        sortNewest
          ? parseDate(b.date) - parseDate(a.date)
          : parseDate(a.date) - parseDate(b.date)
      ),
    [meetings, filter, sortNewest]
  )

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>내역</Top.TitleParagraph>} />

      {loading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px - 60px)',
          }}
        >
          <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>불러오는 중...</p>
        </div>
      ) : meetings.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px - 60px)',
            gap: 0,
          }}
        >
          <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 }}>
            <Asset.Icon
              frameShape={Asset.frameShape.CleanW100}
              backgroundColor="transparent"
              name="icon-calendar-clock"
              aria-hidden={true}
              ratio="1/1"
            />
          </div>
          <p style={{ fontSize: 22, fontWeight: 700, margin: '0 0 12px', color: '#191919' }}>아직 정산방이 없어요</p>
          <p style={{ fontSize: 15, color: '#8b8b8b', margin: 0 }}>
            홈 탭에서 첫 정산방을 만들어보세요
          </p>
        </div>
      ) : (
        <div style={{ padding: '0 20px 80px' }}>
          {/* 필터 + 정렬 바 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0 16px',
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                ['all', `전체(${meetings.length})`],
                ['active', `진행중(${activeCount})`],
                ['settled', `완료(${settledCount})`],
              ] as [FilterStatus, string][]).map(([f, label]) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 20,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    background: filter === f ? COLORS.primary : COLORS.backgroundGray,
                    color: filter === f ? COLORS.background : COLORS.textSecondary,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSortNewest((prev) => !prev)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textSecondary,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: 0,
              }}
            >
              {sortNewest ? '최신순' : '오래된순'}
              <span style={{ fontSize: 10 }}>{sortNewest ? '↓' : '↑'}</span>
            </button>
          </div>

          {/* 리스트 */}
          {filtered.length === 0 ? (
            <p style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', padding: '40px 0', margin: 0 }}>
              해당하는 정산방이 없어요
            </p>
          ) : (
            filtered.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                onClick={() => navigate(`/meetings/${m.id}`)}
              />
            ))
          )}
        </div>
      )}
    </>
  )
}
