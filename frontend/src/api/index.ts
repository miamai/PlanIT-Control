import { ALL_CLEAR_MINUTES } from '@/lib/planit'
import { api, ApiError, unwrap, unwrapData, unwrapEmpty } from './client'
import {
  type BriefingDTO,
  type ObservationDTO,
  hazardFromReportType,
  toAlert,
  toCaptureFeedback,
  toCaptureSession,
  toHazardIndexPoint,
  toHazardReport,
  toSite,
  toSiteRisk,
  toStrikes,
} from './mappers'
import {
  type Alert,
  type CaptureFeedback,
  type CaptureSession,
  type HazardIndexPoint,
  type HazardReport,
  type HazardReportType,
  type LightningStrike,
  type NewHazardReport,
  type Site,
  type SiteRisk,
} from './types'

/**
 * Precognition data access layer, backed by the core API.
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
    risk: toSiteRisk(
      row.site.id,
      row.status,
      row.risk,
      row.decision,
      row.decision_basis
    ),
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
      (total !== undefined && sites.length >= total)
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
  return result
    ? toSiteRisk(
        siteId,
        result.status,
        result.score,
        result.decision,
        result.decision_basis
      )
    : undefined
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

/** Start a guided photo report near a site. Fails with 503 when photo checks are down. */
export async function startCapture(input: {
  siteId: string
  lat: number
  lon: number
}): Promise<CaptureSession> {
  const session = await unwrapData(
    api.POST('/api/captures', {
      body: {
        site_id: input.siteId,
        latitude: input.lat,
        longitude: input.lon,
      },
    })
  )
  return toCaptureSession(session)
}

/** Send one step's photo(s) (base64 JPEG) for checking. */
export async function sendCaptureFrame(
  captureId: string,
  input: {
    item: string
    images: string[]
    lat: number
    lon: number
    headingDeg?: number
  }
): Promise<{ session: CaptureSession; feedback: CaptureFeedback }> {
  const result = await unwrapData(
    api.POST('/api/captures/{capture_id}/frames', {
      params: { path: { capture_id: captureId } },
      body: {
        item: input.item,
        images: input.images,
        latitude: input.lat,
        longitude: input.lon,
        heading_deg: input.headingDeg ?? null,
      },
    })
  )
  return {
    session: toCaptureSession(result.session),
    feedback: toCaptureFeedback(result.feedback),
  }
}

export async function chooseCaptureType(
  captureId: string,
  type: HazardReportType
): Promise<CaptureSession> {
  const session = await unwrapData(
    api.POST('/api/captures/{capture_id}/hazard', {
      params: { path: { capture_id: captureId } },
      body: { hazard_type: hazardFromReportType(type) },
    })
  )
  return toCaptureSession(session)
}

export async function skipCaptureStep(
  captureId: string,
  item: string
): Promise<CaptureSession> {
  const session = await unwrapData(
    api.POST('/api/captures/{capture_id}/skip', {
      params: { path: { capture_id: captureId } },
      body: { item },
    })
  )
  return toCaptureSession(session)
}

/** Send the finished capture as a crew report with the crew's final note. */
export async function submitCapture(
  captureId: string,
  note: string
): Promise<HazardReport> {
  const report = await unwrapData(
    api.POST('/api/captures/{capture_id}/submit', {
      params: { path: { capture_id: captureId } },
      body: { description: note },
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

/** Administrative review, using the server's audited alert transition API. */
export async function updateAlertStatus(input: {
  alertId: string
  status: 'ACKNOWLEDGED' | 'RESOLVED'
  reason: string
}): Promise<Alert> {
  return toAlert(
    await unwrapData(
      api.PATCH('/api/alerts/{alert_id}', {
        params: { path: { alert_id: input.alertId } },
        body: { status: input.status, reason: input.reason },
      })
    )
  )
}

/** Admins may correct report text; original hazard, pin and timestamp are retained. */
export async function updateHazardReport(input: {
  reportId: string
  note: string
}): Promise<HazardReport> {
  return toHazardReport(
    await unwrapData(
      api.PATCH('/api/reports/{report_id}', {
        params: { path: { report_id: input.reportId } },
        body: { description: input.note },
      })
    )
  )
}

export async function deleteHazardReport(reportId: string): Promise<void> {
  await unwrapEmpty(
    api.DELETE('/api/reports/{report_id}', {
      params: { path: { report_id: reportId } },
    })
  )
}
