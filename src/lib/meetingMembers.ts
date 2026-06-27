import { collection, doc, getDocs, increment, query, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

export function generatePreMemberId(): string {
  return `pre_${Math.random().toString(36).slice(2, 9)}`
}

// 아직 토스 계정으로 들어오지 않은 참여자를 placeholder로 추가
export async function addPreMember(meetingId: string, nickname: string): Promise<void> {
  const batch = writeBatch(db)
  batch.set(doc(db, 'meetings', meetingId, 'members', generatePreMemberId()), { nickname })
  batch.update(doc(db, 'meetings', meetingId), { memberCount: increment(1) })
  await batch.commit()
}

// placeholder 참여자 삭제 (해당 참여자가 결제한 것으로 기록된 지출도 함께 삭제)
export async function deletePreMember(meetingId: string, preUid: string): Promise<void> {
  const expensesSnap = await getDocs(
    query(collection(db, 'meetings', meetingId, 'expenses'), where('paidBy', '==', preUid)),
  )
  const totalToRemove = expensesSnap.docs.reduce((sum, d) => sum + (d.data().amount ?? 0), 0)

  const batch = writeBatch(db)
  expensesSnap.docs.forEach((d) => batch.delete(d.ref))
  batch.delete(doc(db, 'meetings', meetingId, 'members', preUid))
  batch.update(doc(db, 'meetings', meetingId), {
    memberCount: increment(-1),
    totalAmount: increment(-totalToRemove),
    expenseCount: increment(-expensesSnap.size),
  })
  await batch.commit()
}
