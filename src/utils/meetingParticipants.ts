export const UNKNOWN_PARTICIPANT_NAME = '알 수 없음'

export interface MeetingParticipant {
  name: string | null
  departureVersion: number
  status: 'active' | 'left' | 'withdrawn'
}

export type MeetingParticipants = Record<string, MeetingParticipant>

export function participantDisplayName(participants: MeetingParticipants, id: string): string {
  const participant = participants[id]
  return participant?.status === 'active' && participant.name ? participant.name : UNKNOWN_PARTICIPANT_NAME
}

export type ExpenseParticipation = Readonly<Record<string, number>>

export function captureExpenseParticipation(
  participants: MeetingParticipants,
  payerId: string,
  splitParticipantIds: readonly string[],
): ExpenseParticipation {
  return Object.fromEntries([...new Set([payerId, ...splitParticipantIds])].map((id) => {
    const participant = participants[id]
    if (participant?.status !== 'active') throw new Error('PARTICIPANT_NOT_ACTIVE')
    return [id, participant.departureVersion]
  }))
}

export function isExpenseFinanciallyLocked(
  participants: MeetingParticipants,
  participation: ExpenseParticipation,
): boolean {
  return Object.entries(participation).some(([id, version]) => {
    const participant = participants[id]
    return participant?.status !== 'active' || participant.departureVersion !== version
  })
}

export function markParticipantDeparture(
  participant: MeetingParticipant,
  reason: 'leave' | 'withdraw',
): MeetingParticipant {
  if (participant.status === 'withdrawn' || (participant.status === 'left' && reason === 'leave')) return participant
  return {
    name: null,
    status: reason === 'withdraw' ? 'withdrawn' : 'left',
    departureVersion: participant.departureVersion + Number(participant.status === 'active'),
  }
}

export function restoreParticipant(participant: MeetingParticipant, savedName: string): MeetingParticipant {
  if (participant.status === 'withdrawn') throw new Error('PARTICIPANT_WITHDRAWN')
  return { ...participant, name: savedName, status: 'active' }
}
