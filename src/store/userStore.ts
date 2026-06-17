import { create } from 'zustand'

interface UserStore {
  uid: string
  nickname: string
  tossKey: string | null
  setUser: (uid: string, nickname: string, tossKey?: string | null) => void
}

export const useUserStore = create<UserStore>((set) => ({
  uid: '',
  nickname: '',
  tossKey: null,
  setUser: (uid, nickname, tossKey = null) => set({ uid, nickname, tossKey }),
}))
