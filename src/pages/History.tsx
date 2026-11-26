import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Top } from '@toss/tds-mobile'
import { useUserStore } from '../store/userStore'
import { useMeetingListView, useMeetings, type HistoryPage, type MeetingStatusFilter } from '../hooks/useMeetings'
import MeetingCard from '../components/MeetingCard'
import { COLORS } from '../styles/tokens'

const firstPage = {
  filter: 'all' as MeetingStatusFilter,
  newest: true,
  page: null as HistoryPage | null,
}

export default function History() {
  const navigate = useNavigate()
  const { uid } = useUserStore()
  const [view, setView] = useMeetingListView(uid, 'history', firstPage)
  const { filter, newest: sortNewest, page } = view
  const { meetings, loading, error, retry, hasPrevious, hasNext } = useMeetings(uid, { kind: 'history', ...view })

  useEffect(() => {
    if (page && !loading && !error && meetings.length === 0) setView({ ...view, page: null })
  }, [page, loading, error, meetings.length, view, setView])

  function movePage(direction: HistoryPage['direction']) {
    const boundary = direction === 'after' ? meetings[meetings.length - 1] : meetings[0]
    if (boundary) setView({ ...view, page: { direction, cursor: [boundary.date, boundary.id] } })
  }

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>내역</Top.TitleParagraph>} />

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
              ['all', '전체'],
              ['active', '진행중'],
              ['settled', '완료'],
            ] as [MeetingStatusFilter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setView({ ...view, filter: f, page: null })}
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
            onClick={() => setView({ ...view, newest: !sortNewest, page: null })}
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
        {loading ? <p role="status">불러오는 중이에요.</p>
          : error ? <p role="alert">내역을 불러오지 못했어요. <button onClick={retry}>다시 시도</button></p>
          : meetings.length === 0 ? (
          <p style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', padding: '40px 0', margin: 0 }}>
            해당하는 정산방이 없어요
          </p>
        ) : (
          meetings.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              onClick={() => navigate(`/meetings/${m.id}`)}
            />
          ))
        )}
        {!loading && !error && (hasPrevious || hasNext) && (
          <nav aria-label="내역 페이지" style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
            <button disabled={!hasPrevious} onClick={() => movePage('before')}>이전</button>
            <button disabled={!hasNext} onClick={() => movePage('after')}>다음</button>
          </nav>
        )}
      </div>
    </>
  )
}
