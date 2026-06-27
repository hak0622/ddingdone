import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Asset, BottomSheet, ConfirmDialog, FixedBottomCTA, List, ListRow, Top, useBottomSheet } from '@toss/tds-mobile'
import { doc, updateDoc, writeBatch, increment, arrayUnion } from 'firebase/firestore'
import { formatKRW, truncateName } from '../utils/format'
import { COLORS } from '../styles/tokens'
import { db } from '../lib/firebase'
import { uploadImage, deleteImage } from '../lib/cloudinary'
import { shareInviteLink } from '../lib/bridge'
import { deletePreMember } from '../lib/meetingMembers'
import { useMeeting } from '../hooks/useMeeting'
import { useUserStore } from '../store/userStore'
import ResultScreen from '../components/ResultScreen'

const CATEGORY_EMOJI: Record<string, string> = {
  식비: '🍖',
  카페: '☕',
  숙소: '🏨',
  교통: '🚕',
  기타: '🎟️',
}

function CameraIcon({ color = '#aaa' }: { color?: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path
        d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="4" stroke={color} strokeWidth="1.8" />
    </svg>
  )
}

const OVERLAY_GRADIENT = 'linear-gradient(to bottom, transparent 25%, rgba(0,0,0,0.72) 100%)'
const MEMBER_CHIP_LIMIT = 3

