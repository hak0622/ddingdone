import { participantRoomRequest } from '../lib/participantRooms'
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Top } from '@toss/tds-mobile'
import { doc, serverTimestamp, runTransaction } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useMeeting } from '../hooks/useMeeting'

const CATEGORIES = [
  { id: '식비', emoji: '🍖' },
  { id: '카페', emoji: '☕' },
  { id: '숙소', emoji: '🏨' },
  { id: '교통', emoji: '🚕' },
  { id: '기타', emoji: '🎟️' },
]

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export default function ExpenseInput() {
  const { id: meetingId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('editId')
  // 정산 완료 여부, 수정할 비용 데이터 모두 같은 모임을 보고 있는 다른 화면
  // (상세 등)과 공유되는 구독에서 그대로 가져온다 — 화면마다 따로 getDoc을
  // 또 호출할 필요가 없다.
  const { meeting, members, expenses, expensesReady, loading, error: meetingError, access } = useMeeting(meetingId)

  const myId = access?.participantId ?? ''
  const currentIds = Object.keys(members).sort()
  const target = expenses.find((expense) => expense.id === editId)
  const locked = !!target && [target.paidBy, ...(target.splitMemberUids ?? [])].some((id) => !members[id])
  const pendingCreation = useRef<{ action: string; expenseId: string; requestId: string; amount: number; category: string; memo: string; participantIds: string[] }>()

  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [originalAmount, setOriginalAmount] = useState(0)
  const [editLoaded, setEditLoaded] = useState(!editId)
  const [splitDraft, setSplitDraft] = useState<{ formKey: string; excluded: string[] }>()
  const originalRef = useRef<{ category: string; memo: string; splitMemberUids?: string[]; revision?: string }>({ category: '', memo: '' })
  const originalSplit = originalRef.current.splitMemberUids
  const showSplitPreview = !loading && editLoaded && currentIds.includes(myId)
  const canSelectSplit = !locked
  const splitMemberIds = showSplitPreview && meeting
    ? [myId, ...currentIds.filter((memberId) => memberId !== myId)]
    : []
  const formKey = `${meetingId ?? ''}/${editId ?? ''}`
  const defaultExcluded = originalSplit ? splitMemberIds.filter((id) => !originalSplit.includes(id)) : []
  const excludedMembers = splitDraft?.formKey === formKey ? splitDraft.excluded : defaultExcluded
  const selectedMemberIds = [...new Set([...(originalSplit ?? []), ...currentIds])]
    .filter((memberId) => currentIds.includes(memberId) && !excludedMembers.includes(memberId))
  const splitInvalid = !locked && showSplitPreview && !selectedMemberIds.length
  // 수정 모드에서 처음 불러온 값을 기억해, 제출 시 실제로 바뀐 게 있는지
  // 비교한다 — 아무것도 안 바꾸고 수정하기를 눌러도 쓰기가 나가지 않게 한다.
  // paidBy는 항상 본인이라 비교 대상에서 제외한다 — 다른 사람 비용을 대신
  // 추가/수정할 수 없게 하라는 실제 사용자 피드백에 따라 결제자 선택 UI를 없앴다.
  // expenses는 다른 멤버가 아무 비용이나 추가/수정/삭제할 때마다 새 배열로
  // 갱신된다. 한 번 폼에 채워 넣은 뒤에는 다시 채우면 안 된다 — 안 그러면
  // 수정 중인 화면에서 남이 다른 비용을 건드릴 때마다 입력 중인 값이
  // 원래 저장된 값으로 되돌아가 버린다.
  const seededRef = useRef<string>()

  useEffect(() => {
    if (!loading && meeting?.status === 'settled') navigate(-1)
  }, [loading, meeting, navigate])

  useEffect(() => {
    if (!editId || !expensesReady || loading || !myId || seededRef.current === formKey) return
    seededRef.current = formKey
    const target = expenses.find((e) => e.id === editId)
    // 존재하지 않거나 본인 비용이 아니면(다른 사람 비용 수정 링크에 직접
    // 들어온 경우 포함) 막는다 — 본인 비용만 수정할 수 있다.
    if (!target || target.createdBy !== myId) {
      navigate(-1)
      return
    }
    setAmount(String(target.amount))
    setOriginalAmount(target.amount)
    setCategory(target.category)
    originalRef.current = { category: target.category, memo: target.memo, splitMemberUids: target.splitMemberUids, revision: target.revision }
    setEditLoaded(true)
  }, [editId, expenses, expensesReady, formKey, loading, myId, navigate])

  // 한 건당 지출은 999만 9999원까지만 받는다 — 친구끼리 더치페이하는 항목
  // 단위로는 충분히 넉넉한 한도이면서, 자릿수를 7자리로 고정해 입력창이
  // 항상 같은 폭에서 잘리지 않고 보이게 한다.
  const MAX_AMOUNT_DIGITS = 7

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, MAX_AMOUNT_DIGITS)
    setAmount(raw)
  }

  function getDisplayAmount(): string {
    if (!amount) return ''
    return Number(amount).toLocaleString('ko-KR')
  }

  async function handleSubmit() {
    if (Number(amount) === 0 || !myId || !meetingId || submitting || splitInvalid || meetingError || !expensesReady) return
    if (editId) {
      const original = originalRef.current
      const unchanged = Number(amount) === originalAmount && category === original.category &&
        (locked || !original.splitMemberUids || sameIds(selectedMemberIds, original.splitMemberUids))
      if (unchanged) {
        navigate(-1)
        return
      }
    }
    setSubmitting(true)
    setError('')
    try {
      const meetingRef = doc(db, 'meetings', meetingId)
      const original = originalRef.current
      const metadataOnly = editId && Number(amount) === originalAmount &&
        (locked || sameIds(selectedMemberIds, original.splitMemberUids ?? []))
      if (metadataOnly) {
        const expenseRef = doc(meetingRef, 'expenses', editId)
        await runTransaction(db, async (transaction) => {
          const existing = (await transaction.get(expenseRef)).data()
          if (!existing || existing.revision !== original.revision) throw new Error('EXPENSE_CHANGED')
          transaction.update(expenseRef, { category, updatedAt: serverTimestamp(), revision: crypto.randomUUID() })
        })
      } else {
        const expenseId = editId ?? pendingCreation.current?.expenseId ?? crypto.randomUUID()
        const fields = { amount: Number(amount), category, memo: editId ? original.memo : '', participantIds: [...selectedMemberIds] }
        const payload = editId
          ? { ...fields, action: 'edit', expenseId, requestId: crypto.randomUUID(), revision: original.revision }
          : (pendingCreation.current ??= { ...fields, action: 'create', expenseId, requestId: expenseId })
        await participantRoomRequest(meetingId, 'expense', payload)
      }
      navigate(-1)
    } catch (cause) {
      setError(cause instanceof Error && ['MEMBERS_CHANGED', 'ROOM_CHANGED', 'EXPENSE_LOCKED'].includes(cause.message)
        ? '참여자가 바뀌었어요. 함께 나눌 사람을 다시 확인해 주세요.'
        : cause instanceof Error && cause.message === 'EXPENSE_CHANGED'
          ? '비용이 바뀌었어요. 목록에서 다시 열어주세요.'
          : editId ? '비용을 수정하지 못했어요. 다시 시도해주세요.' : '비용을 추가하지 못했어요. 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  const isValid = Number(amount) > 0 && !submitting && editLoaded && !splitInvalid && !!myId && !meetingError && expensesReady

  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>{editId ? '비용 수정' : '비용 추가'}</Top.TitleParagraph>} />
      <div style={{ padding: '0 20px 32px' }}>

        {/* 금액 */}
        <div style={{ textAlign: 'center', padding: '20px 0 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
            <input
              style={{
                fontSize: 40,
                fontWeight: 700,
                border: 'none',
                outline: 'none',
                textAlign: 'right',
                background: 'transparent',
                // "9,999,999"(최대 7자리 + 콤마 2개)까지 잘리지 않을 만큼의 폭을
                // 고정폭(ch)으로 잡아둔다 — %는 화면 폭에 따라 달라져서 정확한
                // 보장이 안 된다.
                width: '11ch',
                maxWidth: '70%',
                color: '#191919',
              }}
              placeholder="0"
              value={getDisplayAmount()}
              onChange={handleAmountChange}
              readOnly={locked}
              inputMode="numeric"
            />
            <span style={{ fontSize: 24, fontWeight: 700, color: '#191919' }}>원</span>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #f0f0f0', margin: '0 -20px 20px' }} />

        {/* 카테고리 — 한 줄 */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#888', margin: '0 0 8px' }}>카테고리</p>
          <div style={{ display: 'flex', gap: 6 }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id === category ? '' : cat.id)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  background: category === cat.id ? '#3182F6' : '#f5f5f5',
                  color: category === cat.id ? '#fff' : '#555',
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 2 }}>{cat.emoji}</div>
                {cat.id}
              </button>
            ))}
          </div>
        </div>

        {locked && <p style={{ fontSize: 13, color: '#6b7684' }}>기존 분담 기록이 보존되어 금액과 분담 대상을 변경할 수 없어요.</p>}
        {showSplitPreview && !locked && (
          <div style={{ marginBottom: 20 }}>
            <p id="split-members-label" style={{ fontSize: 13, fontWeight: 600, color: '#888', margin: '0 0 8px' }}>
              함께 나눌 사람
            </p>
            <div role="group" aria-labelledby="split-members-label" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {splitMemberIds.map((memberUid) => {
                const selected = !excludedMembers.includes(memberUid)
                return (
                  <button
                    key={memberUid}
                    type="button"
                    aria-pressed={selected}
                    disabled={submitting || !canSelectSplit}
                    onClick={() => setSplitDraft({
                      formKey,
                      excluded: selected
                        ? [...excludedMembers, memberUid]
                        : excludedMembers.filter((excludedUid) => excludedUid !== memberUid),
                    })}
                    style={{
                      padding: '10px 22px',
                      borderRadius: 24,
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 15,
                      fontWeight: 600,
                      background: selected ? '#3182F6' : '#f5f5f5',
                      color: selected ? '#fff' : '#555',
                    }}
                  >
                    {memberUid === myId ? '나' : (members[memberUid] ?? '참여자')}
                  </button>
                )
              })}
            </div>
            {editId && !canSelectSplit && (
              <p style={{ fontSize: 13, color: '#6B7684', margin: '8px 0 0' }}>
                기존 비용은 모임 전체가 나눠요.
              </p>
            )}
            {splitInvalid && (
              <p role="status" style={{ fontSize: 13, color: '#6B7684', margin: '8px 0 0' }}>
                {selectedMemberIds.length === 0
                  ? '함께 나눌 사람을 한 명 이상 선택해 주세요.'
                  : '이 모임에서는 아직 일부 인원만 선택해 저장할 수 없어요.'}
              </p>
            )}
          </div>
        )}

        {error && (
          <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '12px 0 0', margin: 0 }}>
            {error}
          </p>
        )}
        <button
          disabled={!isValid}
          onClick={handleSubmit}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 24,
            height: 56,
            background: isValid ? '#3182F6' : '#e0e0e0',
            color: isValid ? '#fff' : '#aaa',
            border: 'none',
            borderRadius: 12,
            fontSize: 17,
            fontWeight: 600,
            cursor: isValid ? 'pointer' : 'default',
          }}
        >
          {editId ? (submitting ? '수정 중...' : '수정하기') : (submitting ? '추가 중...' : '추가하기')}
        </button>
      </div>
    </>
  )
}
