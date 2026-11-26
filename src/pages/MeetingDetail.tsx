import { participantRoomRequest } from '../lib/participantRooms'
import { participantDisplayName } from '../utils/meetingParticipants'
import { useSettlementSnapshot } from '../hooks/useSettlementSnapshot'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Asset, BottomSheet, ConfirmDialog, FixedBottomCTA, List, ListRow, TextField, Top, useBottomSheet } from '@toss/tds-mobile'
import { formatKRW, truncateName } from '../utils/format'
import { groupExpensesByPayer } from '../utils/expenseShares'
import { buildV2SettlementSnapshot } from '../utils/settlementSnapshot'
import { COLORS } from '../styles/tokens'
import { saveMeetingPhoto } from '../lib/meetingPhoto'
import { forgetMeetingPhoto, useMeetingPhoto } from '../hooks/useMeetingPhoto'
import { shareInviteLink } from '../lib/bridge'
import { refreshMeeting, useMeeting, type Expense } from '../hooks/useMeeting'
import { useUserStore } from '../store/userStore'

const CATEGORY_EMOJI: Record<string, string> = {
  식비: '🍖',
  카페: '☕',
  숙소: '🏨',
  교통: '🚕',
  기타: '🎟️',
}

const expenseActionStyle = {
  padding: '4px 10px',
  borderRadius: 20,
  border: 0,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

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
  const { meeting, members, expenses, loading, error, participants, access } = useMeeting(id)
  const { uid, nickname: myNickname } = useUserStore()
  const [failedPhotoSrc, setFailedPhotoSrc] = useState<string>()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [joinNickname, setJoinNickname] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [confirmLeaveMeeting, setConfirmLeaveMeeting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { open: openManageSheet, close: closeManageSheet } = useBottomSheet()
  const { open: openMembersSheet, close: closeMembersSheet } = useBottomSheet()
  const { open: openExpenseSheet, close: closeExpenseSheet } = useBottomSheet()
  const isSettled = meeting?.status === 'settled'
  const myId = access?.participantId ?? ''
  const stored = useSettlementSnapshot(id, !!myId && isSettled)
  const displayName = (participantId: string) => participants
    ? participantDisplayName(participants, participantId)
    : members[participantId] ?? '알 수 없음'
  const canSeePhoto = !error && !!uid && meeting?.photoAccessConfirmed === true && meeting.memberUids.includes(uid)
  const photo = useMeetingPhoto(meeting?.id, meeting?.photoVersion, canSeePhoto)
  const photoSrc = photo !== failedPhotoSrc ? photo : null

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

  async function joinAsNew(rawNickname: string) {
    const nickname = rawNickname.trim()
    if (!id || !uid || !nickname || isSettled) return
    setJoining(true)
    setJoinError('')
    try {
      await participantRoomRequest(id, 'join', { nickname })
      refreshMeeting(id)
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
      await saveMeetingPhoto(id, pendingFile)
      if (pendingPreview) URL.revokeObjectURL(pendingPreview)
      setPendingFile(null)
      setPendingPreview(null)
    } catch (err) {
      console.error('사진 업로드 실패', err)
      if (err instanceof Error && err.message === 'PHOTO_SAVE_UNCONFIRMED') {
        handleCancelPhoto()
        setUploadError('사진 저장 결과를 확인하지 못했어요. 현재 사진을 확인해 주세요.')
      } else {
        setUploadError('사진을 저장하지 못했어요. 다시 시도해 주세요.')
      }
      setTimeout(() => setUploadError(''), 3000)
    } finally {
      setUploading(false)
    }
  }

  function showActionError(msg: string) {
    setActionError(msg)
    setTimeout(() => setActionError(''), 3000)
  }

  async function handleLeaveMeeting() {
    if (!id || !uid || !myId || leaving) return
    setLeaving(true)
    try {
      await participantRoomRequest(id, 'leave', { participantId: myId })
      forgetMeetingPhoto(uid, id)
      refreshMeeting(id)
      navigate('/')
    } catch {
      showActionError('나가지 못했어요. 다시 시도해주세요.')
    } finally {
      setLeaving(false)
    }
  }

  function openManage() {
    openManageSheet({
      header: <BottomSheet.Header>관리</BottomSheet.Header>,
      onDimmerClick: closeManageSheet,
      children: (
        <div style={{ padding: '0 20px 8px' }}>
          {!isSettled && <button
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
          </button>}
          <button
            onClick={() => { closeManageSheet(); setConfirmLeaveMeeting(true) }}
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
            나가기
          </button>
        </div>
      ),
    })
  }

  async function handleDeleteExpense(expenseId: string) {
    if (!id) return
    const expense = expenses.find((e) => e.id === expenseId)
    if (!expense) return
    try {
      await participantRoomRequest(id, 'expense', { action: 'delete', expenseId, revision: expense.revision })
    } catch {
      showActionError('비용을 삭제하지 못했어요. 화면을 갱신한 뒤 다시 시도해 주세요.')
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

  const isNotMember = !loading && !!uid && !members[myId]

  if (isNotMember) {
    // 닉네임이 아예 없는 첫 진입자는 "참여하시겠어요?" 확인 질문 없이, 앱
    // 최초 실행 시 보여주는 온보딩(Onboarding.tsx)과 똑같은 UI로 곧장
    // 닉네임을 받는다. 제출 한 번(joinAsNew)으로 닉네임 설정과 참여가 동시에
    // 끝난다 — /onboarding으로 실제로 이동시키면 거기서 한 번, 돌아와서
    // "{닉네임}으로 참여하기"를 또 눌러야 해서 탭이 한 번 더 늘어나기 때문에
    // 같은 화면 안에서 모양만 맞춰 한 번에 끝내는 쪽을 택했다.
    if (!myNickname && !isSettled) {
      return (
        <>
          <Top title={<Top.TitleParagraph size={22}>{meeting.name}</Top.TitleParagraph>} />
          <div style={{ padding: '32px 20px 0' }}>
            <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>
              반가워요! 어떻게 불러드릴까요?
            </p>
            <TextField
              variant="big"
              label="닉네임"
              placeholder="예: 민수"
              value={joinNickname}
              onChange={(e) => setJoinNickname(e.target.value)}
              maxLength={10}
              hasError={!!joinError}
              help={joinError || undefined}
            />
          </div>
          <FixedBottomCTA
            disabled={joining || !joinNickname.trim()}
            onClick={() => joinAsNew(joinNickname)}
          >
            {joining ? '참여하는 중...' : '참여하기'}
          </FixedBottomCTA>
        </>
      )
    }

    if (isSettled) {
      return (
        <>
          <Top title={<Top.TitleParagraph size={22}>{meeting.name}</Top.TitleParagraph>} />
          <div style={{ padding: '32px 20px 0' }}>
            <img
              src="https://static.toss.im/3d-emojis/u1F519-return.png"
              alt=""
              style={{ width: 64, height: 64, display: 'block', marginBottom: 20 }}
            />
            <p style={{ fontSize: 24, fontWeight: 700, margin: '0 0 12px', color: '#191F28' }}>
              정산이 완료된 방이에요.
            </p>
            <p style={{ fontSize: 16, color: '#4E5968', margin: myNickname ? 0 : '0 0 28px' }}>
              이번 모임에는 참여할 수 없어요.
            </p>
            {!myNickname && (
              <p style={{ fontSize: 15, color: '#8B95A1', margin: 0, lineHeight: 1.6 }}>
                닉네임을 설정하면
                <br />
                다음 모임부터 정산과 추억을
                <br />
                함께 남길 수 있어요.
              </p>
            )}
          </div>
          <FixedBottomCTA
            // 닉네임이 있는(이미 다른 모임을 써본) 사람은 본인 모임 목록이 있는
            // 홈으로 보내고, 닉네임이 아예 없는 첫 진입자는 온보딩으로 보낸다 —
            // 닉네임 없이 홈으로 보내면 이후 "새 정산방 만들기"에서 빈 닉네임으로
            // 모임이 만들어지는 문제가 생긴다.
            onClick={() => navigate(myNickname ? '/' : '/onboarding')}
          >
            {myNickname ? '홈으로' : '닉네임 설정하기'}
          </FixedBottomCTA>
        </>
      )
    }

    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>{meeting.name}</Top.TitleParagraph>} />
        <div style={{ padding: '24px 20px' }}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 20px' }}>
            이 정산방에 참여하시겠어요?
          </p>

          <button
            onClick={() => joinAsNew(myNickname)}
            disabled={joining}
            style={{
              display: 'block',
              width: '100%',
              padding: '14px 0',
              fontSize: 15,
              fontWeight: 600,
              border: 'none',
              borderRadius: 12,
              background: joining ? '#aaa' : COLORS.primary,
              color: '#fff',
              cursor: joining ? 'default' : 'pointer',
            }}
          >
            {joining ? '참여하는 중...' : `${myNickname}으로 참여하기`}
          </button>
          {joinError && (
            <p style={{ fontSize: 13, color: '#ef4444', margin: '12px 0 0' }}>{joinError}</p>
          )}
        </div>
      </>
    )
  }

  // Firestore 구독 결과의 순서는 보장되지 않아 새 멤버가 들어올 때마다 순서가
  // 흔들릴 수 있다. "나"는 항상 맨 앞에 고정한다.
  const memberEntries = Object.entries(members).sort(([a], [b]) => {
    if (a === myId) return -1
    if (b === myId) return 1
    return 0
  })
  const visibleMemberEntries = memberEntries.slice(0, MEMBER_CHIP_LIMIT)
  const hasMoreMembers = memberEntries.length > MEMBER_CHIP_LIMIT
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0)
  const myPaid = expenses.filter((e) => e.paidBy === myId).reduce((s, e) => s + e.amount, 0)
  const participantIds = Object.keys(participants ?? {}).sort()
  const splits = isSettled ? stored.snapshot : buildV2SettlementSnapshot(participantIds, expenses)
  const myBurden = splits?.participantBurdenTotals?.[myId] ?? 0
  const myBalance = myPaid - myBurden
  const myTransfers = splits?.transfers.filter(({ from, to }) => from === myId || to === myId) ?? []
  const hasIncomingAndOutgoing = myTransfers.some(({ from }) => from === myId) &&
    myTransfers.some(({ to }) => to === myId)

  function openAllMembers() {
    openMembersSheet({
      header: <BottomSheet.Header>참여자 {memberEntries.length}명</BottomSheet.Header>,
      onDimmerClick: closeMembersSheet,
      children: (
        <div style={{ padding: '0 20px 24px', maxHeight: '60vh', overflowY: 'auto' }}>
          {memberEntries.map(([memberUid, name]) => (
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
                {memberUid === myId ? `${name}(나)` : name}
              </span>
            </div>
          ))}
        </div>
      ),
    })
  }

  function openPayerExpenses(name: string, payerExpenses: Expense[]) {
    openExpenseSheet({
      header: (
        <BottomSheet.Header>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <span>{name}의 지출 내역</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: '#6B7684', whiteSpace: 'nowrap' }}>
              {payerExpenses.length}건
            </span>
          </span>
        </BottomSheet.Header>
      ),
      onDimmerClick: closeExpenseSheet,
      children: (
        <List style={{ maxHeight: '60vh', overflowY: 'auto', padding: '0 0 24px' }}>
          {[...payerExpenses].reverse().map((expense) => {
            const canEdit = !isSettled && expense.createdBy === myId
            const locked = [expense.paidBy, ...(expense.splitMemberUids ?? [])].some((id) => !members[id])
            const title = `${expense.category || '기타'} · ${formatKRW(expense.amount)}`
            return (
              <ListRow
                key={expense.id}
                border="indented"
                left={<ListRow.AssetText shape="squircle" size="small">{CATEGORY_EMOJI[expense.category] || '💳'}</ListRow.AssetText>}
                contents={(
                  <div style={{ minWidth: 0, width: '100%' }}>
                    <ListRow.Texts type="1RowTypeA" top={title} />
                    {!!expense.splitMemberUids?.length && (
                      <div
                        role="group"
                        aria-label="함께 나눈 사람"
                        tabIndex={0}
                        style={{
                          display: 'flex', gap: 4, overflowX: 'auto', overscrollBehaviorX: 'contain',
                          scrollbarWidth: 'none', marginTop: 4,
                        }}
                      >
                        {expense.splitMemberUids.map((participantId) => (
                          <span
                            key={participantId}
                            style={{ flexShrink: 0, whiteSpace: 'nowrap', padding: '2px 7px', borderRadius: 12, background: '#F2F4F6', color: '#4E5968', fontSize: 12 }}
                          >
                            {participantId === myId ? '나' : displayName(participantId)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                right={canEdit && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      style={{ ...expenseActionStyle, color: COLORS.primary, background: '#EBF2FF' }}
                      onClick={() => {
                        closeExpenseSheet()
                        navigate(`/meetings/${id}/expense?editId=${expense.id}`)
                      }}
                    >수정</button>
                    {!locked && <button
                      type="button"
                      style={{ ...expenseActionStyle, color: COLORS.error, background: '#FFEBEB' }}
                      onClick={() => {
                        closeExpenseSheet()
                        setDeleteTargetId(expense.id)
                      }}
                    >삭제</button>}
                  </div>
                )}
              />
            )
          })}
        </List>
      ),
    })
  }

  return (
    <>
      <Top
        title={<Top.TitleParagraph size={22}>{meeting.name}</Top.TitleParagraph>}
        right={
          !!myId ? (
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
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
      ) : photoSrc && photoSrc !== failedPhotoSrc ? (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
          <img
            src={photoSrc}
            onError={() => setFailedPhotoSrc(photoSrc)}
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
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            <p style={{ fontSize: 13, color: '#888', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meeting.date}{meeting.memo ? ` · ${meeting.memo}` : ''}
            </p>
          </div>
        </div>
      )}

      {uploadError && (
        <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '8px 20px', margin: 0, background: '#fff5f5' }}>
          {uploadError}
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
              const label = memberUid === myId ? `나(${displayName})` : displayName
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
            <div style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#3182F6"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden={true}
              >
                <circle cx="6" cy="8.5" r="2.5" />
                <circle cx="15" cy="6.75" r="3.25" />
                <path d="M6 19H3.5A1.5 1.5 0 0 1 2 17.5C2 15 4.25 13 7 13" />
                <path d="M10 20a2 2 0 0 1-2-2c0-3.1 3.1-5.5 7-5.5s7 2.4 7 5.5a2 2 0 0 1-2 2Z" />
              </svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px', color: '#191919' }}>
              {formatKRW(myBurden)}
            </p>
            <p style={{ fontSize: 11, color: '#888', margin: 0 }}>{splits ? '내 부담액' : '1인당'}</p>
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
        {!isSettled && (
          <button
            type="button"
            onClick={() => navigate(`/meetings/${id}/settle`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '14px 16px',
              border: 'none',
              borderRadius: 12,
              marginBottom: 24,
              cursor: 'pointer',
              textAlign: 'left',
              background: '#f7f7f7',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px', color: '#191919' }}>
                  {hasIncomingAndOutgoing ? '보낼 돈과 받을 돈이 있어요' : memberEntries.length === 1 && myTransfers.length === 0 ? '내 지출 정산' : myBalance !== 0 ? (
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
          </button>
        )}

        {/* 비용 목록 */}
        <div style={{ marginBottom: 24 }}>
          {expenses.length === 0 ? (
            <p style={{ fontSize: 14, color: '#bbb', textAlign: 'center', padding: '28px 0', margin: 0 }}>
              아직 비용이 없어요
            </p>
          ) : (
            <List style={{ margin: '0 -20px', padding: 0, listStyle: 'none' }}>
              {groupExpensesByPayer(expenses).map(({ paidBy, total, expenses: payerExpenses }) => {
                const name = paidBy === myId ? '나' : displayName(paidBy)
                return (
                  <ListRow
                    key={paidBy}
                    border="indented"
                    onClick={() => openPayerExpenses(name, payerExpenses)}
                    style={{ cursor: 'pointer' }}
                    contents={<ListRow.Texts type="1RowTypeA" top={name} />}
                    right={(
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#191919' }}>{formatKRW(total)} 결제</span>
                        <span aria-hidden="true" style={{ color: '#8B95A1' }}>›</span>
                      </div>
                    )}
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
        open={confirmLeaveMeeting}
        title="이 모임에서 나갈까요?"
        description={meeting.memberUids.length === 1
          ? '마지막 참여자가 나가면 모임, 비용 기록, 대표 사진을 모두 삭제해요.'
          : isSettled
            ? '완료된 모임은 나가면 다시 들어올 수 없어요. 정산 기록은 남아요.'
            : '나가면 다시 초대 링크로 들어올 수 있어요.'}
        onClose={() => setConfirmLeaveMeeting(false)}
        confirmButton={
          <ConfirmDialog.ConfirmButton
            onClick={() => {
              setConfirmLeaveMeeting(false)
              handleLeaveMeeting()
            }}
          >
            나가기
          </ConfirmDialog.ConfirmButton>
        }
        cancelButton={
          <ConfirmDialog.CancelButton onClick={() => setConfirmLeaveMeeting(false)}>
            취소
          </ConfirmDialog.CancelButton>
        }
      />

    </>
  )
}
