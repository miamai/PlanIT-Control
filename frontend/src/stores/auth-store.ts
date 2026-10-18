import { create } from 'zustand'
import { type components } from '@/api/schema'

export type AuthUser = components['schemas']['UserRead']
export type UserRole = AuthUser['role']

/**
 * Session state for the core API's local JWT auth.
 *
 * The access token lives in memory only (the backend guide forbids storing it
 * in JS-readable storage); a page reload restores it through the HttpOnly
 * refresh cookie.
 */
interface AuthState {
  auth: {
    user: AuthUser | null
    accessToken: string
    /** Epoch ms when the access token expires. */
    expiresAt: number
    setSession: (
      accessToken: string,
      expiresInSeconds: number,
      user: AuthUser
    ) => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    accessToken: '',
    expiresAt: 0,
    setSession: (accessToken, expiresInSeconds, user) =>
      set((state) => ({
        ...state,
        auth: {
          ...state.auth,
          accessToken,
          expiresAt: Date.now() + expiresInSeconds * 1000,
          user,
        },
      })),
    reset: () =>
      set((state) => ({
        ...state,
        auth: { ...state.auth, user: null, accessToken: '', expiresAt: 0 },
      })),
  },
}))

export const ROLE_LABEL: Record<UserRole, string> = {
  user: 'User',
  admin: 'Admin',
}

export function displayName(user: AuthUser | null): string {
  return user?.display_name || user?.username || 'Signed out'
}

const ROLE_RANK: Record<UserRole, number> = { user: 0, admin: 1 }

/** True when the user has at least the given role (admin > user). */
export function hasRole(user: AuthUser | null, minimum: UserRole): boolean {
  return !!user && ROLE_RANK[user.role] >= ROLE_RANK[minimum]
}
