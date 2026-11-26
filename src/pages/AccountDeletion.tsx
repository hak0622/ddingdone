import { useEffect, useRef, useState } from 'react'
import { Loader, Top } from '@toss/tds-mobile'
import { useNavigate } from 'react-router-dom'
import {
  AccountDeletionError,
  confirmWithdrawal,
  createWithdrawalPreview,
  getWithdrawalStatus,
  confirmWithdrawalScope,
  remainingPollDelay,
  type WithdrawalMeetingPreview,
  type WithdrawalPreview,
  type WithdrawalStatus,
} from '../lib/accountDeletion'
import { COLORS } from '../styles/tokens'
import { finalizeLocalAccountDeletion } from '../lib/accountCleanup'

const SUPPORT_EMAIL = 'seounghak062@gmail.com'
const TERMINAL_STATUSES = new Set(['complete', 'preview_stale', 'failed'])

const ACTION_TEXT: Record<WithdrawalMeetingPreview['action'], string> = {
  preserve_participant_records: '기존 정산 기록은 유지하고 내 계정과 모임의 연결을 삭제해요.',
  leave_active_shared: '내가 작성한 비용을 삭제하고 방에서 나가요.',
  anonymize_settled_shared: '정산 결과는 유지하고 내 정보와 작성 비용을 정리해요.',
  delete_solo_room: '나만 참여 중인 방과 비용, 사진을 모두 삭제해요.',
  manual_review: '데이터를 안전하게 확인한 뒤 관리자가 처리해야 해요.',
}

const ERROR_TEXT: Record<string, string> = {
  WORKER_NOT_CONFIGURED: '탈퇴 서버가 아직 연결되지 않았어요.',
  UNAUTHORIZED: '사용자 인증을 확인할 수 없어요. 앱을 다시 실행해주세요.',
  WITHDRAWAL_IN_PROGRESS: '이미 탈퇴 처리가 진행 중이에요.',
  MANIFEST_NOT_FOUND: '탈퇴 정보가 만료됐어요. 다시 확인해주세요.',
  MANIFEST_INVALID_OR_EXPIRED: '탈퇴 정보가 만료됐어요. 다시 확인해주세요.',
  MANUAL_REVIEW_REQUIRED: '자동 처리할 수 없는 방이 있어요. 고객센터로 문의해주세요.',
  PREVIEW_STALE: '방 정보가 변경됐어요. 최신 내용으로 다시 확인해주세요.',
  MEETING_LIMIT_EXCEEDED: '참여 중인 방이 많아 자동 처리할 수 없어요. 고객센터로 문의해주세요.',
  DOCUMENT_LIMIT_EXCEEDED: '비용 내역이 많은 방이 있어 자동 처리할 수 없어요. 고객센터로 문의해주세요.',
}

function errorMessage(error: unknown): string {
  if (error instanceof AccountDeletionError) {
    return ERROR_TEXT[error.code] ?? '요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.'
  }
  return '네트워크 상태를 확인하고 다시 시도해주세요.'
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 18, border: `1px solid ${COLORS.borderLight}`, borderRadius: 14, background: '#fff' }}>
      {children}
    </div>
  )
}

function PrimaryButton({ children, disabled, onClick, danger = false }: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: '100%', height: 52, border: 0, borderRadius: 12,
        background: disabled ? COLORS.disabled : danger ? COLORS.error : COLORS.primary,
        color: disabled ? COLORS.disabledText : '#fff', fontSize: 16, fontWeight: 700,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function Summary({ preview }: { preview: WithdrawalPreview }) {
  const { summary } = preview
  return (
    <Card>
      <p style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 700 }}>탈퇴하면 이렇게 처리돼요</p>
      <div style={{ display: 'grid', gap: 10, fontSize: 14, color: '#555' }}>
        <span>참여 중인 정산방 <b style={{ color: COLORS.text }}>{summary.meetingCount}개</b></span>
        <span>전체 삭제되는 단독 방 <b style={{ color: COLORS.text }}>{summary.soloMeetingCountToDelete}개</b></span>
      </div>
    </Card>
  )
}