export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { meeting, members, expenses, loading, error } = useMeeting(id)
  const { uid, tossKey, setUser } = useUserStore()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [joinNickname, setJoinNickname] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinedNickname, setJoinedNickname] = useState<string | null>(null)
  const [joinError, setJoinError] = useState('')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [confirmDeleteMeeting, setConfirmDeleteMeeting] = useState(false)
  const [deletingMeeting, setDeletingMeeting] = useState(false)
  const [deletePreMemberTarget, setDeletePreMemberTarget] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { open: openManageSheet, close: closeManageSheet } = useBottomSheet()
  const { open: openMembersSheet, close: closeMembersSheet } = useBottomSheet()
  const isSettled = meeting?.status === 'settled'

  useEffect(() => {
    return () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview) }
  }, [pendingPreview])

  async function handleShare() {
    if (!id) return
    try {
      await shareInviteLink(id)
    } catch (err) {
      console.error('공유 실패', err)
    }
  }

  async function claimPreMember(preUid: string, nickname: string) {
    if (!id || !uid) return
    setJoining(true)
    setJoinError('')
    try {
      const batch = writeBatch(db)
      expenses
        .filter((e) => e.paidBy === preUid)
        .forEach((e) => batch.update(doc(db, 'meetings', id, 'expenses', e.id), { paidBy: uid }))
      batch.set(doc(db, 'meetings', id, 'members', uid), { nickname })
      batch.delete(doc(db, 'meetings', id, 'members', preUid))
      batch.update(doc(db, 'meetings', id), { memberUids: arrayUnion(uid) })
      await batch.commit()
      localStorage.setItem('ddingdone_nickname', nickname)
      setUser(uid, nickname, tossKey)
      setJoinedNickname(nickname)
    } catch {
      setJoinError('참여에 실패했어요. 다시 시도해주세요.')
    } finally {
      setJoining(false)
    }
  }

  async function joinAsNew() {
    if (!id || !uid || !joinNickname.trim()) return
    setJoining(true)
    setJoinError('')
    try {
      const nickname = joinNickname.trim()
      const batch = writeBatch(db)
      batch.set(doc(db, 'meetings', id, 'members', uid), { nickname })
      batch.update(doc(db, 'meetings', id), {
        memberUids: arrayUnion(uid),
        memberCount: increment(1),
      })
      await batch.commit()
      localStorage.setItem('ddingdone_nickname', nickname)
      setUser(uid, nickname, tossKey)
      setJoinedNickname(nickname)
    } catch {
      setJoinError('참여에 실패했어요. 다시 시도해주세요.')
    } finally {
      setJoining(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    setPendingPreview(URL.createObjectURL(file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleCancelPhoto() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingPreview(null)
  }


  async function handleSavePhoto() {
    if (!pendingFile || !id) return
    setUploading(true)
    try {
      const previousPublicId = meeting?.photoPublicId ?? null
      const { url, publicId } = await uploadImage(pendingFile)
      await updateDoc(doc(db, 'meetings', id), { photoUrl: url, photoPublicId: publicId })
      if (pendingPreview) URL.revokeObjectURL(pendingPreview)
      setPendingFile(null)
      setPendingPreview(null)
      if (previousPublicId && previousPublicId !== publicId) {
        deleteImage(previousPublicId).catch((err) => console.error('이전 사진 삭제 실패', err))
      }
    } catch (err) {
      console.error('사진 업로드 실패', err)
      setUploadError(true)
      setTimeout(() => setUploadError(false), 3000)
    } finally {
      setUploading(false)
    }
  }

  function showActionError(msg: string) {
    setActionError(msg)
    setTimeout(() => setActionError(''), 3000)
  }

  async function handleReopenMeeting() {
    if (!id) return
    closeManageSheet()
    try {
      await updateDoc(doc(db, 'meetings', id), { status: 'active' })
    } catch {
      showActionError('다시 열지 못했어요. 다시 시도해주세요.')
    }
  }

  async function handleDeleteMeeting() {
    if (!id || deletingMeeting) return
    setDeletingMeeting(true)
    try {
      const batch = writeBatch(db)
      Object.keys(members).forEach((memberUid) => {
        batch.delete(doc(db, 'meetings', id, 'members', memberUid))
      })
      expenses.forEach((e) => {
        batch.delete(doc(db, 'meetings', id, 'expenses', e.id))
      })
      batch.delete(doc(db, 'meetings', id))
      await batch.commit()
      if (meeting?.photoPublicId) {
        deleteImage(meeting.photoPublicId).catch((err) => console.error('모임 사진 삭제 실패', err))
      }
      navigate('/')
    } catch {
      showActionError('삭제하지 못했어요. 다시 시도해주세요.')
    } finally {
      setDeletingMeeting(false)
    }
  }

  function openManage() {
    openManageSheet({
      header: <BottomSheet.Header>관리</BottomSheet.Header>,
      onDimmerClick: closeManageSheet,
      children: (
        <div style={{ padding: '0 20px 8px' }}>
          <button
            onClick={() => { closeManageSheet(); navigate(`/meetings/${id}/edit`) }}
            style={{
              width: '100%',
              padding: '16px 0',
              background: 'none',
              border: 'none',
              borderBottom: '1px solid #f0f0f0',
              textAlign: 'left',
              fontSize: 16,
              color: '#191919',
              cursor: 'pointer',
            }}
          >
            방 정보 수정
          </button>
          {isSettled && (
            <button
              onClick={handleReopenMeeting}
              style={{
                width: '100%',
                padding: '16px 0',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid #f0f0f0',
                textAlign: 'left',
                fontSize: 16,
                color: '#191919',
                cursor: 'pointer',
              }}
            >
              정산 다시 열기
            </button>
          )}
          <button
            onClick={() => { closeManageSheet(); setConfirmDeleteMeeting(true) }}
            style={{
              width: '100%',
              padding: '16px 0',
              background: 'none',
              border: 'none',
              textAlign: 'left',
              fontSize: 16,
              color: '#ef4444',
              cursor: 'pointer',
            }}
          >
            삭제
          </button>
        </div>
      ),
    })
  }

  async function handleDeletePreMember(preUid: string) {
    if (!id) return
    try {
      await deletePreMember(id, preUid)
    } catch {
      showActionError('멤버를 삭제하지 못했어요. 다시 시도해주세요.')
    }
  }

  async function handleDeleteExpense(expenseId: string) {
    if (!id) return
    const expense = expenses.find((e) => e.id === expenseId)
    if (!expense) return
    const batch = writeBatch(db)
    batch.delete(doc(db, 'meetings', id, 'expenses', expenseId))
    batch.update(doc(db, 'meetings', id), {
      totalAmount: increment(-expense.amount),
      expenseCount: increment(-1),
    })
    try {
      await batch.commit()
    } catch {
      showActionError('비용을 삭제하지 못했어요. 다시 시도해주세요.')
    }
  }

  if (loading) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>정산방</Top.TitleParagraph>} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px)',
          }}
        >
          <p style={{ fontSize: 14, color: '#8b8b8b', margin: 0 }}>불러오는 중...</p>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>정산방</Top.TitleParagraph>} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 56px)', gap: 8 }}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#191919' }}>정보를 불러오지 못했어요</p>
          <p style={{ fontSize: 14, color: '#888', margin: '0 0 16px' }}>잠시 후 다시 시도해주세요</p>
          <button onClick={() => navigate(-1)} style={{ padding: '12px 24px', fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 10, background: '#3182F6', color: '#fff', cursor: 'pointer' }}>
            돌아가기
          </button>
        </div>
      </>
    )
  }

  if (!meeting) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>정산방</Top.TitleParagraph>} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 56px)',
            gap: 8,
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#191919' }}>정산방을 찾을 수 없어요</p>
          <p style={{ fontSize: 14, color: '#888', margin: '0 0 16px' }}>삭제됐거나 잘못된 링크예요</p>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '12px 24px',
              fontSize: 14,
              fontWeight: 600,
              border: 'none',
              borderRadius: 10,
              background: '#3182F6',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            홈으로
          </button>
        </div>
      </>
    )
  }

  const isNotMember = !loading && !!uid && !members[uid]
  const preMembers = Object.entries(members).filter(([memberUid]) => memberUid.startsWith('pre_'))

  if (joinedNickname) {
    return (
      <ResultScreen
        title={`${joinedNickname}로 참여했어요!`}
        subtitle="이제 비용을 함께 기록할 수 있어요"
        onConfirm={() => setJoinedNickname(null)}
      />
    )
  }

  if (isNotMember) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>{meeting.name}</Top.TitleParagraph>} />
        <div style={{ padding: '24px 20px' }}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 20px' }}>
            이 정산방에 참여하시겠어요?
          </p>

          {preMembers.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
                기존 참여자 중 나를 선택하세요
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {preMembers.map(([preUid, nickname]) => (
                  <button
                    key={preUid}
                    onClick={() => claimPreMember(preUid, nickname)}
                    disabled={joining}
                    style={{
                      padding: '8px 16px',
                      fontSize: 14,
                      border: '1px solid #d8d8d8',
                      borderRadius: 20,
                      background: '#f5f5f5',
                      cursor: 'pointer',
                    }}
                  >
                    {nickname}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p style={{ fontSize: 13, color: '#888', margin: '0 0 8px' }}>새 닉네임으로 참여</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={joinNickname}
                onChange={(e) => setJoinNickname(e.target.value)}
                placeholder="닉네임 입력"
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  fontSize: 14,
                  border: '1px solid #d8d8d8',
                  borderRadius: 8,
                  outline: 'none',
                }}
              />
              <button
                onClick={joinAsNew}
                disabled={joining || !joinNickname.trim()}
                style={{
                  padding: '10px 16px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 8,
                  background: joinNickname.trim() ? '#000' : '#d8d8d8',
                  color: '#fff',
                  cursor: joinNickname.trim() ? 'pointer' : 'default',
                }}
              >
                참여하기
              </button>
            </div>
          </div>
          {joinError && (
            <p style={{ fontSize: 13, color: '#ef4444', margin: '12px 0 0' }}>{joinError}</p>
          )}
        </div>
      </>
    )
  }

  const memberEntries = Object.entries(members)
  const visibleMemberEntries = memberEntries.slice(0, MEMBER_CHIP_LIMIT)
  const hasMoreMembers = memberEntries.length > MEMBER_CHIP_LIMIT
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0)
  const perPerson = memberEntries.length > 0 ? Math.floor(totalAmount / memberEntries.length) : 0

  const myPaid = expenses.filter((e) => e.paidBy === uid).reduce((s, e) => s + e.amount, 0)
  const myBalance = myPaid - perPerson

  function openAllMembers() {
    openMembersSheet({
      header: <BottomSheet.Header>참여자 {memberEntries.length}명</BottomSheet.Header>,
      onDimmerClick: closeMembersSheet,
      children: (
        <div style={{ padding: '0 20px 24px', maxHeight: '60vh', overflowY: 'auto' }}>
          {memberEntries.map(([memberUid, name]) => {
            const canDeleteMember = !isSettled && uid === meeting.createdBy && memberUid.startsWith('pre_')
            return (
              <div
                key={memberUid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 0',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <span style={{ fontSize: 15, color: '#191919' }}>
                  {memberUid === uid ? `${name}(나)` : name}
                </span>
                {canDeleteMember && (
                  <button
                    onClick={() => setDeletePreMemberTarget(memberUid)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 20,
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      background: '#FFEBEB',
                      color: '#ef4444',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    삭제
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ),
    })
  }

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={22}>{meeting.name}</Top.TitleParagraph>}
        right={
          uid === meeting?.createdBy ? (
            <button
              onClick={openManage}
              style={{
                marginRight: 16,
                padding: '5px 12px',
                borderRadius: 20,
                border: '1px solid #d8d8d8',
                background: '#fff',
                color: '#555',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              관리
            </button>
          ) : !isSettled ? (
            <button
              onClick={() => navigate(`/meetings/${id}/edit`)}
              style={{
                marginRight: 16,
                padding: '5px 12px',
                borderRadius: 20,
                border: '1px solid #d8d8d8',
                background: '#fff',
                color: '#555',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              수정
            </button>
          ) : undefined
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 시네마틱 히어로 */}
      {pendingPreview ? (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
          <img
            src={pendingPreview}
            alt="미리보기"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: OVERLAY_GRADIENT }} />
          <div style={{ position: 'absolute', bottom: 52, left: 20, right: 20 }}>
            <p style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meeting.name}
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
              {meeting.date}{meeting.memo ? ` · ${meeting.memo}` : ''}
            </p>
          </div>
          <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 8 }}>
            <button
              onClick={handleCancelPhoto}
              style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: 'rgba(0,0,0,0.45)', color: '#fff', cursor: 'pointer' }}
            >
              취소
            </button>
            <button
              onClick={handleSavePhoto}
              disabled={uploading}
              style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: uploading ? '#aaa' : '#3182F6', color: '#fff', cursor: uploading ? 'default' : 'pointer' }}
            >
              {uploading ? '저장 중...' : '이 사진으로 저장'}
            </button>
          </div>
        </div>
      ) : meeting.photoUrl ? (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
          <img
            src={meeting.photoUrl}
            alt="대표 사진"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: OVERLAY_GRADIENT }} />
          <span
            style={{ position: 'absolute', top: 12, right: 14, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: isSettled ? 'rgba(0,0,0,0.4)' : '#3182F6', color: '#fff' }}
          >
            {isSettled ? '완료' : '진행중'}
          </span>
          <div style={{ position: 'absolute', bottom: 16, left: 20, right: isSettled ? 20 : 110 }}>
            <p style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meeting.name}
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
              {meeting.date}{meeting.memo ? ` · ${meeting.memo}` : ''}
            </p>
          </div>
          {!isSettled && (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ position: 'absolute', bottom: 14, right: 14, padding: '5px 10px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: 'rgba(0,0,0,0.45)', color: '#fff', cursor: 'pointer' }}
            >
              사진 변경
            </button>
          )}
        </div>
      ) : (
        <div
          onClick={!isSettled ? () => fileInputRef.current?.click() : undefined}
          style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', background: '#f5f5f5', cursor: isSettled ? 'default' : 'pointer' }}
        >
          <div
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 64 }}
          >
            <CameraIcon color="#c8c8c8" />
            {!isSettled && (
              <p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>
                사진을 추가해보세요
              </p>
            )}
          </div>
          <span
            style={{ position: 'absolute', top: 12, right: 14, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: isSettled ? '#e0e0e0' : '#3182F6', color: isSettled ? '#666' : '#fff' }}
          >
            {isSettled ? '완료' : '진행중'}
          </span>
          <div style={{ position: 'absolute', bottom: 16, left: 20, right: 20 }}>
            <p style={{ fontSize: 20, fontWeight: 700, color: '#191919', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meeting.name}
            </p>
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
              {meeting.date}{meeting.memo ? ` · ${meeting.memo}` : ''}
            </p>
          </div>
        </div>
      )}

      {uploadError && (
        <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '8px 20px', margin: 0, background: '#fff5f5' }}>
          사진 업로드에 실패했어요. 다시 시도해주세요.
        </p>
      )}

      <div style={{ padding: '0 20px 100px' }}>
        {/* 멤버 + 초대 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '14px 0 16px',
          }}
        >
          <button
            type="button"
            onClick={openAllMembers}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              flex: 1,
              border: 'none',
              background: 'none',
              padding: 0,
              margin: 0,
              textAlign: 'left',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            {visibleMemberEntries.map(([memberUid, name]) => {
              const displayName = truncateName(name)
              const label = memberUid === uid ? `나(${displayName})` : displayName
              return (
                <span
                  key={memberUid}
                  style={{
                    padding: '4px 10px',
                    fontSize: 13,
                    border: '1px solid #e8e8e8',
                    borderRadius: 20,
                    background: '#f5f5f5',
                    color: '#333',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {label}
                </span>
              )
            })}
            {hasMoreMembers && (
              <span
                style={{
                  padding: '4px 10px',
                  fontSize: 13,
                  border: '1px solid #e8e8e8',
                  borderRadius: 20,
                  background: '#f5f5f5',
                  color: '#333',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                외 {memberEntries.length - MEMBER_CHIP_LIMIT}명
              </span>
            )}
          </button>
          {!isSettled && (
            <button
              onClick={handleShare}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 10px',
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid #d0e4ff',
                borderRadius: 8,
                background: '#f0f6ff',
                color: '#3182F6',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <div style={{ width: 18, height: 18, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 100, height: 100, transform: 'scale(0.18)', transformOrigin: '0 0' }}>
                  <Asset.Icon frameShape={Asset.frameShape.CleanW100} backgroundColor="transparent" name="icon-ios-share-outlined-thick-mono" color="#3182F6" aria-hidden={true} ratio="1/1" />
                </div>
              </div>
              초대
            </button>
          )}
        </div>

        {/* 통계 카드 */}
        <div
          style={{
            background: '#f7f7f7',
            borderRadius: 12,
            padding: '16px 12px',
            display: 'flex',
            justifyContent: 'space-around',
            marginBottom: 16,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 22, height: 22, overflow: 'hidden', position: 'relative', marginBottom: 4, margin: '0 auto 4px' }}>
              <div style={{ width: 100, height: 100, transform: 'scale(0.22)', transformOrigin: '0 0' }}>
                <Asset.Icon frameShape={Asset.frameShape.CleanW100} backgroundColor="transparent" name="icon-system-wallet-outlined" color="#3182F6" aria-hidden={true} ratio="1/1" />
              </div>
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px', color: '#191919' }}>
              {formatKRW(totalAmount)}
            </p>
            <p style={{ fontSize: 11, color: '#888', margin: 0 }}>총 지출</p>
          </div>
          <div style={{ width: 1, background: '#e8e8e8', margin: '4px 0' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 22, height: 22, overflow: 'hidden', position: 'relative', margin: '0 auto 4px' }}>
              <div style={{ width: 100, height: 100, transform: 'scale(0.22)', transformOrigin: '0 0' }}>
                <Asset.Icon frameShape={Asset.frameShape.CleanW100} backgroundColor="transparent" name="icon-system-user-two-outlined" color="#3182F6" aria-hidden={true} ratio="1/1" />
              </div>
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px', color: '#191919' }}>
              {formatKRW(perPerson)}
            </p>
            <p style={{ fontSize: 11, color: '#888', margin: 0 }}>1인당</p>
          </div>
          <div style={{ width: 1, background: '#e8e8e8', margin: '4px 0' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 22, height: 22, overflow: 'hidden', position: 'relative', margin: '0 auto 4px' }}>
              <div style={{ width: 100, height: 100, transform: 'scale(0.22)', transformOrigin: '0 0' }}>
                <Asset.Icon frameShape={Asset.frameShape.CleanW100} backgroundColor="transparent" name="icon-document-lines-unfold-line-mono" color="#3182F6" aria-hidden={true} ratio="1/1" />
              </div>
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px', color: '#191919' }}>
              {expenses.length}건
            </p>
            <p style={{ fontSize: 11, color: '#888', margin: 0 }}>비용 기록</p>
          </div>
        </div>

        {/* 내 정산 요약 카드 */}
        {!isSettled && memberEntries.length > 1 && (
          <div
            onClick={() => navigate(`/meetings/${id}/settle`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderRadius: 12,
              marginBottom: 24,
              cursor: 'pointer',
              background: '#f7f7f7',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px', color: '#191919' }}>
                  {myBalance !== 0 ? (
                    <>
                      정산 후{' '}
                      <span style={{ color: myBalance > 0 ? COLORS.primary : COLORS.error }}>
                        {formatKRW(myBalance > 0 ? myBalance : Math.abs(myBalance))}
                      </span>
                      {myBalance > 0 ? ' 받아요' : ' 내야 해요'}
                    </>
                  ) : '딱 맞게 냈어요!'}
                </p>
                <p style={{ fontSize: 12, color: '#aaa', margin: 0 }}>정산 결과 자세히 보기</p>
              </div>
            </div>
            <span style={{ fontSize: 20, color: '#ccc', lineHeight: 1 }}>›</span>
          </div>
        )}

        {/* 비용 목록 */}
        <div style={{ marginBottom: 24 }}>
          {expenses.length === 0 ? (
            <p style={{ fontSize: 14, color: '#bbb', textAlign: 'center', padding: '28px 0', margin: 0 }}>
              아직 비용이 없어요
            </p>
          ) : (
            <List style={{ margin: '0 -20px', padding: 0, listStyle: 'none' }}>
              {expenses.map((expense) => {
                const paidByName = expense.paidBy === uid ? '나' : (members[expense.paidBy] ?? expense.paidBy)
                const displayTitle = expense.memo || expense.category || '지출'
                const emoji = CATEGORY_EMOJI[expense.category] || '💳'
                const canEdit = !isSettled && expense.paidBy === uid
                return (
                  <ListRow
                    key={expense.id}
                    border="indented"
                    left={
                      <ListRow.AssetText shape="squircle" size="small">
                        {emoji}
                      </ListRow.AssetText>
                    }
                    contents={
                      <ListRow.Texts
                        type="2RowTypeA"
                        top={displayTitle}
                        bottom={`${paidByName} 납부`}
                      />
                    }
                    right={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#191919', whiteSpace: 'nowrap' }}>
                          {formatKRW(expense.amount)}
                        </span>
                        {canEdit && (
                          <>
                            <button
                              onClick={() => navigate(`/meetings/${id}/expense?editId=${expense.id}`)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 20,
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: 600,
                                background: '#EBF2FF',
                                color: '#3182F6',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              수정
                            </button>
                            <button
                              onClick={() => setDeleteTargetId(expense.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 20,
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: 600,
                                background: '#FFEBEB',
                                color: '#ef4444',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              삭제
                            </button>
                          </>
                        )}
                      </div>
                    }
                  />
                )
              })}
            </List>
          )}
        </div>
      </div>

      <FixedBottomCTA
        onClick={() =>
          isSettled
            ? navigate(`/meetings/${id}/settle`)
            : navigate(`/meetings/${id}/expense`)
        }
      >
        {isSettled ? '정산 결과 보기' : '비용 추가하기'}
      </FixedBottomCTA>

      {actionError && (
        <div style={{ position: 'fixed', bottom: 80, left: 0, right: 0, background: 'rgba(0,0,0,0.75)', color: '#fff', textAlign: 'center', padding: '12px 20px', fontSize: 14, zIndex: 100 }}>
          {actionError}
        </div>
      )}

      <ConfirmDialog
        open={deleteTargetId !== null}
        title="비용을 삭제할까요?"
        description="삭제한 비용은 복구할 수 없어요."
        onClose={() => setDeleteTargetId(null)}
        confirmButton={
          <ConfirmDialog.ConfirmButton
            onClick={() => {
              if (deleteTargetId) handleDeleteExpense(deleteTargetId)
              setDeleteTargetId(null)
            }}
          >
            삭제
          </ConfirmDialog.ConfirmButton>
        }
        cancelButton={
          <ConfirmDialog.CancelButton onClick={() => setDeleteTargetId(null)}>
            취소
          </ConfirmDialog.CancelButton>
        }
      />

      <ConfirmDialog
        open={deletePreMemberTarget !== null}
        title="멤버를 삭제할까요?"
        description="이 멤버가 결제한 비용도 함께 삭제돼요."
        onClose={() => setDeletePreMemberTarget(null)}
        confirmButton={
          <ConfirmDialog.ConfirmButton
            onClick={() => {
              if (deletePreMemberTarget) handleDeletePreMember(deletePreMemberTarget)
              setDeletePreMemberTarget(null)
            }}
          >
            삭제
          </ConfirmDialog.ConfirmButton>
        }
        cancelButton={
          <ConfirmDialog.CancelButton onClick={() => setDeletePreMemberTarget(null)}>
            취소
          </ConfirmDialog.CancelButton>
        }
      />

      <ConfirmDialog
        open={confirmDeleteMeeting}
        title="정산방을 삭제할까요?"
        description="삭제한 정산방과 모든 비용 기록은 복구할 수 없어요."
        onClose={() => setConfirmDeleteMeeting(false)}
        confirmButton={
          <ConfirmDialog.ConfirmButton
            onClick={() => {
              setConfirmDeleteMeeting(false)
              handleDeleteMeeting()
            }}
          >
            삭제
          </ConfirmDialog.ConfirmButton>
        }
        cancelButton={
          <ConfirmDialog.CancelButton onClick={() => setConfirmDeleteMeeting(false)}>
            취소
          </ConfirmDialog.CancelButton>
        }
      />

    </>
  )
}
