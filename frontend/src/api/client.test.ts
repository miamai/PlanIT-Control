import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { refreshSession, type TokenResponse } from './client'

const SESSION: TokenResponse = {
  access_token: 'access-token',
  token_type: 'bearer',
  expires_in: 900,
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'tester',
    display_name: null,
    role: 'user',
    status: 'active',
    created_at: '2026-10-17T00:00:00Z',
    updated_at: '2026-10-17T00:00:00Z',
    deleted_at: null,
  },
}

const fetchMock = vi.fn<typeof fetch>()

describe('refreshSession', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(SESSION)))
    vi.stubGlobal('fetch', fetchMock)
    useAuthStore.getState().auth.reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shares one request between concurrent callers in a tab', async () => {
    const [first, second] = await Promise.all([
      refreshSession(),
      refreshSession(),
    ])

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(first).toEqual(SESSION)
    expect(second).toEqual(SESSION)
    expect(useAuthStore.getState().auth.accessToken).toBe('access-token')
  })

  it("waits for another tab's refresh before sending the cookie", async () => {
    // Web Locks are shared by every tab of the origin, so holding the lock
    // here blocks exactly as another tab's in-flight refresh would.
    let releaseOtherTab = () => {}
    const otherTabHolding = new Promise<void>((acquired) => {
      void navigator.locks.request(
        'planit-auth-refresh',
        () =>
          new Promise<void>((release) => {
            releaseOtherTab = release
            acquired()
          })
      )
    })
    await otherTabHolding

    const refreshed = refreshSession()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchMock).not.toHaveBeenCalled()

    releaseOtherTab()
    await expect(refreshed).resolves.toEqual(SESSION)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('clears the session when the refresh is rejected', async () => {
    useAuthStore.getState().auth.setSession('stale', 900, SESSION.user)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))

    await expect(refreshSession()).resolves.toBeNull()
    expect(useAuthStore.getState().auth.accessToken).toBe('')
  })
})
