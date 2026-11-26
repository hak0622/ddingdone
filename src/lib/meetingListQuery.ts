import { collection, documentId, endBefore, limit, limitToLast, orderBy, query, startAfter, where, type Firestore, type QueryConstraint } from 'firebase/firestore'

export type MeetingStatusFilter = 'all' | 'active' | 'settled'
export type MeetingCursor = readonly [date: string, id: string]
export type HistoryPage = { direction: 'after' | 'before'; cursor: MeetingCursor }
export type MeetingListScope =
  | { kind: 'home'; start: string; end: string }
  | { kind: 'legacy-history' }
  | { kind: 'history'; filter: MeetingStatusFilter; newest: boolean; page: HistoryPage | null }

export const PAGE_SIZE = 20
export function meetingListQuery(db: Firestore, uid: string, scope: MeetingListScope) {
  const constraints: QueryConstraint[] = [where('memberUids', 'array-contains', uid)]
  if (scope.kind === 'home') {
    constraints.push(where('date', '>=', scope.start), where('date', '<', scope.end), orderBy('date', 'asc'))
  } else if (scope.kind === 'history') {
    if (scope.filter !== 'all') constraints.push(where('status', '==', scope.filter))
    const direction = scope.newest ? 'desc' : 'asc'
    constraints.push(orderBy('date', direction), orderBy(documentId(), direction))
    if (scope.page?.direction === 'before') {
      constraints.push(endBefore(...scope.page.cursor), limitToLast(PAGE_SIZE + 1))
    } else {
      if (scope.page) constraints.push(startAfter(...scope.page.cursor))
      constraints.push(limit(PAGE_SIZE + 1))
    }
  }
  return query(collection(db, 'meetings'), ...constraints)
}