function MeetingCard({ meeting }: { meeting: WithdrawalMeetingPreview }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>{meeting.name}</p>
        <span style={{ flexShrink: 0, fontSize: 12, color: meeting.action === 'manual_review' ? COLORS.error : COLORS.textSecondary }}>
          참여자
        </span>
      </div>
      <p style={{ margin: '8px 0 0', color: '#666', fontSize: 13, lineHeight: 1.55 }}>{ACTION_TEXT[meeting.action]}</p>
      {meeting.authoredExpenseCount > 0 && (
        <p style={{ margin: '6px 0 0', color: COLORS.textSecondary, fontSize: 12 }}>내가 작성한 비용 {meeting.authoredExpenseCount}개</p>
      )}
    </Card>
  )
}

type LocalCleanupStatus = 'idle' | 'cleaning' | 'complete' | 'failed'

function StatusView({ status, error, cleanupStatus, onRetry, onRestart }: {
  status: WithdrawalStatus | null
  error: string
  cleanupStatus: LocalCleanupStatus
  onRetry: () => void
  onRestart: () => void
}) {
  const complete = status?.status === 'complete'
  const failed = status?.status === 'failed' || status?.status === 'preview_stale'
  const progressText = status?.status === 'locking' ? '정산방 변경을 잠그고 있어요.'
    : status?.status === 'processing' ? '방과 비용 데이터를 정리하고 있어요.'
      : status?.status === 'finalizing' ? '계정 삭제를 마무리하고 있어요.'
        : '탈퇴 요청을 안전하게 준비하고 있어요.'
  const title = complete ? '탈퇴가 완료됐어요' : failed ? '탈퇴 처리를 완료하지 못했어요' : '탈퇴 처리 중이에요'
  const description = complete
    ? cleanupStatus === 'failed'
      ? '계정 삭제는 완료됐지만 기기 데이터 정리가 남았어요. 앱을 다시 시작하면 로그인 전에 안전하게 정리해요.'
      : cleanupStatus === 'complete'
        ? '계정과 이 기기에 저장된 관련 데이터가 안전하게 정리됐어요.'
        : '계정 삭제를 완료했고 이 기기에 남은 데이터를 정리하고 있어요.'
    : failed
      ? status?.status === 'preview_stale'
        ? ERROR_TEXT.PREVIEW_STALE
        : `데이터 보호를 위해 처리를 멈췄어요. ${SUPPORT_EMAIL}로 문의해주세요.`
      : '앱을 닫지 말고 잠시만 기다려주세요.'
  return (
    <div style={{ padding: '72px 28px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, margin: '0 auto 22px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: complete ? '#eaf8ef' : failed ? '#fff0f0' : '#eef6ff', color: complete ? COLORS.success : failed ? COLORS.error : COLORS.primary, fontSize: 28, fontWeight: 700 }}>
        {complete ? '✓' : failed ? '!' : <Loader size="small" type="primary" />}
      </div>
      <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
      <p style={{ margin: '12px 0 0', color: '#666', fontSize: 14, lineHeight: 1.65 }}>{description}</p>
      {!complete && !failed && status && (
        <p aria-live="polite" style={{ margin: '10px 0 0', color: COLORS.primary, fontSize: 13 }}>{progressText}</p>
      )}
      {error && <p role="alert" style={{ margin: '18px 0 0', color: COLORS.error, fontSize: 13 }}>{error}</p>}
      {status?.status === 'preview_stale' && (
        <div style={{ marginTop: 24 }}>
          <PrimaryButton onClick={onRetry}>최신 내용 다시 확인</PrimaryButton>
        </div>
      )}
      {complete && cleanupStatus === 'complete' && (
        <div style={{ marginTop: 24 }}>
          <PrimaryButton onClick={onRestart}>새로 시작하기</PrimaryButton>
        </div>
      )}
      {complete && cleanupStatus === 'failed' && (
        <div style={{ marginTop: 24 }}>
          <PrimaryButton onClick={onRestart}>앱 다시 시작하기</PrimaryButton>
        </div>
      )}
    </div>
  )
}

