import { useState } from 'react'
import { BottomSheet, TextField } from '@toss/tds-mobile'

interface DatePickerProps {
  value: string // YYYY.MM.DD
  onChange: (date: string) => void
  label?: string
}

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

export default function DatePicker({ value, onChange, label = '날짜' }: DatePickerProps) {
  const today = new Date()
  const todayYear = today.getFullYear()
  const todayMonth = today.getMonth()
  const todayDay = today.getDate()

  const parseValue = () => {
    if (value && /^\d{4}\.\d{2}\.\d{2}$/.test(value)) {
      const [y, m, d] = value.split('.').map(Number)
      return { year: y, month: m - 1, day: d }
    }
    return { year: todayYear, month: todayMonth, day: null }
  }

  const [open, setOpen] = useState(false)
  const [calYear, setCalYear] = useState(todayYear)
  const [calMonth, setCalMonth] = useState(todayMonth)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  function handleOpen() {
    const parsed = parseValue()
    setCalYear(parsed.year)
    setCalMonth(parsed.month)
    setSelectedDay(parsed.day)
    setOpen(true)
  }

  function prevMonth() {
    setSelectedDay(null)
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11) }
    else setCalMonth((m) => m - 1)
  }

  function nextMonth() {
    setSelectedDay(null)
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0) }
    else setCalMonth((m) => m + 1)
  }

  function handleConfirm() {
    if (!selectedDay) return
    const mm = String(calMonth + 1).padStart(2, '0')
    const dd = String(selectedDay).padStart(2, '0')
    onChange(`${calYear}.${mm}.${dd}`)
    setOpen(false)
  }

  const firstDayOfWeek = new Date(calYear, calMonth, 1).getDay()
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()

  return (
    <>
      <div onClick={handleOpen} style={{ cursor: 'pointer' }}>
        <TextField
          variant="box"
          labelOption="sustain"
          label={label}
          value={value}
          placeholder="날짜를 선택해주세요"
          readOnly
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        />
      </div>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        header={<BottomSheet.Header>날짜 선택</BottomSheet.Header>}
        cta={
          <BottomSheet.CTA
            color="primary"
            variant="fill"
            disabled={!selectedDay}
            onClick={handleConfirm}
          >
            선택하기
          </BottomSheet.CTA>
        }
      >
        <div style={{ paddingBottom: 8 }}>
          {/* 월 네비게이션 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
            }}
          >
            <button
              onClick={prevMonth}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                flexShrink: 0,
              }}
            >
              <svg width="9" height="16" viewBox="0 0 9 16" fill="none">
                <path d="M8 1L1 8L8 15" stroke="#3182F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <span style={{ fontSize: 17, fontWeight: 700, color: '#191919' }}>
              {calYear}년 {calMonth + 1}월
            </span>

            <button
              onClick={nextMonth}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                flexShrink: 0,
              }}
            >
              <svg width="9" height="16" viewBox="0 0 9 16" fill="none">
                <path d="M1 1L8 8L1 15" stroke="#3182F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* 요일 헤더 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              marginBottom: 8,
            }}
          >
            {WEEK_DAYS.map((d) => (
              <div
                key={d}
                style={{
                  textAlign: 'center',
                  fontSize: 13,
                  color: '#c0c0c0',
                  fontWeight: 600,
                  padding: '4px 0',
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              rowGap: 4,
            }}
          >
            {Array.from({ length: firstDayOfWeek }, (_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const isSelected = selectedDay === day
              const isToday =
                calYear === todayYear && calMonth === todayMonth && day === todayDay
              return (
                <div
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  style={{
                    height: 44,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      background: isSelected ? '#3182F6' : 'transparent',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: isSelected || isToday ? 700 : 400,
                        color: isSelected ? '#fff' : isToday ? '#3182F6' : '#191919',
                      }}
                    >
                      {day}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </BottomSheet>
    </>
  )
}
