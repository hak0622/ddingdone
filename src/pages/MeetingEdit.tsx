import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Asset, ConfirmDialog, FixedBottomCTA, TextField, Top } from '@toss/tds-mobile'
import { doc, updateDoc, getDoc } from 'firebase/firestore'
import DatePicker from '../components/DatePicker'
import { db } from '../lib/firebase'
import { addPreMember, deletePreMember } from '../lib/meetingMembers'
import { useMeetingMembers } from '../hooks/useMeeting'
import { useUserStore } from '../store/userStore'
import { truncateName } from '../utils/format'

const MEMBER_CHIP_LIMIT = 3

export default function MeetingEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { uid } = useUserStore()
  const { members } = useMeetingMembers(id)

  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [isSettled, setIsSettled] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [notMember, setNotMember] = useState(false)

  const [memberInput, setMemberInput] = useState('')
  const [memberError, setMemberError] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [memberActionError, setMemberActionError] = useState('')
  const [membersExpanded, setMembersExpanded] = useState(false)

  useEffect(() => {
    if (!id) return
    getDoc(doc(db, 'meetings', id))
      .then((snap) => {
        if (!snap.exists()) { setLoadError(true); return }
        const data = snap.data()
        const memberUids: string[] = data.memberUids ?? []
        if (!memberUids.includes(uid)) { setNotMember(true); return }
        setName(data.name ?? '')
        setDate(data.date ?? '')
        setMemo(data.memo ?? '')
        setCreatedBy(data.createdBy ?? '')
        setIsSettled(data.status === 'settled')
        setLoaded(true)
      })
      .catch(() => setLoadError(true))
  }, [id, uid])

  const canManageMembers = !isSettled && uid === createdBy

  function showMemberActionError(msg: string) {
    setMemberActionError(msg)
    setTimeout(() => setMemberActionError(''), 3000)
  }

  async function handleAddMember() {
    const trimmed = memberInput.trim()
    if (trimmed.length === 0) {
      setMemberInput('')
      return
    }
    if (!id || addingMember) return
    if (Object.values(members).includes(trimmed)) {
      setMemberError(true)
      return
    }
    setAddingMember(true)
    try {
      await addPreMember(id, trimmed)
      setMemberInput('')
      setMemberError(false)
    } catch {
      showMemberActionError('참여자를 추가하지 못했어요. 다시 시도해주세요.')
    } finally {
      setAddingMember(false)
    }
  }

  async function handleConfirmDeleteMember() {
    if (!id || !deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await deletePreMember(id, target)
    } catch {
      showMemberActionError('참여자를 삭제하지 못했어요. 다시 시도해주세요.')
    }
  }

  async function handleSubmit() {
    if (!id || !name.trim() || submitting) return
    setSubmitting(true)
    setError('')
    try {
      await updateDoc(doc(db, 'meetings', id), {
        name: name.trim(),
        date,
        memo,
      })
      navigate(-1)
    } catch {
      setError('수정하지 못했어요. 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  if (notMember) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>방 정보 수정</Top.TitleParagraph>} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 56px)', gap: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>수정 권한이 없어요</p>
          <button onClick={() => navigate(-1)} style={{ padding: '10px 20px', fontSize: 14, border: '1px solid #d8d8d8', borderRadius: 8, background: '#fff', cursor: 'pointer' }}>
            돌아가기
          </button>
        </div>
      </>
    )
  }

  if (loadError) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>방 정보 수정</Top.TitleParagraph>} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px)',
            gap: 16,
          }}
        >
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>방 정보를 불러오지 못했어요</p>
          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              border: '1px solid #d8d8d8',
              borderRadius: 8,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            돌아가기
          </button>
        </div>
      </>
    )
  }

  const isDateValid = /^\d{4}\.\d{2}\.\d{2}$/.test(date)
  // Firestore 구독 결과의 순서는 보장되지 않아 새 멤버가 들어올 때마다 순서가
  // 흔들릴 수 있다. "나"는 항상 맨 앞에 고정한다.
  const memberEntries = Object.entries(members).sort(([a], [b]) => {
    if (a === uid) return -1
    if (b === uid) return 1
    return 0
  })
  const visibleMemberEntries = membersExpanded ? memberEntries : memberEntries.slice(0, MEMBER_CHIP_LIMIT)
  const hiddenMemberCount = memberEntries.length - MEMBER_CHIP_LIMIT

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>방 정보 수정</Top.TitleParagraph>} />
      {!loaded ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 56px - 60px)' }}>
          <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>불러오는 중...</p>
        </div>
      ) : (
        <div style={{ padding: '0 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TextField
            variant="box"
            labelOption="sustain"
            label="방 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
          />
          <DatePicker value={date} onChange={setDate} />
          <TextField
            variant="box"
            labelOption="sustain"
            label="참여자"
            placeholder={canManageMembers ? '이름 입력 후 추가' : '방장만 추가/삭제할 수 있어요'}
            value={memberInput}
            onChange={(e) => {
              setMemberInput(e.target.value)
              setMemberError(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAddMember()
              }
            }}
            disabled={!canManageMembers}
            help={
              <>
                {memberError ? (
                  <span style={{ color: '#ef4444' }}>이미 추가된 참여자예요</span>
                ) : !canManageMembers ? (
                  '방장만 참여자를 추가하거나 삭제할 수 있어요'
                ) : (
                  '아직 들어오지 않은 참여자만 삭제할 수 있어요'
                )}
                {memberEntries.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {visibleMemberEntries.map(([memberUid, nickname]) => {
                      const isPreMember = memberUid.startsWith('pre_')
                      const canRemove = canManageMembers && isPreMember
                      return (
                        <span
                          key={memberUid}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: canRemove ? '4px 6px 4px 10px' : '4px 10px',
                            fontSize: 13,
                            border: '1px solid #e8e8e8',
                            borderRadius: 20,
                            background: '#f5f5f5',
                            color: '#333',
                          }}
                        >
                          {memberUid === uid ? `${truncateName(nickname)}(나)` : truncateName(nickname)}
                          {canRemove && (
                            <button
                              onClick={() => setDeleteTarget(memberUid)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                border: 'none',
                                background: '#ccc',
                                color: '#fff',
                                fontSize: 10,
                                fontWeight: 700,
                                cursor: 'pointer',
                                lineHeight: 1,
                                padding: 0,
                                flexShrink: 0,
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      )
                    })}
                    {!membersExpanded && hiddenMemberCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setMembersExpanded(true)}
                        style={{
                          padding: '4px 10px',
                          fontSize: 13,
                          fontWeight: 600,
                          border: '1px solid #e8e8e8',
                          borderRadius: 20,
                          background: '#fff',
                          color: '#3182F6',
                          cursor: 'pointer',
                        }}
                      >
                        +{hiddenMemberCount}명
                      </button>
                    )}
                    {membersExpanded && memberEntries.length > MEMBER_CHIP_LIMIT && (
                      <button
                        type="button"
                        onClick={() => setMembersExpanded(false)}
                        style={{
                          padding: '4px 10px',
                          fontSize: 13,
                          fontWeight: 600,
                          border: '1px solid #e8e8e8',
                          borderRadius: 20,
                          background: '#fff',
                          color: '#888',
                          cursor: 'pointer',
                        }}
                      >
                        접기
                      </button>
                    )}
                  </div>
                )}
              </>
            }
            right={
              canManageMembers ? (
                <button
                  type="button"
                  onClick={handleAddMember}
                  disabled={memberInput.trim().length === 0 || addingMember}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'none',
                    border: 'none',
                    padding: 4,
                    cursor: memberInput.trim().length === 0 ? 'default' : 'pointer',
                    opacity: memberInput.trim().length === 0 ? 0.4 : 1,
                  }}
                >
                  <Asset.Icon
                    frameShape={Asset.frameShape.CleanW24}
                    backgroundColor="transparent"
                    name="icon-plus-circle-blue"
                    aria-hidden={true}
                    ratio="1/1"
                  />
                </button>
              ) : undefined
            }
          />
          {memberActionError && (
            <p style={{ fontSize: 13, color: '#ef4444', margin: 0 }}>{memberActionError}</p>
          )}
          <TextField
            variant="box"
            labelOption="sustain"
            label="한줄 메모"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={50}
          />
        </div>
      )}
      {error && (
        <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '0 20px 12px', margin: 0 }}>
          {error}
        </p>
      )}
      <FixedBottomCTA disabled={!name.trim() || !isDateValid || submitting} onClick={handleSubmit}>
        {submitting ? '수정 중...' : '수정하기'}
      </FixedBottomCTA>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="참여자를 삭제할까요?"
        description="이 참여자가 결제한 비용도 함께 삭제돼요."
        onClose={() => setDeleteTarget(null)}
        confirmButton={
          <ConfirmDialog.ConfirmButton onClick={handleConfirmDeleteMember}>
            삭제
          </ConfirmDialog.ConfirmButton>
        }
        cancelButton={
          <ConfirmDialog.CancelButton onClick={() => setDeleteTarget(null)}>
            취소
          </ConfirmDialog.CancelButton>
        }
      />
    </>
  )
}
