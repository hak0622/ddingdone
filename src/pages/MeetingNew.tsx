import { useState } from 'react'
import { FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'

function getTodayString(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}.${mm}.${dd}`
}

export default function MeetingNew() {
  const [name, setName] = useState('')
  const [date, setDate] = useState(getTodayString())
  const [members, setMembers] = useState('')
  const [memo, setMemo] = useState('')

  function handleSubmit() {
    if (name.trim().length === 0) return
    console.log({ name: name.trim(), date, members, memo })
  }

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={22}>새 정산방</Top.TitleParagraph>}
      />
      <div style={{ padding: '0 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TextField
          variant="box"
          label="방 이름"
          placeholder="예: 제주도 여행"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          variant="box"
          label="날짜"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <TextField
          variant="box"
          label="참여자"
          placeholder="예: 민수, 지현, 나"
          value={members}
          onChange={(e) => setMembers(e.target.value)}
        />
        <TextField
          variant="box"
          label="한줄 메모"
          placeholder="예: 제주 2박 3일"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </div>
      <FixedBottomCTA.Single
        disabled={name.trim().length === 0}
        onClick={handleSubmit}
      >
        정산방 만들기
      </FixedBottomCTA.Single>
    </>
  )
}
