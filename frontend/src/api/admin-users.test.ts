import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  updateUser,
  type ManagedUser,
} from './admin-users'
import { ApiError } from './client'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('openapi-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openapi-fetch')>()
  return {
    ...actual,
    default: (options: object) =>
      actual.default({
        ...options,
        fetch: (request: Request) => mocks.fetch(request),
      }),
  }
})

const user: ManagedUser = {
  id: 'test-user-id',
  username: 'test.crew',
  display_name: null,
  role: 'user',
  status: 'active',
  created_at: '2026-10-17T00:00:00Z',
  updated_at: '2026-10-17T00:00:00Z',
  deleted_at: null,
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
beforeEach(() => {
  mocks.fetch.mockReset()
  useAuthStore
    .getState()
    .auth.setSession('test-access-token', 900, { ...user, role: 'admin' })
})
afterEach(() => useAuthStore.getState().auth.reset())

describe('admin user API integration', () => {
  it('sends filters, pagination, credentials, and the current access token', async () => {
    mocks.fetch.mockResolvedValue(
      response({ data: [user], meta: { limit: 25, offset: 25, total: 51 } })
    )
    expect(
      await listUsers({
        role: 'admin',
        status: 'disabled',
        include_deleted: true,
        limit: 25,
        offset: 25,
      })
    ).toEqual({ users: [user], total: 51 })
    const request = mocks.fetch.mock.calls[0][0] as Request
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/admin/users')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      role: 'admin',
      status: 'disabled',
      include_deleted: 'true',
      limit: '25',
      offset: '25',
    })
    expect(request.headers.get('Authorization')).toBe(
      'Bearer test-access-token'
    )
    expect(request.credentials).toBe('include')
  })
  it('loads the user detail endpoint', async () => {
    mocks.fetch.mockResolvedValue(response({ data: user }))
    expect(await getUser(user.id)).toEqual(user)
    expect(new URL(mocks.fetch.mock.calls[0][0].url).pathname).toBe(
      `/api/admin/users/${user.id}`
    )
  })
  it('creates an admin with the exact backend payload', async () => {
    mocks.fetch.mockResolvedValue(
      response({ data: { ...user, role: 'admin' } }, 201)
    )
    const body = {
      username: 'test.admin',
      display_name: 'Test Admin',
      password: 'Test-only-password',
      role: 'admin' as const,
    }
    await createUser(body)
    const request = mocks.fetch.mock.calls[0][0] as Request
    expect(request.method).toBe('POST')
    expect(await request.json()).toEqual(body)
  })
  it('patches only supplied fields', async () => {
    mocks.fetch.mockResolvedValue(response({ data: user }))
    await updateUser(user.id, { display_name: null })
    const request = mocks.fetch.mock.calls[0][0] as Request
    expect(request.method).toBe('PATCH')
    expect(await request.json()).toEqual({ display_name: null })
  })
  it('accepts a bodyless 204 deletion', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(deleteUser(user.id)).resolves.toBeUndefined()
    expect(mocks.fetch.mock.calls[0][0].method).toBe('DELETE')
  })
  it('preserves backend conflict details for the UI', async () => {
    mocks.fetch.mockResolvedValue(
      response(
        {
          title: 'Conflict',
          detail: 'The last active admin cannot be changed',
        },
        409
      )
    )
    await expect(updateUser(user.id, { role: 'user' })).rejects.toMatchObject({
      status: 409,
      detail: 'The last active admin cannot be changed',
    })
    mocks.fetch.mockResolvedValue(
      response({ detail: 'Admins cannot delete their own account' }, 409)
    )
    await expect(deleteUser(user.id)).rejects.toBeInstanceOf(ApiError)
  })
})
