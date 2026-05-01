import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { SessionTokens, UserProfile, UserRole } from "@/types/domain";

export interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  setSession: (payload: SessionTokens & { role: UserRole }) => void;
  setUser: (user: UserProfile | null) => void;
  clearSession: () => void;
}

const INITIAL_STATE: Pick<
  AuthState,
  "user" | "accessToken" | "refreshToken" | "expiresIn" | "role" | "isAuthenticated"
> = {
  user: null,
  accessToken: null,
  refreshToken: null,
  expiresIn: null,
  role: null,
  isAuthenticated: false,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,
      setSession: ({ accessToken, refreshToken, expiresIn, role }) =>
        set({
          accessToken,
          refreshToken,
          expiresIn,
          role,
          isAuthenticated: true,
        }),
      setUser: (user) =>
        set({
          user,
          role: (user?.role ?? null) as UserRole | null,
          isAuthenticated: Boolean(user) || Boolean(get().accessToken),
        }),
      clearSession: () => set({ ...INITIAL_STATE }),
    }),
    {
      name: "mtn-auth-store",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        expiresIn: state.expiresIn,
        role: state.role,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
