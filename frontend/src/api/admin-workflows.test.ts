import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  deleteHazardReport,
  updateAlertStatus,
  updateHazardReport,
} from './index'

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
beforeEach(() => {
  mocks.fetch.mockReset()
  useAuthStore.getState().auth.setSession('test-admin-token', 900, {
    id: 'admin-1',
    username: 'admin',
    role: 'admin',
    display_name: null,
    status: 'active',
    created_at: '',
    updated_at: '',
    deleted_at: null,
  })
})
afterEach(() => useAuthStore.getState().auth.reset())
const report = {
  id: 'report-1',
  site_id: 'site-1',
  hazard_type: 'soil',
  description: 'Updated field report',
  latitude: 30,
  longitude: -90,
  reporter_subject: 'crew',
  reported_at: '2026-10-17T00:00:00Z',
  verification_status: 'unverified',
}
describe('Administrative API contracts', () => {
  it('sends the audited alert transition and maps acknowledgement', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({
        data: {
          id: 'alert-1',
          site_id: 'site-1',
          hazard_type: 'heat',
          status: 'ACKNOWLEDGED',
          severity: 'HIGH',
          title: 'Heat',
          message: 'Heat warning',
          recommended_action: 'Use heat plan',
          triggered_at: '2026-10-17T00:00:00Z',
          details: {},
        },
      })
    )
    expect(
      (
        await updateAlertStatus({
          alertId: 'alert-1',
          status: 'ACKNOWLEDGED',
          reason: 'Crew notified',
        })
      ).acknowledged
    ).toBe(true)
    const request = mocks.fetch.mock.calls[0][0] as Request
    expect(request.method).toBe('PATCH')
    expect(new URL(request.url).pathname).toBe('/api/alerts/alert-1')
    expect(request.headers.get('Authorization')).toBe('Bearer test-admin-token')
    expect(await request.json()).toEqual({
      status: 'ACKNOWLEDGED',
      reason: 'Crew notified',
    })
  })
  it('updates report text with the exact supported payload', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ data: report }))
    const updated = await updateHazardReport({
      reportId: 'report-1',
      note: 'Updated field report',
    })
    expect(updated.note).toBe('Updated field report')
    const request = mocks.fetch.mock.calls[0][0] as Request
    expect(new URL(request.url).pathname).toBe('/api/reports/report-1')
    expect(request.method).toBe('PATCH')
    expect(await request.json()).toEqual({
      description: 'Updated field report',
    })
  })
  it('accepts the bodyless deletion response', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(deleteHazardReport('report-1')).resolves.toBeUndefined()
    expect(mocks.fetch.mock.calls[0][0].method).toBe('DELETE')
  })
  it('preserves server rejection details instead of showing success', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json(
        {
          title: 'Conflict',
          detail: 'Lightning all-clear is not yet eligible',
        },
        { status: 409 }
      )
    )
    await expect(
      updateAlertStatus({
        alertId: 'alert-1',
        status: 'RESOLVED',
        reason: 'Review complete',
      })
    ).rejects.toMatchObject({
      status: 409,
      detail: 'Lightning all-clear is not yet eligible',
    })
    mocks.fetch.mockResolvedValue(
      Response.json(
        { title: 'Forbidden', detail: 'admin role required' },
        { status: 403 }
      )
    )
    await expect(deleteHazardReport('report-1')).rejects.toMatchObject({
      status: 403,
    })
  })
})
