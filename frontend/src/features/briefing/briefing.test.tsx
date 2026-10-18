import { type ReactNode } from 'react'
import '@/styles/index.css'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { buildFleetBriefing, type BriefingDTO } from '@/api/mappers'
import { type Alert, type Site, type SiteRisk } from '@/api/types'
import { BriefingPage } from './index'

const mocks = vi.hoisted(() => ({
  briefing: vi.fn(),
  fleet: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/hooks/use-planit', () => ({
  useFleetBriefing: () => mocks.briefing(),
  useSiteBundles: () => mocks.fleet(),
}))
vi.mock('@/components/planit/alert-controls', () => ({
  AlertControls: () => null,
}))
vi.mock('@/components/planit/planit-header', () => ({
  PlanitHeader: () => null,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const site: Site = {
  id: 'site-1',
  eiaPlantId: '1',
  name: 'Priority Site',
  utility: 'Utility',
  county: 'Test',
  state: 'NY',
  lat: 40,
  lon: -74,
  plantType: 'Solar',
  timezone: 'America/New_York',
  mlSupported: true,
}
const row: BriefingDTO = {
  id: 'briefing-1',
  site_id: site.id,
  briefing_date: '2026-10-18',
  generated_at: '2026-10-17T23:00:00Z',
  summary: 'Heat peaks in the afternoon. Schedule outdoor work earlier.',
  hazard_details: {},
}
let risk: SiteRisk
let alerts: Alert[]

beforeEach(() => {
  vi.clearAllMocks()
  risk = {
    siteId: site.id,
    status: 'available',
    score: 7,
    severity: 'high',
    recommendation: 'NO-GO',
    reasons: [
      {
        domain: 'heat',
        label: 'Heat index peaks at 108°F',
        contribution: 1,
        detail: 'From the dated forecast',
      },
    ],
    subScores: { heat: 7 },
    workPlan: [
      'Avoid 13:00 to 17:00 (heat)',
      'Schedule exposed work earlier in the morning.',
    ],
    predictionDate: '2026-10-18',
    scoreSource: 'ml_service',
  }
  alerts = [
    {
      id: 'restriction-1',
      siteId: site.id,
      type: 'flood',
      severity: 'critical',
      status: 'active',
      actionCode: 'STOP_WORK',
      sourceReference: 'planit_fixture:demo-test',
      title: 'Flooded access road',
      message: 'Flooding on access road',
      action: 'Keep the access road closed until operations reopens it.',
      createdAt: '2026-10-17T22:00:00Z',
    },
  ]
  mocks.briefing.mockImplementation(() => ({
    briefing: buildFleetBriefing([row], new Map([[site.id, risk]]), alerts),
    isLoading: false,
    isError: false,
    isEmpty: false,
    refresh: mocks.refresh,
  }))
  mocks.fleet.mockImplementation(() => ({
    bundles: [{ site, risk, conditions: { lightningActive: false }, alerts }],
    isLoading: false,
    isError: false,
  }))
})

describe('Briefing scope', () => {
  it('keeps the title, risk reasons, supplied work periods and practical actions without coverage or archive controls', async () => {
    const screen = await render(<BriefingPage />)
    await expect
      .element(screen.getByRole('heading', { name: 'Briefing', exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Heat index peaks at 108°F'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Avoid 13:00 to 17:00 (heat)'))
      .toBeVisible()
    await expect
      .element(
        screen.getByText('Schedule exposed work earlier in the morning.')
      )
      .toBeVisible()
    await userEvent.click(screen.getByText('Data sources', { exact: true }))
    await expect
      .element(screen.getByText(/ML source: as reported by the API/))
      .toBeVisible()
    expect(document.body.textContent).not.toMatch(
      /Verified ML|Verified model|Shift coverage|Saved shifts|Back to latest|Tomorrow’s priorities/
    )
  })

  it('shows explicit STOP_WORK for a non-lightning hazard and displays the supplied action without inventing sign-off rules', async () => {
    const screen = await render(<BriefingPage />)
    await expect
      .element(screen.getByText('Stop work', { exact: true }))
      .toBeVisible()
    await expect.element(screen.getByText(alerts[0].action)).toBeVisible()
    await expect.element(screen.getByText(/alert source:/)).not.toBeVisible()
    await userEvent.click(screen.getByText('Data sources', { exact: true }))
    await expect
      .element(screen.getByText(/alert source: planit_fixture:demo-test/))
      .toBeVisible()
    expect(document.body.textContent).not.toMatch(
      /admin sign-off|sign-off required/
    )
  })

  it('does not infer a stop-work instruction from lightning or the all-clear state alone', async () => {
    alerts[0] = {
      ...alerts[0],
      type: 'lightning',
      status: 'all-clear',
      actionCode: null,
    }
    const screen = await render(<BriefingPage />)
    await expect
      .element(screen.getByText(/No current stop-work restrictions reported/))
      .toBeVisible()
    expect(document.body.textContent).not.toContain(
      'Status: all-clear eligible'
    )
    expect(document.body.textContent).not.toContain(alerts[0].action)
  })

  it('excludes resolved restrictions even when action_code remains STOP_WORK', async () => {
    alerts[0].status = 'resolved'
    const screen = await render(<BriefingPage />)
    await expect
      .element(screen.getByText(/No current stop-work restrictions reported/))
      .toBeVisible()
  })

  it('discloses the sample scenario once and omits repeated technical notices', async () => {
    risk.scoreSource = 'demo'
    risk.reasons = []
    const screen = await render(<BriefingPage />)
    await expect
      .element(screen.getByText('Sample scenario', { exact: true }))
      .toBeVisible()
    expect(document.body.textContent).not.toMatch(
      /No structured risk reasons|No current work plan|Demo data does not provide|No dated score/
    )
    expect(document.body.textContent).not.toContain(
      'Avoid 13:00 to 17:00 (heat)'
    )
    expect(document.body.textContent).not.toContain('Main hazards')
    expect(document.body.textContent).not.toContain('Actions & work windows')
    await userEvent.click(screen.getByText('Data sources', { exact: true }))
    await expect
      .element(screen.getByText(/Sample scenario: illustrative scores/))
      .toBeVisible()
  })

  it('does not borrow scores, reasons or time periods from another forecast date', async () => {
    risk.predictionDate = '2026-10-19'
    const screen = await render(<BriefingPage />)
    await expect
      .element(
        screen.getByText('No dated risk forecast is available for this shift.')
      )
      .toBeVisible()
    expect(document.body.textContent).not.toContain(
      'No structured risk reasons'
    )
    expect(document.body.textContent).not.toContain('13:00')
    expect(document.body.textContent).not.toContain('Heat index peaks at 108°F')
  })

  it('omits incomplete periods and suppresses stale work plans', async () => {
    risk.workPlan = ['Work window ? to ?', 'Avoid 13:00 to 17:00 (heat)']
    const screen = await render(<BriefingPage />)
    await expect
      .element(screen.getByText('Avoid 13:00 to 17:00 (heat)'))
      .toBeVisible()
    expect(document.body.textContent).not.toContain('? to ?')
    risk.status = 'stale'
    await screen.rerender(<BriefingPage />)
    expect(document.body.textContent).not.toContain('13:00')
  })

  it('keeps loading and missing-data messages, and can retry a failed request', async () => {
    mocks.briefing.mockReturnValueOnce({
      isLoading: true,
      isError: false,
      isEmpty: false,
      refresh: mocks.refresh,
    })
    const screen = await render(<BriefingPage />)
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    mocks.briefing.mockReturnValueOnce({
      isLoading: false,
      isError: true,
      isEmpty: false,
      refresh: mocks.refresh,
    })
    await screen.rerender(<BriefingPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
    mocks.briefing.mockReturnValueOnce({
      isLoading: false,
      isError: false,
      isEmpty: true,
      refresh: mocks.refresh,
    })
    await screen.rerender(<BriefingPage />)
    await expect
      .element(screen.getByText('No saved briefings for this shift'))
      .toBeVisible()
  })

  it('keeps work restrictions and actions within a narrow layout', async () => {
    await render(
      <div data-testid='viewport' style={{ width: 320 }}>
        <BriefingPage />
      </div>
    )
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="viewport"]'
    )!
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  })
})
