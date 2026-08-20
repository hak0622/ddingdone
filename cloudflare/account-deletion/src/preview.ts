import { sha256Hex, stableStringify } from './crypto'
import {
  WITHDRAWAL_MANIFEST_SCHEMA_VERSION,
  type FirestoreRecord,
  type MeetingSource,
  type MeetingStatus,
  type PreviewIssue,
  type WithdrawalMeetingPreview,
  type WithdrawalPreview,
} from './types'

const KNOWN_CHILD_COLLECTIONS = new Set(['expenses', 'members', 'settlements'])

function stringField(record: FirestoreRecord, field: string): string | null {
  const value = record.data[field]
  return typeof value === 'string' ? value : null
}

function numberField(record: FirestoreRecord, field: string): number | null {
  const value = record.data[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArrayField(record: FirestoreRecord, field: string): string[] {
  const value = record.data[field]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((uid) => rightSet.has(uid))
}

function expenseAuthor(expense: FirestoreRecord): string | null {
  return stringField(expense, 'createdBy') ?? stringField(expense, 'paidBy')
}

function nicknameFor(members: FirestoreRecord[], uid: string): string {
  const member = members.find((candidate) => candidate.id === uid)
  return member ? stringField(member, 'nickname') ?? '이름 없음' : '이름 없음'
}

function statusOf(meeting: FirestoreRecord): MeetingStatus {
  return stringField(meeting, 'status') === 'settled' ? 'settled' : 'active'
}

function calculateTransfers(
  participantIds: string[],
  paidTotals: Record<string, number>,
  totalAmount: number,
): Array<{ from: string; to: string; amount: number }> {
  if (participantIds.length === 0 || totalAmount === 0) return []
  const baseShare = Math.floor(totalAmount / participantIds.length)
  const remainder = totalAmount - baseShare * participantIds.length
  const creditors: Array<{ uid: string; amount: number }> = []
  const debtors: Array<{ uid: string; amount: number }> = []

  participantIds.forEach((participantUid, index) => {
    const balance = (paidTotals[participantUid] ?? 0) - (index < remainder ? baseShare + 1 : baseShare)
    if (balance > 0) creditors.push({ uid: participantUid, amount: balance })
    else if (balance < 0) debtors.push({ uid: participantUid, amount: -balance })
  })

  const transfers: Array<{ from: string; to: string; amount: number }> = []
  let creditorIndex = 0
  let debtorIndex = 0
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex]
    const debtor = debtors[debtorIndex]
    if (!creditor || !debtor) break
    const amount = Math.min(creditor.amount, debtor.amount)
    if (amount >= 1) transfers.push({ from: debtor.uid, to: creditor.uid, amount })
    creditor.amount -= amount
    debtor.amount -= amount
    if (creditor.amount === 0) creditorIndex += 1
    if (debtor.amount === 0) debtorIndex += 1
  }
  return transfers
}

function expectedSnapshotCore(source: MeetingSource): Record<string, unknown> | null {
  const participantIds = stringArrayField(source.meeting, 'memberUids')
  const participantNames: Record<string, string> = {}
  const participantPaidTotals: Record<string, number> = {}
  for (const participantUid of participantIds) {
    const member = source.members.find((candidate) => candidate.id === participantUid)
    const nickname = member ? stringField(member, 'nickname') : null
    if (!nickname) return null
    participantNames[participantUid] = nickname
    participantPaidTotals[participantUid] = 0
  }

  let totalAmount = 0
  for (const expense of source.expenses) {
    const amount = numberField(expense, 'amount')
    const paidBy = stringField(expense, 'paidBy')
    if (!Number.isInteger(amount) || amount === null || amount <= 0 || !paidBy || !(paidBy in participantPaidTotals)) {
      return null
    }
    totalAmount += amount
    participantPaidTotals[paidBy] = (participantPaidTotals[paidBy] ?? 0) + amount
  }

  return {
    schemaVersion: 1,
    totalAmount,
    participantCount: participantIds.length,
    participantIds,
    participantNames,
    participantPaidTotals,
    transfers: calculateTransfers(participantIds, participantPaidTotals, totalAmount),
  }
}

function storedSnapshotCore(settlement: FirestoreRecord): Record<string, unknown> {
  return {
    schemaVersion: settlement.data.schemaVersion,
    totalAmount: settlement.data.totalAmount,
    participantCount: settlement.data.participantCount,
    participantIds: settlement.data.participantIds,
    participantNames: settlement.data.participantNames,
    participantPaidTotals: settlement.data.participantPaidTotals,
    transfers: settlement.data.transfers,
  }
}

