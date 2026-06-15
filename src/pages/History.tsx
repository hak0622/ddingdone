import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Top } from '@toss/tds-mobile'
import { useUserStore } from '../store/userStore'
import { useMeetings } from '../hooks/useMeetings'
import MeetingCard from '../components/MeetingCard'

type FilterStatus = 'all' | 'active' | 'settled'

function parseDate(d: string) {
  return Number(d.replace(/\./g, ''))
}

const FILTER_LABELS: Record<FilterStatus, string> = {
  all: '전체',
  active: '진행중',
  settled: '완료',
}

export default function History() {
  const navigate = useNavigate()
  const { uid } = useUserStore()
  const { meetings, loading } = useMeetings(uid)
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [sortNewest, setSortNewest] = useState(true)

  const filtered = meetings
    .filter((m) => filter === 'all' || m.status === filter)
    .sort((a, b) =>
      sortNewest
        ? parseDate(b.date) - parseDate(a.date)
        : parseDate(a.date) - parseDate(b.date)
    )

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>내역({meetings.length})</Top.TitleParagraph>} />

      {loading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px - 60px)',
          }}
        >
          <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>불러오는 중...</p>
        </div>
      ) : meetings.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px - 60px)',
            gap: 8,
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>아직 정산방이 없어요</p>
          <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>
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
              {(['all', 'active', 'settled'] as FilterStatus[]).map((f) => (
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
                    background: filter === f ? '#3182F6' : '#f5f5f5',
                    color: filter === f ? '#fff' : '#888',
                  }}
                >
                  {FILTER_LABELS[f]}
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
                color: '#888',
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
            <p style={{ fontSize: 14, color: '#bbb', textAlign: 'center', padding: '40px 0', margin: 0 }}>
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
