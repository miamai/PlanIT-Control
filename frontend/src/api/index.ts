import {
  computeRisk,
  computeSiteRiskBundle,
  generateBriefing,
  buildHazardIndexHistory,
  buildTimeline,
  dateKey,
  type ComputeOptions,
} from '@/api/mock/engine'
import { HAZARD_REPORT_SEED } from '@/api/mock/reports-data'
import { SITE_SEED } from '@/api/mock/sites-data'
import {
  type Alert,
  type Briefing,
  type DashboardSummary,
  type HazardIndexPoint,
  type HazardReport,
  type NewHazardReport,
  type Site,
  type SiteRisk,
  type TimelinePoint,
} from '@/api/types'

/**
 * PlanIT Control data access layer.
 *
 * In production every function below becomes a fetch against the Tiger Data /
 * Supabase backend. The signatures are the API contract the whole team builds
 * against, so the UI never changes when the mock is swapped out.
 */

const LATENCY_MS = 220

function delay<T>(value: T, ms = LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const STORAGE_KEY = 'planit.hazard-reports.v1'

function readStoredReports(): HazardReport[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HazardReport[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStoredReports(reports: HazardReport[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reports))
  } catch {
    // ignore quota / privacy mode failures
  }
}

let reportStore: HazardReport[] = [
  ...HAZARD_REPORT_SEED,
  ...readStoredReports(),
]

export async function listSites(): Promise<Site[]> {
  return delay(SITE_SEED)
}

export async function getSite(siteId: string): Promise<Site | undefined> {
  return delay(SITE_SEED.find((site) => site.id === siteId))
}

export async function getSiteRisk(
  siteId: string,
  options?: ComputeOptions
): Promise<SiteRisk | undefined> {
  const site = SITE_SEED.find((s) => s.id === siteId)
  if (!site) return delay(undefined)
  return delay(computeRisk(site, options))
}

export async function listSiteRisks(
  options?: ComputeOptions
): Promise<{ site: Site; risk: SiteRisk; alerts: Alert[] }[]> {
  return delay(
    SITE_SEED.map((site) => {
      const bundle = computeSiteRiskBundle(site, options)
      return { site, risk: bundle.risk, alerts: bundle.alerts }
    })
  )
}

export async function listAlerts(options?: ComputeOptions): Promise<Alert[]> {
  const now = options?.now ?? Date.now()
  const alerts = SITE_SEED.flatMap(
    (site) => computeSiteRiskBundle(site, { ...options, now }).alerts
  )
  return delay(
    alerts.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  )
}

export async function getTimeline(
  siteId: string,
  options?: ComputeOptions
): Promise<TimelinePoint[]> {
  const site = SITE_SEED.find((s) => s.id === siteId)
  if (!site) return delay([])
  return delay(buildTimeline(site, options))
}

export async function getHazardIndexHistory(
  siteId: string,
  options?: ComputeOptions
): Promise<HazardIndexPoint[]> {
  const site = SITE_SEED.find((s) => s.id === siteId)
  if (!site) return delay([])
  return delay(buildHazardIndexHistory(site, options))
}

export async function listHazardReports(
  siteId?: string
): Promise<HazardReport[]> {
  const reports = siteId
    ? reportStore.filter((report) => report.siteId === siteId)
    : reportStore
  return delay(
    [...reports].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  )
}

export async function listHazardReportsSync(
  siteId?: string
): Promise<HazardReport[]> {
  const reports = siteId
    ? reportStore.filter((report) => report.siteId === siteId)
    : reportStore
  return [...reports].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export async function createHazardReport(
  input: NewHazardReport
): Promise<HazardReport> {
  const report: HazardReport = {
    ...input,
    id: `RPT-${Math.floor(Date.now() / 1000)
      .toString(36)
      .toUpperCase()}`,
    createdAt: new Date().toISOString(),
    status: 'new',
    confirmations: 0,
  }
  reportStore = [report, ...reportStore]
  const stored = reportStore.filter(
    (r) => !HAZARD_REPORT_SEED.some((s) => s.id === r.id)
  )
  writeStoredReports(stored)
  return delay(report, 500)
}

export async function confirmHazardReport(
  reportId: string
): Promise<HazardReport | undefined> {
  reportStore = reportStore.map((report) =>
    report.id === reportId
      ? { ...report, confirmations: report.confirmations + 1 }
      : report
  )
  return delay(reportStore.find((report) => report.id === reportId))
}

export async function getBriefing(
  options?: ComputeOptions & { shiftDate?: Date }
): Promise<Briefing> {
  return delay(generateBriefing(SITE_SEED, options), 350)
}

export async function listBriefings(): Promise<Briefing[]> {
  const now = new Date()
  const briefings: Briefing[] = []
  for (let i = 0; i < 5; i++) {
    const shift = new Date(now)
    shift.setDate(shift.getDate() + 1 - i)
    briefings.push(
      generateBriefing(SITE_SEED, {
        now: shift.getTime(),
        shiftDate: shift,
      })
    )
  }
  return delay(briefings)
}

export async function getDashboardSummary(
  options?: ComputeOptions
): Promise<DashboardSummary> {
  const bundles = SITE_SEED.map((site) => computeSiteRiskBundle(site, options))
  const risks = bundles.map((b) => b.risk)
  const alerts = bundles.flatMap((b) => b.alerts)
  const cutoff = (options?.now ?? Date.now()) - 24 * 60 * 60 * 1000
  const crewReports24h = reportStore.filter(
    (r) => new Date(r.createdAt).getTime() >= cutoff
  ).length

  return delay({
    sites: SITE_SEED.length,
    noGo: risks.filter((r) => r.recommendation === 'NO-GO').length,
    caution: risks.filter((r) => r.recommendation === 'CAUTION').length,
    go: risks.filter((r) => r.recommendation === 'GO').length,
    activeAlerts: alerts.length,
    lightningAlerts: alerts.filter((a) => a.type === 'lightning').length,
    crewReports24h,
    avgScore:
      Math.round(
        (risks.reduce((sum, r) => sum + r.score, 0) / (risks.length || 1)) * 10
      ) / 10,
  })
}

export async function listRecentHazardReports(
  limit = 8
): Promise<HazardReport[]> {
  const reports = await listHazardReports()
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  return reports
    .filter((r) => new Date(r.createdAt).getTime() >= cutoff)
    .slice(0, limit)
}

export { dateKey }
export type { ComputeOptions }
