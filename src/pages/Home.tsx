import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Top } from '@toss/tds-mobile'
import { useUserStore } from '../store/userStore'
import { useMeetings } from '../hooks/useMeetings'
import type { MeetingListItem } from '../hooks/useMeetings'

const WEEK_DAYS = ['월', '화', '수', '목', '금', '토', '일']

function normalizeDate(dateStr: string): string {
  const parts = dateStr.trim().split(/[.\-\/]/)
  if (parts.length !== 3) return dateStr
  const [y, m, d] = parts
  return `${y}.${m.padStart(2, '0')}.${d.padStart(2, '0')}`
}

export default function Home() {
  const navigate = useNavigate()
  const { uid } = useUserStore()
  const { meetings, loading } = useMeetings(uid)

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const meetingsByDate: Record<string, MeetingListItem[]> = {}
  meetings.forEach((m) => {
    const key = normalizeDate(m.date)
    meetingsByDate[key] = [...(meetingsByDate[key] ?? []), m]
  })

  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`

  function prevMonth() {
    setSelectedDate(null)
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }

  function nextMonth() {
    setSelectedDate(null)
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }

  function handleDayClick(dateStr: string) {
    setSelectedDate((prev) => (prev === dateStr ? null : dateStr))
  }

  const cells: Array<{ day: number | null; dateStr: string | null }> = []
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push({ day: null, dateStr: null })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    cells.push({ day: d, dateStr: `${year}.${mm}.${dd}` })
  }

  const selectedMeetings = selectedDate ? (meetingsByDate[selectedDate] ?? []) : []

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>홈</Top.TitleParagraph>} />
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
      ) : (
        <div style={{ padding: '0 20px 100px' }}>
          {/* 월 네비게이션 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 24,
              padding: '16px 0 20px',
            }}
          >
            <button
              onClick={prevMonth}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 20,
                color: '#555',
                cursor: 'pointer',
                padding: '4px 8px',
                lineHeight: 1,
              }}
            >
              ‹
            </button>
            <p style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#191919' }}>
              {year}년 {month + 1}월
            </p>
            <button
              onClick={nextMonth}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 20,
                color: '#555',
                cursor: 'pointer',
                padding: '4px 8px',
                lineHeight: 1,
              }}
            >
              ›
            </button>
          </div>

          {/* 요일 헤더 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              marginBottom: 6,
            }}
          >
            {WEEK_DAYS.map((d) => (
              <div
                key={d}
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  color: '#bbb',
                  fontWeight: 600,
                  padding: '4px 0',
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 — 모든 셀 동일 크기 (aspectRatio 3/4) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 4,
            }}
          >
            {cells.map((cell, i) => {
              /* 월 시작 전 빈 슬롯 */
              if (cell.day === null) {
                return <div key={`empty-${i}`} style={{ aspectRatio: '3/4' }} />
              }

              const dateStr = cell.dateStr!
              const dayMeetings = meetingsByDate[dateStr] ?? []
              const isToday = dateStr === todayStr

              return (
                <div
                  key={dateStr}
                  onClick={() => handleDayClick(dateStr)}
                  style={{
                    aspectRatio: '3/4',
                    position: 'relative',
                    borderRadius: 8,
                    overflow: 'hidden',
                    cursor: 'pointer',
                  }}
                >
                  {dayMeetings.length === 0 ? (
                    /* 방 없음: 선택 시 배경 하이라이트 */
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: (selectedDate === dateStr || (selectedDate === null && isToday)) ? '#f0f4ff' : 'transparent',
                        borderRadius: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isToday ? 700 : 400,
                          color: isToday ? '#3182F6' : '#c0c0c0',
                        }}
                      >
                        {cell.day}
                      </span>
                    </div>
                  ) : (
                    /* 방 있음: 사진 or 플레이스홀더 카드 */
                    <>
                      {dayMeetings[0].photoUrl ? (
                        <img
                          src={dayMeetings[0].photoUrl}
                          alt=""
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: '#f0f4ff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path
                              d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"
                              stroke="#b0c4f8"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <circle cx="12" cy="13" r="3.5" stroke="#b0c4f8" strokeWidth="1.5" />
                          </svg>
                        </div>
                      )}
                      {/* 2개 이상: 숫자 배지 */}
                      {dayMeetings.length > 1 && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: 'rgba(0,0,0,0.55)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>
                            {dayMeetings.length}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* 선택된 날짜 패널 — 방 목록 + 새 방 만들기 버튼 */}
          {selectedDate && (
            <div
              style={{
                marginTop: 20,
                background: '#f8f9fa',
                borderRadius: 16,
                padding: '12px 16px',
              }}
            >
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 4px', fontWeight: 600 }}>
                {selectedDate}
              </p>
              {selectedMeetings.map((m, idx) => (
                <div
                  key={m.id}
                  onClick={() => navigate(`/meetings/${m.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    borderTop: idx === 0 ? 'none' : '1px solid #eee',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <p
                      style={{ fontSize: 15, fontWeight: 600, margin: '0 0 2px', color: '#191919' }}
                    >
                      {m.name}
                    </p>
                    <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
                      {m.memberCount}명 · {m.totalAmount.toLocaleString('ko-KR')}원
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 20,
                      background: m.status === 'active' ? '#3182F6' : '#e8e8e8',
                      color: m.status === 'active' ? '#fff' : '#888',
                      flexShrink: 0,
                    }}
                  >
                    {m.status === 'active' ? '진행중' : '완료'}
                  </span>
                </div>
              ))}
              {selectedMeetings.length > 0 && (
                <div style={{ borderTop: '1px solid #e8e8e8', margin: '4px 0 0' }} />
              )}
              <button
                onClick={() => navigate(`/meetings/new?date=${selectedDate}`)}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  marginTop: 4,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#3182F6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                + 새 방 만들기
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
