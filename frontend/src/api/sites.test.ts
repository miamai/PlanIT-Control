import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { getSite, listSites } from './index'

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
function site(index: number) {
  return {
    id: `site-${index}`,
    eia_plant_id: index,
    name: `API Plant ${index}`,
    operator_name: 'Operator',
    county: 'Test',
    state: 'TX',
    latitude: 30,
    longitude: -90,
    plant_type: 'Solar',
    timezone: 'UTC',
    ml_supported: true,
    ml_site_id: `ml-${index}`,
    ml_model_version: 'test',
    source_release: 'api',
    source_url: 'api',
    created_at: '2026-10-18T00:00:00Z',
    updated_at: '2026-10-18T00:00:00Z',
    is_reference_location: true,
    primary_energy_source: 'SUN',
  }
}
beforeEach(() => {
  mocks.fetch.mockReset()
  useAuthStore.getState().auth.setSession('test-access', 900, {
    id: 'u',
    username: 'u',
    role: 'user',
    status: 'active',
    display_name: null,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  })
})
afterEach(() => useAuthStore.getState().auth.reset())
describe('API site catalog', () => {
  it('loads every API page beyond the initial 200 sites', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({
          data: Array.from({ length: 200 }, (_, i) => site(i)),
          meta: { total: 202, limit: 200, offset: 0 },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [site(200), site(201)],
          meta: { total: 202, limit: 200, offset: 200 },
        })
      )
    const result = await listSites()
    expect(result).toHaveLength(202)
    expect(result[result.length - 1]?.id).toBe('site-201')
    expect(
      new URL(mocks.fetch.mock.calls[1][0].url).searchParams.get('offset')
    ).toBe('200')
  })
  it('continues a full page when total metadata is absent', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({ data: Array.from({ length: 200 }, (_, i) => site(i)) })
      )
      .mockResolvedValueOnce(Response.json({ data: [site(200)] }))
    expect(await listSites()).toHaveLength(201)
  })
  it('does not supplement an empty API with old seed sites', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ data: [], meta: { total: 0, limit: 200, offset: 0 } })
    )
    expect(await listSites()).toEqual([])
  })
  it('treats a missing direct site lookup as unavailable', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ title: 'Site not found' }, { status: 404 })
    )
    expect(await getSite('site-missing')).toBeUndefined()
  })
})
