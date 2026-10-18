import { useAuthStore } from '@/stores/auth-store'
import {
  api,
  refreshSession,
  unwrap,
  withSessionLock,
  ApiError,
  type TokenResponse,
} from './client'

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
  try {
    return (await refreshSession()) !== null
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) return false
    throw error
  }
}

/** Revoke the refresh token server-side, then clear the local session. */
export async function logout(): Promise<void> {
  try {
    await api.POST('/api/auth/logout')
  } finally {
    useAuthStore.getState().auth.reset()
  }
}

/** Password changes rotate the refresh cookie and revoke older sessions. */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<TokenResponse> {
  if (!(await refreshSession())) throw new ApiError(401, 'Please sign in again')
  return withSessionLock(async () => {
    const session = await unwrap(
      api.PATCH('/api/auth/me/password', {
        body: { current_password: currentPassword, new_password: newPassword },
      })
    )
    useAuthStore
      .getState()
      .auth.setSession(session.access_token, session.expires_in, session.user)
    return session
  })
}
