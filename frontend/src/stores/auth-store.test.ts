import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type AuthUser } from './auth-store'

async function importAuthStore() {
  return import('./auth-store')
}

const sampleUser: AuthUser = {
  id: '00000000-0000-0000-0000-000000000001',
  username: 'dana',
  display_name: 'Dana Reyes',
  role: 'user',
  status: 'active',
  created_at: '2026-10-17T00:00:00Z',
  updated_at: '2026-10-17T00:00:00Z',
  deleted_at: null,
}

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('starts signed out', async () => {
    const { useAuthStore } = await importAuthStore()

    expect(useAuthStore.getState().auth.accessToken).toBe('')
    expect(useAuthStore.getState().auth.user).toBeNull()
  })

  it('keeps the session in memory only, never in browser storage', async () => {
    const { useAuthStore } = await importAuthStore()
    useAuthStore.getState().auth.setSession('session-token', 900, sampleUser)

    expect(document.cookie).not.toContain('session-token')
    expect(JSON.stringify({ ...localStorage })).not.toContain('session-token')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('session-token')
  })

  it('setSession stores the token, user and expiry', async () => {
    const { useAuthStore } = await importAuthStore()
    const before = Date.now()

    useAuthStore.getState().auth.setSession('session-token', 900, sampleUser)

    const { auth } = useAuthStore.getState()
    expect(auth.accessToken).toBe('session-token')
    expect(auth.user).toEqual(sampleUser)
    expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 900_000)
  })

  it('reset clears the session', async () => {
    const { useAuthStore } = await importAuthStore()
    useAuthStore.getState().auth.setSession('will-be-cleared', 900, sampleUser)

    useAuthStore.getState().auth.reset()

    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.accessToken).toBe('')
    expect(useAuthStore.getState().auth.expiresAt).toBe(0)
  })

  it('ranks roles admin > user', async () => {
    const { hasRole } = await importAuthStore()

    expect(hasRole(sampleUser, 'user')).toBe(true)
    expect(hasRole({ ...sampleUser, role: 'admin' }, 'admin')).toBe(true)
    expect(hasRole(sampleUser, 'admin')).toBe(false)
    expect(hasRole(null, 'user')).toBe(false)
  })
})
