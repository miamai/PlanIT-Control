import { useAuthStore } from '@/stores/auth-store'
import { api, refreshSession, unwrap, type TokenResponse } from './client'

/** Sign in with the backend's local username/password auth. */
export async function login(
  username: string,
  password: string
): Promise<TokenResponse> {
  const session = await unwrap(
    api.POST('/api/auth/login', { body: { username, password } })
  )
  useAuthStore
    .getState()
    .auth.setSession(session.access_token, session.expires_in, session.user)
  return session
}

/**
 * Make sure there is a usable session, restoring it from the refresh cookie
 * after a page reload. Resolves to false when the user must sign in.
 */
export async function ensureSession(): Promise<boolean> {
  if (useAuthStore.getState().auth.accessToken) return true
  return (await refreshSession()) !== null
}

/** Revoke the refresh token server-side, then clear the local session. */
export async function logout(): Promise<void> {
  try {
    await api.POST('/api/auth/logout')
  } finally {
    useAuthStore.getState().auth.reset()
  }
}
