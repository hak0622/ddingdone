import { create } from 'zustand'

interface UserStore {
  uid: string
  nickname: string
  setUser: (uid: string, nickname: string) => void
}

export const useUserStore = create<UserStore>((set) => ({
  uid: '',
  nickname: '',
  setUser: (uid, nickname) => set({ uid, nickname }),
}))