export default function AccountDeletion() {
  const navigate = useNavigate()
  const [preview, setPreview] = useState<WithdrawalPreview | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [request, setRequest] = useState<{ requestId: string; statusToken: string } | null>(null)
  const [status, setStatus] = useState<WithdrawalStatus | null>(null)
  const [cleanupStatus, setCleanupStatus] = useState<LocalCleanupStatus>('idle')
  const cleanupStarted = useRef(false)
  const refreshStatus = useRef<(() => void) | null>(null)

  const hasManualReview = Boolean(preview?.meetings.some((meeting) =>
    meeting.action !== 'preserve_participant_records' && (meeting.action !== 'delete_solo_room' || meeting.role === 'owner')))

  useEffect(() => {
    if (!request) return
    const { requestId, statusToken } = request
    let cancelled = false
    let terminal = false
    let inFlight = false
    let pollImmediately = false
    let delay = 1000
    let timer: number | undefined
    const controller = new AbortController()

    function refresh() {
      window.clearTimeout(timer)
      if (cancelled || terminal || document.hidden) return
      delay = 1000
      if (inFlight) pollImmediately = true
      else void poll()
    }

    async function poll() {
      if (cancelled || terminal || document.hidden || inFlight) return
      inFlight = true
      const startedAt = performance.now()
      try {
        const next = await getWithdrawalStatus(requestId, statusToken, controller.signal)
        if (cancelled) return
        terminal = TERMINAL_STATUSES.has(next.status)
        setStatus(next)
        setError('')
      } catch (pollError) {
        if (!cancelled) {
          setError(errorMessage(pollError))
          delay = Math.max(delay, 3000)
        }
      } finally {
        inFlight = false
        if (!cancelled && !terminal && !document.hidden) {
          if (pollImmediately) {
            pollImmediately = false
            void poll()
          } else {
            timer = window.setTimeout(poll, remainingPollDelay(startedAt, delay))
            delay = Math.min(delay * 2, 8000)
          }
        }
      }
    }

    refreshStatus.current = refresh
    document.addEventListener('visibilitychange', refresh)
    void poll()
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
      refreshStatus.current = null
    }
  }, [request])

  useEffect(() => {
    if (status?.status !== 'complete' || cleanupStarted.current) return
    cleanupStarted.current = true
    let cancelled = false
    setCleanupStatus('cleaning')
    void finalizeLocalAccountDeletion().then(
      () => { if (!cancelled) setCleanupStatus('complete') },
      () => { if (!cancelled) setCleanupStatus('failed') },
    )
    return () => { cancelled = true }
  }, [status?.status])

  async function handlePreview() {
    setLoading(true)
    setError('')
    try {
      const result = await createWithdrawalPreview()
      if ('activeRequestId' in result) {
        setRequest({ requestId: result.activeRequestId, statusToken: '' })
        return
      }
      setPreview(result)
    } catch (previewError) {
      setError(errorMessage(previewError))
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!preview || !agreed || hasManualReview) return
    setLoading(true)
    setError('')
    try {
      const result = await confirmWithdrawal(preview, {})
      setRequest({ requestId: result.requestId, statusToken: result.statusToken })
      setStatus(null)
    } catch (confirmError) {
      const message = errorMessage(confirmError)
      setError(message)
      if (confirmError instanceof AccountDeletionError && [
        'MANIFEST_NOT_FOUND', 'MANIFEST_INVALID_OR_EXPIRED', 'PREVIEW_STALE',
      ].includes(confirmError.code)) {
        setPreview(null)
        setAgreed(false)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleScopeConfirmation() {
    if (!request || !status?.scopeRevision) return
    setLoading(true)
    setError('')
    try {
      await confirmWithdrawalScope(request.requestId, status.scopeRevision)
      refreshStatus.current?.()
    } catch (confirmationError) {
      setError(errorMessage(confirmationError))
    } finally {
      setLoading(false)
    }
  }

  if (status?.status === 'awaiting_reconfirmation') {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>삭제 범위 확인</Top.TitleParagraph>} />
        <main style={{ padding: 24 }}>
          <p>‘{status.scopeMeetingName}’에 나만 남았어요. 탈퇴를 계속하면 이 방과 지출 기록, 대표 사진이 모두 삭제돼요.</p>
          <p>확인할 때까지 탈퇴 처리가 멈춰요.</p>
          {error && <p role="alert">{error}</p>}
          <PrimaryButton disabled={loading} onClick={handleScopeConfirmation}>이 방도 삭제하고 탈퇴 계속하기</PrimaryButton>
        </main>
      </>
    )
  }

  if (request) {
    return (
      <>
        <Top title={<Top.TitleParagraph size={22}>회원 탈퇴</Top.TitleParagraph>} />
        <StatusView
          status={status}
          error={error}
          cleanupStatus={cleanupStatus}
          onRetry={() => {
            setRequest(null)
            setStatus(null)
            setPreview(null)
            setAgreed(false)
            setError('')
          }}
          onRestart={() => window.location.replace('/')}
        />
      </>
    )
  }

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>회원 탈퇴</Top.TitleParagraph>} />
      <main style={{ padding: '20px 20px 48px' }}>
        {!preview ? (
          <>
            <h2 style={{ margin: '8px 0 12px', fontSize: 22 }}>탈퇴 전 안내</h2>
            <p style={{ margin: 0, color: '#555', fontSize: 14, lineHeight: 1.7 }}>
              회원 탈퇴 후에는 계정과 삭제된 데이터를 복구할 수 없어요. 참여한 정산방은 아래와 같이 처리돼요.
            </p>
            <ul style={{ margin: '24px 0', paddingLeft: 20, color: '#555', fontSize: 14, lineHeight: 1.9 }}>
              <li>혼자 사용한 정산방은 비용 내역과 사진까지 모두 삭제돼요.</li>
              <li>
                다른 참여자가 있는 정산방은 유지돼요. 기존 형식의 방은 방장 권한 이전이 필요할 수 있어요.
              </li>
              <li>완료된 정산 기록은 유지되지만 내 정보는 알아볼 수 없도록 처리돼요.</li>
            </ul>
            <PrimaryButton disabled={loading} onClick={handlePreview}>
              {loading ? '확인 중...' : '계속하기'}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              style={{
                width: '100%',
                height: 52,
                marginTop: 8,
                border: 0,
                background: 'transparent',
                color: '#6B7684',
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              닫기
            </button>
          </>
        ) : (
          <>
            <Summary preview={preview} />
            <p style={{ margin: '10px 2px 0', color: COLORS.textSecondary, fontSize: 12 }}>
              이 확인 내용은 15분 동안 유효해요.
            </p>
            <p style={{ margin: '26px 0 10px', fontSize: 15, fontWeight: 700 }}>정산방별 처리 내용</p>
            <div style={{ display: 'grid', gap: 10 }}>
              {preview.meetings.map((meeting) => (
                <MeetingCard
                  key={meeting.meetingId}
                  meeting={meeting}
                />
              ))}
            </div>
            {hasManualReview ? (
              <div role="alert" style={{ marginTop: 18, padding: 16, borderRadius: 12, background: '#fff3f3', color: '#b42318', fontSize: 13, lineHeight: 1.6 }}>
                자동으로 안전하게 처리할 수 없는 방이 있어요. 탈퇴를 진행하지 않고 멈췄습니다. {SUPPORT_EMAIL}로 문의해주세요.
              </div>
            ) : (
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '24px 0 18px', color: '#444', fontSize: 14, lineHeight: 1.55 }}>
                <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} style={{ width: 20, height: 20, margin: 0, flexShrink: 0 }} />
                삭제되는 데이터는 복구할 수 없으며 위 내용을 모두 확인했어요.
              </label>
            )}
            <PrimaryButton danger disabled={loading || !agreed || hasManualReview} onClick={handleConfirm}>
              {loading ? '탈퇴 요청 중...' : '탈퇴하기'}
            </PrimaryButton>
            <button type="button" disabled={loading} onClick={handlePreview} style={{ width: '100%', marginTop: 10, padding: 14, border: 0, background: 'none', color: COLORS.textSecondary, fontSize: 14 }}>최신 내용 다시 확인</button>
          </>
        )}
        {error && <p role="alert" style={{ margin: '16px 0 0', color: COLORS.error, textAlign: 'center', fontSize: 13, lineHeight: 1.5 }}>{error}</p>}
      </main>
    </>
  )
}