function recordField(record: FirestoreRecord, field: string): Record<string, unknown> | null {
  const value = record.data[field]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isValidAnonymizedSnapshot(
  source: MeetingSource,
  expectedCurrent: Record<string, unknown>,
): boolean {
  if (!source.settlement) return false
  const memberUids = stringArrayField(source.meeting, 'memberUids')
  const participantIds = stringArrayField(source.settlement, 'participantIds')
  const participantNames = recordField(source.settlement, 'participantNames')
  const paidTotals = recordField(source.settlement, 'participantPaidTotals')
  const transfers = source.settlement.data.transfers
  const anonymousIds = participantIds.filter((participantUid) => participantUid.startsWith('withdrawn_'))
  const currentParticipantIds = participantIds.filter((participantUid) => !participantUid.startsWith('withdrawn_'))
  if (
    anonymousIds.length === 0 ||
    stableStringify(currentParticipantIds) !== stableStringify(memberUids) ||
    !participantNames || !paidTotals || !Array.isArray(transfers) ||
    source.settlement.data.schemaVersion !== 1 ||
    source.settlement.data.participantCount !== participantIds.length ||
    source.settlement.data.anonymizedParticipantCount !== anonymousIds.length ||
    new Set(participantIds).size !== participantIds.length ||
    !sameMembers(participantIds, Object.keys(participantNames)) ||
    !sameMembers(participantIds, Object.keys(paidTotals))
  ) return false

  const expectedNames = expectedCurrent.participantNames
  const expectedPaidTotals = expectedCurrent.participantPaidTotals
  if (!expectedNames || typeof expectedNames !== 'object' || Array.isArray(expectedNames) ||
      !expectedPaidTotals || typeof expectedPaidTotals !== 'object' || Array.isArray(expectedPaidTotals)) {
    return false
  }
  for (const memberUid of memberUids) {
    if (
      participantNames[memberUid] !== (expectedNames as Record<string, unknown>)[memberUid] ||
      paidTotals[memberUid] !== (expectedPaidTotals as Record<string, unknown>)[memberUid]
    ) return false
  }
  for (const anonymousId of anonymousIds) {
    if (participantNames[anonymousId] !== '탈퇴한 사용자' ||
        typeof paidTotals[anonymousId] !== 'number' ||
        !Number.isInteger(paidTotals[anonymousId]) || (paidTotals[anonymousId] as number) < 0) {
      return false
    }
  }
  const paidTotalSum = Object.values(paidTotals).reduce<number>(
    (sum, value) => typeof value === 'number' && Number.isInteger(value) ? sum + value : Number.NaN,
    0,
  )
  if (
    !Number.isFinite(paidTotalSum) ||
    paidTotalSum !== source.settlement.data.totalAmount ||
    source.meeting.data.totalAmount !== source.settlement.data.totalAmount ||
    source.meeting.data.expenseCount !== source.expenses.length
  ) return false

  return transfers.every((transfer) => {
    if (!transfer || typeof transfer !== 'object' || Array.isArray(transfer)) return false
    const record = transfer as Record<string, unknown>
    return typeof record.from === 'string' && participantIds.includes(record.from) &&
      typeof record.to === 'string' && participantIds.includes(record.to) &&
      typeof record.amount === 'number' && Number.isInteger(record.amount) && record.amount > 0
  })
}

async function collectIssues(uid: string, source: MeetingSource): Promise<PreviewIssue[]> {
  const issues = new Set<PreviewIssue>()
  const memberUids = stringArrayField(source.meeting, 'memberUids')
  const memberIds = source.members.map((member) => member.id)
  const creator = stringField(source.meeting, 'createdBy')
  const declaredMemberCount = numberField(source.meeting, 'memberCount')
  const rawStatus = stringField(source.meeting, 'status')
  const rawMemberUids = source.meeting.data.memberUids
  const expectedSnapshot = expectedSnapshotCore(source)

  if (rawStatus !== 'active' && rawStatus !== 'settled') issues.add('INVALID_MEETING_STATUS')
  if (!Array.isArray(rawMemberUids) || rawMemberUids.some((value) => typeof value !== 'string')) {
    issues.add('MEMBER_DOCUMENTS_MISMATCH')
  }
  if (!creator || !memberUids.includes(creator)) issues.add('CREATOR_NOT_MEMBER')
  if (declaredMemberCount !== memberUids.length) issues.add('MEMBER_COUNT_MISMATCH')
  if (!sameMembers(memberUids, memberIds)) issues.add('MEMBER_DOCUMENTS_MISMATCH')
  if (source.expenses.some((expense) => !expenseAuthor(expense))) issues.add('EXPENSE_OWNER_UNKNOWN')
  if (source.expenses.some((expense) => {
    const createdBy = stringField(expense, 'createdBy')
    const paidBy = stringField(expense, 'paidBy')
    return createdBy !== null && createdBy !== paidBy
  })) issues.add('EXPENSE_OWNERSHIP_MISMATCH')
  if (!expectedSnapshot) issues.add('EXPENSE_DATA_INVALID')
  const hasAnonymousSnapshot = source.settlement
    ? stringArrayField(source.settlement, 'participantIds').some((participantUid) =>
        participantUid.startsWith('withdrawn_'))
    : false
  if (expectedSnapshot && !hasAnonymousSnapshot && (
    numberField(source.meeting, 'totalAmount') !== expectedSnapshot.totalAmount ||
    numberField(source.meeting, 'expenseCount') !== source.expenses.length
  )) issues.add('MEETING_AGGREGATES_MISMATCH')
  const photoPublicId = stringField(source.meeting, 'photoPublicId')
  if (photoPublicId && !photoPublicId.startsWith(`ddingdone/${source.meeting.id}/`)) {
    issues.add('PHOTO_REFERENCE_INVALID')
  }
  if (source.childCollectionIds.some((id) => !KNOWN_CHILD_COLLECTIONS.has(id))) {
    issues.add('UNKNOWN_CHILD_COLLECTION')
  }

  if (statusOf(source.meeting) === 'settled') {
    if (!source.settlement) {
      issues.add('SETTLEMENT_SNAPSHOT_MISSING')
    } else {
      const participants = stringArrayField(source.settlement, 'participantIds')
      if (!hasAnonymousSnapshot && stableStringify(memberUids) !== stableStringify(participants)) {
        issues.add('SETTLEMENT_PARTICIPANTS_MISMATCH')
      }
      if (expectedSnapshot) {
        const storedCore = storedSnapshotCore(source.settlement)
        const storedHash = stringField(source.settlement, 'hash')
        const computedStoredHash = await sha256Hex(stableStringify(storedCore))
        const contentMatches = hasAnonymousSnapshot
          ? isValidAnonymizedSnapshot(source, expectedSnapshot)
          : stableStringify(expectedSnapshot) === stableStringify(storedCore)
        if (
          !contentMatches ||
          !storedHash || storedHash !== computedStoredHash
        ) issues.add('SETTLEMENT_SNAPSHOT_INVALID')
      }
    }
  } else if (source.settlement) {
    issues.add('UNEXPECTED_SETTLEMENT_SNAPSHOT')
  }

  // 쿼리 조건과 원본 문서가 불일치하면 미리보기가 탈퇴자의 방을 잘못 분류한 것이다.
  if (!memberUids.includes(uid)) issues.add('MEMBER_DOCUMENTS_MISMATCH')
  return [...issues].sort()
}

function canSafelyDeleteSoloRoom(uid: string, source: MeetingSource, issues: PreviewIssue[]): boolean {
  const memberUids = stringArrayField(source.meeting, 'memberUids')
  const snapshotParticipants = source.settlement
    ? stringArrayField(source.settlement, 'participantIds')
    : []
  const allExpensesOwned = source.expenses.every(
    (expense) => expenseAuthor(expense) === uid && stringField(expense, 'paidBy') === uid,
  )
  const snapshotSafe = !source.settlement || (
    snapshotParticipants.length === 1 && snapshotParticipants[0] === uid
  )
  return issues.length === 0 &&
    stringField(source.meeting, 'createdBy') === uid &&
    memberUids.length === 1 && memberUids[0] === uid &&
    source.members.length === 1 && source.members[0]?.id === uid &&
    allExpensesOwned && snapshotSafe
}

async function previewMeeting(uid: string, source: MeetingSource): Promise<WithdrawalMeetingPreview> {
  const meeting = source.meeting
  const memberUids = stringArrayField(meeting, 'memberUids')
  const otherMemberUids = memberUids.filter((memberUid) => memberUid !== uid)
  const status = statusOf(meeting)
  const isOwner = stringField(meeting, 'createdBy') === uid
  const issues = await collectIssues(uid, source)
  const solo = otherMemberUids.length === 0
  const safeSoloDelete = solo && canSafelyDeleteSoloRoom(uid, source, issues)
  const successorCandidates = isOwner
    ? otherMemberUids.map((candidateUid) => ({
        uid: candidateUid,
        nickname: nicknameFor(source.members, candidateUid),
      }))
    : []
  const authoredExpenseCount = source.expenses.filter(
    (expense) => expenseAuthor(expense) === uid,
  ).length

  let action: WithdrawalMeetingPreview['action']
  if (solo) action = safeSoloDelete ? 'delete_solo_room' : 'manual_review'
  else if (issues.length > 0) action = 'manual_review'
  else action = status === 'settled' ? 'anonymize_settled_shared' : 'leave_active_shared'

  return {
    meetingId: meeting.id,
    name: stringField(meeting, 'name') ?? '이름 없는 정산방',
    status,
    role: isOwner ? 'owner' : 'member',
    memberCount: memberUids.length,
    authoredExpenseCount,
    action,
    issues,
    successorRequired: isOwner && successorCandidates.length > 1,
    automaticSuccessorUid: isOwner && successorCandidates.length === 1
      ? successorCandidates[0]?.uid ?? null
      : null,
    successorCandidates,
    deletesCloudinaryPhoto: action === 'delete_solo_room' && Boolean(stringField(meeting, 'photoPublicId')),
  }
}

export async function buildWithdrawalPreview(uid: string, sources: MeetingSource[]): Promise<WithdrawalPreview> {
  const meetings = (await Promise.all(sources.map((source) => previewMeeting(uid, source))))
    .sort((left, right) => left.meetingId.localeCompare(right.meetingId))

  return {
    schemaVersion: WITHDRAWAL_MANIFEST_SCHEMA_VERSION,
    summary: {
      meetingCount: meetings.length,
      sharedMeetingCount: meetings.filter((meeting) => meeting.memberCount > 1).length,
      soloMeetingCountToDelete: meetings.filter((meeting) => meeting.action === 'delete_solo_room').length,
      activeExpenseCountToDelete: meetings
        .filter((meeting) => meeting.status === 'active' && meeting.action !== 'manual_review')
        .reduce((sum, meeting) => sum + meeting.authoredExpenseCount, 0),
      settledExpenseCountToDelete: meetings
        .filter((meeting) => meeting.status === 'settled' && meeting.action !== 'manual_review')
        .reduce((sum, meeting) => sum + meeting.authoredExpenseCount, 0),
      settledMeetingCountToAnonymize: meetings.filter(
        (meeting) => meeting.action === 'anonymize_settled_shared',
      ).length,
      ownershipTransferCount: meetings.filter(
        (meeting) => meeting.role === 'owner' && meeting.memberCount > 1 && meeting.action !== 'manual_review',
      ).length,
      cloudinaryPhotoCountToDelete: meetings.filter((meeting) => meeting.deletesCloudinaryPhoto).length,
      manualReviewMeetingCount: meetings.filter((meeting) => meeting.action === 'manual_review').length,
    },
    meetings,
  }
}

export function withdrawalSourceHashInput(sources: MeetingSource[]): string {
  const normalized = [...sources]
    .sort((left, right) => left.meeting.id.localeCompare(right.meeting.id))
    .map((source) => ({
      // Workflow가 방 잠금 필드를 추가하면 meeting의 updateTime도 바뀐다.
      // 탈퇴 원본 자체만 비교할 수 있도록 잠금 필드와 Firestore 메타 시간은
      // 해시에서 제외한다. 같은 내용으로 문서를 다시 만든 경우도 처리 결과는 같다.
      meeting: {
        id: source.meeting.id,
        data: Object.fromEntries(
          Object.entries(source.meeting.data)
            .filter(([key]) => key !== 'withdrawalLockRequestId'),
        ),
      },
      members: [...source.members]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id, data }) => ({ id, data })),
      expenses: [...source.expenses]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id, data }) => ({ id, data })),
      settlement: source.settlement
        ? { id: source.settlement.id, data: source.settlement.data }
        : null,
      childCollectionIds: [...source.childCollectionIds].sort(),
    }))
  return stableStringify(normalized)
}
