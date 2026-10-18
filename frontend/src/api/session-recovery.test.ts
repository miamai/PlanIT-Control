import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { api, refreshSession, unwrap, unwrapData, unwrapEmpty } from './client'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('openapi-fetch', async (original) => {
  const actual = await original<typeof import('openapi-fetch')>()
  return {
    ...actual,
    default: (options: object) =>
      actual.default({
        ...options,
        fetch: (request: Request) => mocks.fetch(request),
      }),
  }
})
const user = {
  id: 'user-1',
  username: 'operator',
  display_name: null,
  role: 'user' as const,
  status: 'active' as const,
  created_at: '',
  updated_at: '',
  deleted_at: null,
}
const session = {
  access_token: 'renewed-access',
  expires_in: 900,
  token_type: 'bearer',
  user,
}
const sites = () => unwrapData(api.GET('/api/sites'))
const path = (input: Request | string) =>
  new URL(typeof input === 'string' ? input : input.url).pathname
beforeEach(() => {
  mocks.fetch.mockReset()
  vi.stubGlobal('fetch', mocks.fetch)
  useAuthStore.getState().auth.setSession('old-access', 900, user)
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

describe('Session recovery and protected auth endpoints', () => {
  it('refreshes before an expired access token is sent', async () => {
    useAuthStore.getState().auth.setSession('old-access', 0, user)
    mocks.fetch.mockImplementation(async (input: Request | string) =>
      path(input) === '/api/auth/refresh'
        ? Response.json(session)
        : Response.json({ data: [] })
    )
    await sites()
    expect(path(mocks.fetch.mock.calls[0][0])).toBe('/api/auth/refresh')
    expect(mocks.fetch.mock.calls[0][1].credentials).toBe('include')
    expect(mocks.fetch.mock.calls[1][0].headers.get('Authorization')).toBe(
      'Bearer renewed-access'
    )
  })
  it('retries a 401 with the renewed token and shares refresh across concurrent requests', async () => {
    mocks.fetch.mockImplementation(async (input: Request | string) => {
      if (path(input) === '/api/auth/refresh') return Response.json(session)
      const request = input as Request
      return request.headers.get('Authorization') === 'Bearer old-access'
        ? new Response(null, { status: 401 })
        : Response.json({ data: [] })
    })
    await Promise.all([sites(), sites()])
    expect(
      mocks.fetch.mock.calls.filter(
        ([input]) => path(input) === '/api/auth/refresh'
      )
    ).toHaveLength(1)
    expect(useAuthStore.getState().auth.accessToken).toBe('renewed-access')
  })
  it('retries a one-off 503 without clearing the valid session', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(session))
    expect(await refreshSession()).toEqual(session)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it.each([503, 429])(
    'preserves state and reports service failure after repeated %s responses',
    async (status) => {
      mocks.fetch.mockResolvedValue(new Response(null, { status }))
      await expect(refreshSession()).rejects.toMatchObject({ status: 503 })
      expect(useAuthStore.getState().auth.accessToken).toBe('old-access')
    }
  )
  it('does not convert refresh network errors after a data 401 into a logout', async () => {
    mocks.fetch.mockImplementation(async (input: Request | string) => {
      if (path(input) === '/api/auth/refresh') throw new TypeError('Offline')
      return new Response(null, { status: 401 })
    })
    await expect(sites()).rejects.toMatchObject({ status: 503 })
    expect(useAuthStore.getState().auth.user?.id).toBe(user.id)
  })
  it('clears state only after the refresh endpoint rejects authentication', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }))
    expect(await refreshSession()).toBeNull()
    expect(useAuthStore.getState().auth.accessToken).toBe('')
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })
  it('keeps the session when the service returns malformed session data', async () => {
    mocks.fetch.mockResolvedValue(Response.json({}))
    await expect(refreshSession()).rejects.toMatchObject({ status: 503 })
    expect(useAuthStore.getState().auth.accessToken).toBe('old-access')
  })
  it('sends credentials to password updates and does not retry an incorrect current password', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json(
        { detail: 'Current password is incorrect' },
        { status: 401 }
      )
    )
    await expect(
      unwrap(
        api.PATCH('/api/auth/me/password', {
          body: {
            current_password: 'incorrect',
            new_password: 'test-password',
          },
        })
      )
    ).rejects.toMatchObject({
      status: 401,
      detail: 'Current password is incorrect',
    })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.fetch.mock.calls[0][0].headers.get('Authorization')).toBe(
      'Bearer old-access'
    )
    expect(useAuthStore.getState().auth.accessToken).toBe('old-access')
  })
  it('authenticates logout so the server can revoke the cookie', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }))
    await unwrapEmpty(api.POST('/api/auth/logout'))
    expect(mocks.fetch.mock.calls[0][0].headers.get('Authorization')).toBe(
      'Bearer old-access'
    )
  })
})
