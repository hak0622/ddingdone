import { getIdToken, useFirebaseEmulators } from './firebase'

export type RoomAccess = { mode: 'legacy' } | {
  mode: 'participants'
  name: string
  canJoin: boolean
  participantId?: string
  modelVersion?: number
  departureVersion: number | null
}

export async function participantRoomRequest<T>(
  id: string | null, action: 'access' | 'join' | 'leave' | 'expense' | 'settle' | 'create', body?: object,
): Promise<T> {
  const url = useFirebaseEmulators ? 'http://127.0.0.1:8787' : import.meta.env.VITE_ACCOUNT_DELETION_WORKER_URL?.trim().replace(/\/+$/, '')
  const token = await getIdToken()
  if (!url || !token) throw new Error('ROOM_UNAVAILABLE')
  const response = await fetch(`${url}/rooms${id ? `/${encodeURIComponent(id)}/${action}` : ''}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error?.code ?? 'ROOM_UNAVAILABLE')
  return result
}
