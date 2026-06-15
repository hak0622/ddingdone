import { useState } from 'react'
import { TextField, Top } from '@toss/tds-mobile'
import { collection, doc, getDocs, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useUserStore } from '../store/userStore'

const NICKNAME_KEY = 'ddingdone_nickname'

export default function Settings() {
  const { uid, nickname, setUser } = useUserStore()
  const [value, setValue] = useState(nickname)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    const trimmed = value.trim()
    if (!trimmed || !uid) return
    setSaving(true)
    try {
      localStorage.setItem(NICKNAME_KEY, trimmed)
      setUser(uid, trimmed)

      const meetingsSnap = await getDocs(collection(db, 'meetings'))
      await Promise.all(
        meetingsSnap.docs.map(async (meetingDoc) => {
          const memberRef = doc(db, 'meetings', meetingDoc.id, 'members', uid)
          const memberSnap = await getDoc(memberRef)
          if (memberSnap.exists()) {
            await updateDoc(memberRef, { nickname: trimmed })
          }
        })
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('닉네임 동기화 실패', err)
    } finally {
      setSaving(false)
    }
  }

  const canSave = value.trim().length > 0 && value.trim() !== nickname && !saving

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>설정</Top.TitleParagraph>} />
      <div style={{ padding: '24px 20px 0', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <TextField
          variant="box"
          labelOption="sustain"
          label="닉네임"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setSaved(false)
          }}
        />
        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            width: '100%',
            padding: '16px 0',
            fontSize: 16,
            fontWeight: 700,
            border: 'none',
            borderRadius: 12,
            background: saved ? '#22c55e' : canSave ? '#3182F6' : '#e8e8e8',
            color: canSave ? '#fff' : '#999',
            cursor: canSave ? 'pointer' : 'default',
            transition: 'background 0.2s',
          }}
        >
          {saving ? '저장 중...' : saved ? '저장됐어요!' : '저장하기'}
        </button>
      </div>
    </>
  )
}
