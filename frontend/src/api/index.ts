import { ALL_CLEAR_MINUTES } from '@/lib/planit'
import { api, ApiError, unwrap, unwrapData } from './client'
import {
  type BriefingDTO,
  type ObservationDTO,
  hazardFromReportType,
  toAlert,
  toHazardIndexPoint,
  toHazardReport,
  toSite,
  toSiteRisk,
  toStrikes,
} from './mappers'
import {
  type Alert,
  type HazardIndexPoint,
  type HazardReport,
  type LightningStrike,
  type NewHazardReport,
  type Site,
  type SiteRisk,
} from './types'

/**
 * PlanIT Control data access layer, backed by the core API.
 *
 * Every function calls the typed client and maps the response into the UI
 * view model, so components never see backend field names.
 */

const HOUR_MS = 60 * 60 * 1000

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

/** Treat an unknown or malformed site id as "not found" instead of an error. */
async function orUndefined<T>(request: Promise<T>): Promise<T | undefined> {
  try {
    return await request
  } catch (error) {
    if (error instanceof ApiError && [404, 422].includes(error.status)) {
      return undefined
    }
    throw error
  }
}

interface SiteRiskRow {
  site: Site
  risk: SiteRisk
}

/** Every site with its latest hazard index, riskiest first (unscored sites last). */
export async function listSiteRisks(): Promise<SiteRiskRow[]> {
  const rankings = await unwrapData(api.GET('/api/risk/rankings'))
  return rankings.map((row) => ({
    site: toSite(row.site),
    risk: toSiteRisk(row.site.id, row.status, row.risk),
  }))
}

/** Every monitored site, by name (one fast query per page of 200). */
export async function listSites(): Promise<Site[]> {
  const sites: Site[] = []
  const limit = 200
  for (let offset = 0; ; offset += limit) {
    const page = await unwrap(
      api.GET('/api/sites', { params: { query: { limit, offset } } })
    )
    sites.push(...page.data.map(toSite))
    const total = (page.meta as { total?: number } | null | undefined)?.total
    if (
      page.data.length < limit ||
      total === undefined ||
      sites.length >= total
    )
      break
  }
  return sites
}

export async function getSite(siteId: string): Promise<Site | undefined> {
  const site = await orUndefined(
    unwrapData(
      api.GET('/api/sites/{site_id}', { params: { path: { site_id: siteId } } })
    )
  )
  return site ? toSite(site) : undefined
}

export async function getSiteRisk(
  siteId: string
): Promise<SiteRisk | undefined> {
  const result = await orUndefined(
    unwrapData(
      api.GET('/api/sites/{site_id}/risk', {
        params: { path: { site_id: siteId } },
      })
    )
  )
  return result ? toSiteRisk(siteId, result.status, result.score) : undefined
}

const OPEN_ALERT_STATUSES = [
  'ACTIVE',
  'ACKNOWLEDGED',
  'ALL_CLEAR_ELIGIBLE',
] as const

/** Unresolved alerts across the fleet, newest first. */
export async function listAlerts(): Promise<Alert[]> {
  const pages = await Promise.all(
    OPEN_ALERT_STATUSES.map((status) =>
      unwrapData(
        api.GET('/api/alerts', { params: { query: { status, limit: 500 } } })
      )
    )
  )
  return pages
    .flat()
    .map(toAlert)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Stored observations for one site, newest first. */
export async function listSiteHazards(
  siteId: string,
  sinceHours = 72
): Promise<ObservationDTO[]> {
  return unwrapData(
    api.GET('/api/sites/{site_id}/hazards', {
      params: {
        path: { site_id: siteId },
        query: { since: isoAgo(sinceHours * HOUR_MS), limit: 500 },
      },
    })
  )
}

export async function getHazardIndexHistory(
  siteId: string,
  days = 14
): Promise<HazardIndexPoint[]> {
  const rows = await unwrapData(
    api.GET('/api/sites/{site_id}/risk/history', {
      params: { path: { site_id: siteId }, query: { days } },
    })
  )
  return rows.map(toHazardIndexPoint)
}

/** Recent strikes across the fleet: the all-clear window plus a small margin. */
export async function listStrikes(): Promise<LightningStrike[]> {
  const rows = await unwrapData(
    api.GET('/api/sites/lightning', {
      params: {
        query: {
          since: isoAgo((ALL_CLEAR_MINUTES + 2) * 60 * 1000),
          limit: 500,
        },
      },
    })
  )
  return toStrikes(rows)
}

/** Crew reports, newest first. Requires the admin role. */
export async function listHazardReports(
  siteId?: string
): Promise<HazardReport[]> {
  const rows = await unwrapData(
    api.GET('/api/reports', {
      params: { query: { site_id: siteId, limit: 500 } },
    })
  )
  return rows.map(toHazardReport)
}

export async function createHazardReport(
  input: NewHazardReport
): Promise<HazardReport> {
  const report = await unwrapData(
    api.POST('/api/reports', {
      body: {
        site_id: input.siteId,
        hazard_type: hazardFromReportType(input.type),
        description: input.note,
        latitude: input.lat,
        longitude: input.lon,
        observed_at: new Date().toISOString(),
      },
    })
  )
  return toHazardReport(report)
}

/** Stored briefings for every site since the given ISO date, newest first. */
export async function listBriefingRows(
  sinceDate: string
): Promise<BriefingDTO[]> {
  const rows: BriefingDTO[] = []
  const limit = 1000
  for (let offset = 0; ; offset += limit) {
    const page = await unwrap(
      api.GET('/api/briefings', {
        params: { query: { since: sinceDate, limit, offset } },
      })
    )
    rows.push(...page.data)
    const total = (page.meta as { total?: number } | null | undefined)?.total
    if (page.data.length < limit || total === undefined || rows.length >= total)
      break
  }
  return rows
}
