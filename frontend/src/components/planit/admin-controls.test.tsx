import { type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ApiError } from '@/api/client'
import { type Alert, type HazardReport } from '@/api/types'
import { useAuthStore } from '@/stores/auth-store'
import { AlertControls } from './alert-controls'
import { ReportControls } from './report-controls'

const api = vi.hoisted(() => ({
  updateAlertStatus: vi.fn(),
  updateHazardReport: vi.fn(),
  deleteHazardReport: vi.fn(),
}))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  ...api,
}))
vi.mock('@/lib/toast', () => ({ toastSuccess: vi.fn() }))
const alert: Alert = {
  id: 'alert-1',
  siteId: 'site-1',
  type: 'lightning',
  severity: 'critical',
  status: 'all-clear',
  actionCode: 'STOP_WORK',
  title: 'Lightning',
  message: 'Strike nearby',
  action: 'Stop exposed work',
  createdAt: '2026-10-17T00:00:00Z',
  allClearAt: '2000-01-01T00:00:00Z',
}
const report: HazardReport = {
  id: 'report-1',
  siteId: 'site-1',
  type: 'soil',
  note: 'Muddy access road',
  lat: 30,
  lon: -90,
  reportedBy: 'crew',
  createdAt: '2026-10-17T00:00:00Z',
  status: 'new',
}
function session(role: 'admin' | 'user') {
  useAuthStore.getState().auth.setSession('test', 3600, {
    id: 'user-1',
    username: 'tester',
    display_name: null,
    role,
    status: 'active',
    created_at: '',
    updated_at: '',
    deleted_at: null,
  })
}
let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  api.updateAlertStatus.mockResolvedValue({ ...alert, status: 'resolved' })
  api.updateHazardReport.mockResolvedValue(report)
  api.deleteHazardReport.mockResolvedValue(undefined)
  session('admin')
})
afterEach(() => {
  useAuthStore.getState().auth.reset()
  client.clear()
})

describe('Admin alert operations', () => {
  it('hides administrative operations from users, including report owners', async () => {
    session('user')
    await render(
      <>
        <AlertControls alert={alert} />
        <ReportControls report={{ ...report, reportedBy: 'tester' }} />
      </>,
      { wrapper }
    )
    expect(document.querySelector('button')).toBeNull()
  })
  it('requires a review reason, submits sign-off and refreshes shared queries', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const screen = await render(<AlertControls alert={alert} />, { wrapper })
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign off & clear' })
    )
    await expect
      .element(screen.getByRole('button', { name: 'Confirm & clear' }))
      .toBeDisabled()
    await userEvent.fill(
      screen.getByLabelText('Review reason'),
      'Reviewed site conditions'
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm & clear' })
    )
    await vi.waitFor(() =>
      expect(api.updateAlertStatus).toHaveBeenCalledWith(
        {
          alertId: 'alert-1',
          status: 'RESOLVED',
          reason: 'Reviewed site conditions',
        },
        expect.anything()
      )
    )
    await vi.waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['alerts'] })
    )
  })
  it.each([
    { ...alert, status: 'active' as const },
    { ...alert, allClearAt: '2099-01-01T00:00:00Z' },
    { ...alert, allClearAt: undefined },
  ])('does not grant sign-off from client time alone: %j', async (value) => {
    const screen = await render(<AlertControls alert={value} />, { wrapper })
    await expect
      .element(screen.getByRole('button', { name: 'Sign off & clear' }))
      .toBeDisabled()
  })
  it('keeps the dialog open and refreshes stale data when a new strike blocks sign-off', async () => {
    api.updateAlertStatus.mockRejectedValue(
      new ApiError(409, 'Conflict', 'Lightning all-clear is not yet eligible')
    )
    const screen = await render(<AlertControls alert={alert} />, { wrapper })
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign off & clear' })
    )
    await userEvent.fill(
      screen.getByLabelText('Review reason'),
      'Reviewed conditions'
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm & clear' })
    )
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Lightning all-clear is not yet eligible')
    await expect.element(screen.getByLabelText('Review reason')).toBeVisible()
  })
  it('acknowledges a regular alert without resolving it', async () => {
    const screen = await render(
      <AlertControls
        alert={{ ...alert, type: 'heat', actionCode: null, status: 'active' }}
      />,
      { wrapper }
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Acknowledge', exact: true })
    )
    await userEvent.fill(
      screen.getByLabelText('Review reason'),
      'Crew notified'
    )
    await userEvent.click(
      screen
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Acknowledge', exact: true })
    )
    await vi.waitFor(() =>
      expect(api.updateAlertStatus.mock.calls[0][0].status).toBe('ACKNOWLEDGED')
    )
  })
})

describe('Report management', () => {
  it('saves only corrected text and invalidates shared reports and site maps', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const screen = await render(<ReportControls report={report} />, { wrapper })
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit report', exact: true })
    )
    await userEvent.fill(
      screen.getByLabelText('Report description'),
      'Road reopened after inspection'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() =>
      expect(api.updateHazardReport.mock.calls[0][0]).toEqual({
        reportId: 'report-1',
        note: 'Road reopened after inspection',
      })
    )
    await vi.waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['hazard-reports'] })
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['site'] })
  })
  it('cancels deletion without a request and waits for explicit confirmation', async () => {
    const screen = await render(<ReportControls report={report} />, { wrapper })
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete report', exact: true })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.deleteHazardReport).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete report', exact: true })
    )
    await userEvent.click(
      screen
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Delete report', exact: true })
    )
    await vi.waitFor(() =>
      expect(api.deleteHazardReport).toHaveBeenCalledWith('report-1')
    )
  })
  it('retains edits and displays a failed request without showing success', async () => {
    api.updateHazardReport.mockRejectedValue(
      new ApiError(403, 'Forbidden', 'admin role required')
    )
    const screen = await render(<ReportControls report={report} />, { wrapper })
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit report', exact: true })
    )
    await userEvent.fill(
      screen.getByLabelText('Report description'),
      'Corrected report text'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('admin role required')
    await expect
      .element(screen.getByLabelText('Report description'))
      .toHaveValue('Corrected report text')
  })
})
