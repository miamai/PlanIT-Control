import { type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { type Site } from '@/api/types'
import { HazardReportForm } from './report-form'

const mocks = vi.hoisted(() => ({
  sites: vi.fn(),
  getSite: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/api', () => ({
  getSite: mocks.getSite,
  createHazardReport: mocks.create,
}))
vi.mock('@/hooks/use-planit', () => ({
  useSites: mocks.sites,
  planitKeys: {
    alerts: ['alerts'],
    rankings: ['rankings'],
    briefings: ['briefings'],
  },
}))
vi.mock('@/hooks/use-profile', () => ({
  useProfile: () => ({ name: 'Test user', roleLabel: 'User' }),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({
    to,
    search,
    children,
  }: {
    to: string
    search?: Record<string, string | undefined>
    children: ReactNode
  }) => (
    <a
      href={`${to}?${new URLSearchParams(Object.entries(search ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined))}`}
    >
      {children}
    </a>
  ),
}))
vi.mock('@/components/planit/planit-header', () => ({
  PlanitHeader: () => null,
}))
vi.mock('@/components/planit/location-picker', () => ({
  LocationPicker: ({ value }: { value: { lat: number; lon: number } }) => (
    <p data-testid='pin'>
      {value.lat}, {value.lon}
    </p>
  ),
}))
vi.mock('@/lib/toast', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))
const first: Site = {
  id: 'site-1',
  eiaPlantId: '111',
  name: 'First Plant',
  utility: 'Utility',
  county: 'Harris',
  state: 'TX',
  lat: 30,
  lon: -90,
  plantType: 'Solar',
  timezone: 'UTC',
  mlSupported: true,
}
const target: Site = {
  ...first,
  id: 'site-2',
  eiaPlantId: '222',
  name: 'Target Plant',
  county: 'Elmore',
  state: 'AL',
  lat: 32,
  lon: -86,
}
const absent: Site = {
  ...first,
  id: 'site-3',
  eiaPlantId: '333',
  name: 'Direct lookup plant',
  state: 'LA',
  lat: 29,
  lon: -91,
}
let client: QueryClient
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  mocks.sites.mockReturnValue({
    sites: [first, target],
    isLoading: false,
    isError: false,
    refresh: mocks.refresh,
  })
  mocks.getSite.mockResolvedValue(undefined)
  mocks.create.mockResolvedValue({
    id: 'report',
    siteId: target.id,
    type: 'soil',
  })
})
describe('Report site initialization and selection', () => {
  it('prefills the linked site and submits its exact id and pin', async () => {
    const screen = await render(
      <HazardReportForm defaultSiteId={target.id} />,
      { wrapper }
    )
    await expect
      .element(screen.getByRole('combobox', { name: 'Site', exact: true }))
      .toHaveTextContent('Target Plant')
    await expect.element(screen.getByTestId('pin')).toHaveTextContent('32, -86')
    await userEvent.fill(
      screen.getByLabelText("What's happening?"),
      'Test field condition'
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Submit', exact: true })
    )
    await vi.waitFor(() =>
      expect(mocks.create.mock.calls[0][0]).toMatchObject({
        siteId: target.id,
        lat: 32,
        lon: -86,
      })
    )
    expect(mocks.getSite).not.toHaveBeenCalled()
  })
  it('looks up a valid target missing from the loaded list without substituting the first site', async () => {
    mocks.getSite.mockResolvedValue(absent)
    const screen = await render(
      <HazardReportForm defaultSiteId={absent.id} />,
      { wrapper }
    )
    await expect
      .element(screen.getByRole('combobox', { name: 'Site', exact: true }))
      .toHaveTextContent('Direct lookup plant')
    expect(mocks.getSite).toHaveBeenCalledWith(absent.id)
    await expect.element(screen.getByTestId('pin')).toHaveTextContent('29, -91')
  })
  it('keeps an invalid target unselected with an actionable warning', async () => {
    const screen = await render(
      <HazardReportForm defaultSiteId='missing-site' />,
      { wrapper }
    )
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('linked site is unavailable')
    await expect
      .element(screen.getByRole('combobox', { name: 'Site', exact: true }))
      .toHaveTextContent('Select a site')
    await expect
      .element(screen.getByRole('button', { name: 'Submit', exact: true }))
      .toBeDisabled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('reinitializes when the route site parameter changes on the same mounted page', async () => {
    const screen = await render(<HazardReportForm defaultSiteId={first.id} />, {
      wrapper,
    })
    await screen.rerender(<HazardReportForm defaultSiteId={target.id} />)
    await expect
      .element(screen.getByRole('combobox', { name: 'Site', exact: true }))
      .toHaveTextContent('Target Plant')
    await expect.element(screen.getByTestId('pin')).toHaveTextContent('32, -86')
  })
  it('requires an explicit site on a generic new report and supports text search', async () => {
    const screen = await render(<HazardReportForm />, { wrapper })
    await expect
      .element(screen.getByRole('button', { name: 'Submit', exact: true }))
      .toBeDisabled()
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Site', exact: true })
    )
    await userEvent.fill(
      screen.getByRole('combobox', { name: 'Search sites', exact: true }),
      'Elmore'
    )
    await userEvent.click(screen.getByRole('option', { name: /Target Plant/ }))
    await expect
      .element(screen.getByRole('combobox', { name: 'Site', exact: true }))
      .toHaveTextContent('Target Plant')
    await expect.element(screen.getByTestId('pin')).toHaveTextContent('32, -86')
  })
  it('shows no matches instead of silently changing selection', async () => {
    const screen = await render(
      <HazardReportForm defaultSiteId={target.id} />,
      { wrapper }
    )
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Site', exact: true })
    )
    await userEvent.fill(
      screen.getByRole('combobox', { name: 'Search sites', exact: true }),
      'nonexistent-plant'
    )
    await expect.element(screen.getByText('No matching sites.')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect
      .element(screen.getByRole('combobox', { name: 'Site', exact: true }))
      .toHaveTextContent('Target Plant')
  })
  it('distinguishes a load failure from an empty site list and can retry', async () => {
    mocks.sites.mockReturnValue({
      sites: [],
      isLoading: false,
      isError: true,
      refresh: mocks.refresh,
    })
    const screen = await render(<HazardReportForm />, { wrapper })
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Could not load sites')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
  it('handles a failed direct lookup without choosing another site', async () => {
    mocks.getSite.mockRejectedValue(new Error('Service offline'))
    const screen = await render(
      <HazardReportForm defaultSiteId={absent.id} />,
      { wrapper }
    )
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Could not load the linked site')
    await expect
      .element(screen.getByRole('button', { name: 'Submit', exact: true }))
      .toBeDisabled()
  })
})
