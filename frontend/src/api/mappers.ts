import { ALERT_TYPE_LABEL, recommendationFromScore } from '@/lib/planit'
import { type components } from './schema'
import {
  type Alert,
  type AlertSeverity,
  type AlertType,
  type Briefing,
  type CaptureFeedback,
  type CaptureSession,
  type BriefingHistoryEntry,
  type BriefingSite,
  type DomainStatus,
  type HazardDomain,
  type HazardIndexPoint,
  type HazardReport,
  type HazardReportStatus,
  type LightningStrike,
  type ReasonContribution,
  type Recommendation,
  type RiskStatus,
  type SeverityLevel,
  type Site,
  type SiteRisk,
  type TimelinePoint,
  type Trend,
} from './types'

/**
 * Pure DTO → view-model mapping. Everything here is derived from what the core
 * API returns; nothing is simulated.
 */

type Schemas = components['schemas']
export type SiteDTO = Schemas['SiteRead']
export type RiskDTO = Schemas['RiskRead']
export type AlertDTO = Schemas['AlertRead']
export type ObservationDTO = Schemas['ObservationRead']
export type SiteObservationDTO = Schemas['SiteObservationRead']
type ReportDTO = Schemas['CrewReportRead']
type CaptureSessionDTO = Schemas['CaptureSessionRead']
type CaptureFeedbackDTO = Schemas['CaptureFeedback']
export type BriefingDTO = Schemas['BriefingRead']
type BackendHazard = Schemas['HazardType']

type Json = Record<string, unknown>

function asRecord(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {}
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// ---------------------------------------------------------------------------
// Hazard vocabularies

/** Backend hazard types and ML hazard keys onto the UI's domains. */
const DOMAIN_BY_HAZARD: Record<string, HazardDomain> = {
  weather: 'storm',
  convective: 'storm',
  heat: 'heat',
  lightning: 'lightning',
  flood: 'flood',
  wildfire: 'wildfire',
  soil: 'soil',
  wildlife: 'wildlife',
}

function domainFromHazard(hazard: string): HazardDomain | undefined {
  return DOMAIN_BY_HAZARD[hazard]
}

function alertTypeFromHazard(hazard: BackendHazard): AlertType {
  return hazard === 'weather' ? 'storm' : hazard
}

export function hazardFromReportType(type: AlertType): BackendHazard {
  return type === 'storm' ? 'weather' : type
}

const DOMAIN_LABEL: Record<HazardDomain, string> = {
  heat: 'Heat',
  lightning: 'Lightning',
  flood: 'Flood',
  storm: 'Storms & weather',
  wildfire: 'Wildfire',
  soil: 'Ground / soil',
  wildlife: 'Wildlife',
}

const SEVERITY_ORDER: SeverityLevel[] = [
  'unknown',
  'low',
  'moderate',
  'high',
  'extreme',
]

function maxSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b
}

/** 0-10 score onto the four-step severity scale. */
function severityFromScore(score: number): SeverityLevel {
  if (score >= 7.5) return 'extreme'
  if (score >= 5) return 'high'
  if (score >= 2.5) return 'moderate'
  return 'low'
}

function severityFromBackend(
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNKNOWN'
): SeverityLevel {
  return {
    LOW: 'low',
    MODERATE: 'moderate',
    HIGH: 'high',
    CRITICAL: 'extreme',
    UNKNOWN: 'unknown',
  }[severity] as SeverityLevel
}

const ALERT_SEVERITY: Record<Schemas['Severity'], AlertSeverity> = {
  CRITICAL: 'critical',
  HIGH: 'warning',
  MODERATE: 'warning',
  LOW: 'info',
}

// ---------------------------------------------------------------------------
// Sites

export function toSite(dto: SiteDTO): Site {
  return {
    id: dto.id,
    eiaPlantId: String(dto.eia_plant_id),
    name: dto.name,
    utility: dto.operator_name ?? 'Unknown operator',
    county: dto.county ?? 'Unknown',
    state: dto.state,
    lat: dto.latitude,
    lon: dto.longitude,
    plantType: dto.plant_type ?? dto.primary_energy_source ?? 'Other',
    timezone: dto.timezone,
    mlSupported: dto.ml_supported,
  }
}

// ---------------------------------------------------------------------------
// Risk

const RECOMMENDATION: Record<string, Recommendation> = {
  go: 'GO',
  caution: 'CAUTION',
  'no-go': 'NO-GO',
  GO: 'GO',
  CAUTION: 'CAUTION',
  NO_GO: 'NO-GO',
  REVIEW_REQUIRED: 'REVIEW REQUIRED',
}

function toRiskStatus(status: string): RiskStatus {
  return status === 'available' ||
    status === 'stale' ||
    status === 'unsupported'
    ? status
    : 'missing'
}

function toReasons(dto: RiskDTO): ReasonContribution[] {
  const raw = (dto.top_drivers ?? [])
    .map((driver) => ({
      domain: domainFromHazard(driver.hazard),
      severity: severityFromBackend(driver.severity),
      impact: driver.impact,
      text: driver.explanation,
      method: driver.explanation_method,
    }))
    .filter((driver): driver is typeof driver & { domain: HazardDomain } =>
      Boolean(driver.domain && driver.impact > 0 && driver.text)
    )
  const total = raw.reduce((sum, reason) => sum + reason.impact, 0)
  return raw.map((reason) => ({
    domain: reason.domain,
    label: reason.text,
    severity: reason.severity,
    contribution: total > 0 ? reason.impact / total : 0,
    impact: reason.impact,
    explanationMethod: reason.method,
    detail: `${DOMAIN_LABEL[reason.domain]} · ${SEVERITY_LABEL_TEXT[reason.severity]} · +${reason.impact.toFixed(1)} to its sub-score · ${reason.method === 'tree_shap' ? 'ML TreeSHAP explanation' : 'rule-based contribution'}`,
  }))
}

const SEVERITY_LABEL_TEXT: Record<SeverityLevel, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  extreme: 'Critical',
  unknown: 'Unknown',
}

function toSubScores(factors: Json): SiteRisk['subScores'] {
  const result: SiteRisk['subScores'] = {}
  for (const [hazard, value] of Object.entries(asRecord(factors.sub_scores))) {
    const domain = domainFromHazard(hazard)
    const score = asNumber(value)
    if (domain && score !== undefined) {
      result[domain] = Math.max(result[domain] ?? 0, score)
    }
  }
  return result
}

function toWorkPlan(factors: Json): string[] {
  const plan = asRecord(factors.work_plan)
  const windows = asArray(plan.work_windows).map((window) => {
    const text =
      asString(window.text) ??
      `${asString(window.start) ?? '?'} to ${asString(window.end) ?? '?'}`
    return `Work window ${text}`
  })
  const avoid = asArray(plan.avoid).map((span) => {
    const text = asString(span.text)
    if (text) return text
    const why = asString(span.why)
    return `Avoid ${asString(span.start) ?? '?'} to ${asString(span.end) ?? '?'}${why ? ` (${why})` : ''}`
  })
  return [...avoid, ...windows]
}

export function toSiteRisk(
  siteId: string,
  status: string,
  dto: RiskDTO | null | undefined,
  decision?: 'GO' | 'CAUTION' | 'NO_GO' | 'REVIEW_REQUIRED',
  decisionBasis: string[] = []
): SiteRisk {
  const riskStatus = toRiskStatus(status)
  if (!dto) {
    return {
      siteId,
      status: riskStatus,
      score: null,
      severity: null,
      recommendation: RECOMMENDATION[decision ?? ''] ?? null,
      decisionBasis,
      reasons: [],
      subScores: {},
      workPlan: [],
    }
  }
  const factors = asRecord(dto.contributing_factors)
  return {
    siteId,
    status: riskStatus,
    score: dto.score,
    severity: severityFromScore(dto.score),
    recommendation:
      RECOMMENDATION[decision ?? ''] ?? recommendationFromScore(dto.score),
    decisionBasis,
    reasons: toReasons(dto),
    subScores: toSubScores(factors),
    workPlan: toWorkPlan(factors),
    modelVersion: dto.model_version,
    scoreSource: dto.score_source,
    predictionDate: dto.prediction_date,
    updatedAt: dto.generated_at,
  }
}

export function toHazardIndexPoint(dto: RiskDTO): HazardIndexPoint {
  return {
    date: dto.prediction_date,
    score: dto.score,
  }
}

/** Direction of the hazard index across the two most recent prediction dates. */
export function trendFromHistory(
  points: HazardIndexPoint[]
): Trend | undefined {
  if (points.length < 2) return undefined
  const delta =
    points[points.length - 1].score - points[points.length - 2].score
  if (delta >= 0.3) return 'rising'
  if (delta <= -0.3) return 'falling'
  return 'steady'
}

// ---------------------------------------------------------------------------
// Alerts

export function toAlert(dto: AlertDTO): Alert {
  const details = asRecord(dto.details)
  const type = alertTypeFromHazard(dto.hazard_type)
  const alert: Alert = {
    id: dto.id,
    siteId: dto.site_id,
    type,
    severity: ALERT_SEVERITY[dto.severity],
    status:
      dto.status === 'RESOLVED'
        ? 'resolved'
        : dto.status === 'ALL_CLEAR_ELIGIBLE'
          ? 'all-clear'
          : 'active',
    title: dto.title,
    message: dto.message,
    action: dto.recommended_action,
    createdAt: dto.triggered_at,
  }
  if (type === 'lightning') {
    if (dto.expires_at) alert.allClearAt = dto.expires_at
    const distance = asNumber(details.distance_miles)
    if (distance !== undefined)
      alert.distanceMi = Math.round(distance * 10) / 10
  }
  return alert
}

// ---------------------------------------------------------------------------
// Observations

const KMH_PER_MPH = 1.609344
const MM_PER_INCH = 25.4

function celsiusToF(value: number): number {
  return (value * 9) / 5 + 32
}

/** Readable label and value for one stored observation. */
function describeObservation(dto: ObservationDTO): {
  label: string
  display: string
} {
  const value = dto.numeric_value
  const metadata = asRecord(dto.metadata)
  switch (dto.metric_name) {
    case 'calculated_heat_index':
      return {
        label: 'Heat index',
        display: value === null ? '—' : `${Math.round(value)}°F`,
      }
    case 'forecast_temperature':
    case 'temperature': {
      const f =
        value === null ? null : dto.unit === 'degC' ? celsiusToF(value) : value
      return {
        label:
          dto.metric_name === 'temperature' ? 'Temperature' : 'Forecast high',
        display: f === null ? '—' : `${Math.round(f)}°F`,
      }
    }
    case 'wind_speed':
      return {
        label: 'Wind',
        display:
          value === null ? '—' : `${Math.round(value / KMH_PER_MPH)} mph`,
      }
    case 'precipitation_accumulation':
      return {
        label: 'Rainfall (1 h)',
        display:
          value === null ? '—' : `${(value / MM_PER_INCH).toFixed(2)} in`,
      }
    case 'lightning_strike_distance':
      return {
        label: 'Nearest strike',
        display: value === null ? '—' : `${value.toFixed(1)} mi`,
      }
    case 'satellite_active_fire_detection': {
      const distance = asNumber(metadata.distance_miles)
      return {
        label: 'Satellite fire detection',
        display:
          distance === undefined ? 'Detected' : `${distance.toFixed(1)} mi`,
      }
    }
    case 'crew_wildlife_sighting':
      return { label: 'Crew wildlife sighting', display: 'Reported' }
    case 'official_alert':
      return {
        label: 'Official alert',
        display:
          asString(metadata.event) ?? asString(metadata.headline) ?? 'Active',
      }
    default: {
      const label = dto.metric_name.replace(/_/g, ' ')
      return {
        label: label.charAt(0).toUpperCase() + label.slice(1),
        display:
          value === null
            ? '—'
            : `${Number(value.toFixed(2))}${dto.unit ? ` ${dto.unit.replace(/_/g, ' ')}` : ''}`,
      }
    }
  }
}

/**
 * One row per hazard domain that has any evidence: a stored observation, a
 * model sub-score, or an active alert. When an observation is displayed, its
 * backend-classified severity is used so the value and label always describe
 * the same metric and timestamp. Alerts may raise that severity.
 */
export function buildDomains(
  observations: ObservationDTO[],
  subScores: SiteRisk['subScores'],
  alerts: Alert[]
): DomainStatus[] {
  const latest = new Map<HazardDomain, ObservationDTO>()
  for (const observation of [...observations].sort((a, b) =>
    b.observed_at.localeCompare(a.observed_at)
  )) {
    const domain = domainFromHazard(observation.hazard_type)
    if (domain && !latest.has(domain)) latest.set(domain, observation)
  }

  const alertSeverity = new Map<HazardDomain, SeverityLevel>()
  for (const alert of alerts) {
    if (alert.status === 'resolved') continue
    const level: SeverityLevel =
      alert.severity === 'critical'
        ? 'extreme'
        : alert.severity === 'warning'
          ? 'high'
          : 'moderate'
    const domain = alert.type as HazardDomain
    alertSeverity.set(
      domain,
      maxSeverity(alertSeverity.get(domain) ?? 'low', level)
    )
  }

  const domains = new Set<HazardDomain>([
    ...latest.keys(),
    ...(Object.keys(subScores) as HazardDomain[]),
    ...alertSeverity.keys(),
  ])

  return [...domains]
    .map((domain): DomainStatus => {
      const observation = latest.get(domain)
      const subScore = subScores[domain]
      let severity: SeverityLevel = observation
        ? severityFromBackend(observation.severity)
        : subScore !== undefined
          ? severityFromScore(subScore)
          : 'unknown'
      const fromAlert = alertSeverity.get(domain)
      if (fromAlert) severity = maxSeverity(severity, fromAlert)

      const described = observation ? describeObservation(observation) : null
      const parts: string[] = []
      if (described) parts.push(described.label)
      if (observation) parts.push(observation.severity_basis)
      if (subScore !== undefined) parts.push(`model ${subScore.toFixed(1)}/10`)
      if (fromAlert) parts.push('active alert')
      return {
        domain,
        label:
          observation?.metric_name === 'rainfall_flood_risk_proxy'
            ? 'Rainfall flood indicator'
            : DOMAIN_LABEL[domain],
        severity,
        display:
          described?.display ??
          (subScore !== undefined ? `${subScore.toFixed(1)} / 10` : 'Alert'),
        summary: parts.join(' · '),
        source: observation
          ? `${observation.source} · ${observation.quality_status}`
          : subScore !== undefined
            ? 'Hazard model'
            : 'Alert feed',
        updatedAt: observation?.observed_at,
      }
    })
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity)
    )
}

type TimelineMetric = 'heatIndex' | 'windMph' | 'precipIn'

function timelineValue(
  observation: ObservationDTO
): [TimelineMetric, number] | undefined {
  const value = observation.numeric_value
  if (value === null) return undefined
  switch (observation.metric_name) {
    case 'calculated_heat_index':
      return ['heatIndex', Math.round(value)]
    case 'wind_speed':
      return ['windMph', Math.round((value / KMH_PER_MPH) * 10) / 10]
    case 'precipitation_accumulation':
      return ['precipIn', Math.round((value / MM_PER_INCH) * 100) / 100]
    default:
      return undefined
  }
}

/** Hourly heat index, wind and rainfall from stored weather observations. */
export function buildTimeline(observations: ObservationDTO[]): TimelinePoint[] {
  const hours = new Map<string, TimelinePoint>()
  // Newest first, so the first value per metric and hour wins.
  const ordered = [...observations].sort((a, b) =>
    b.observed_at.localeCompare(a.observed_at)
  )
  for (const observation of ordered) {
    const reading = timelineValue(observation)
    if (!reading) continue
    const [metric, value] = reading
    const hour = new Date(observation.observed_at)
    hour.setMinutes(0, 0, 0)
    const t = hour.toISOString()
    const point = hours.get(t) ?? { t }
    if (point[metric] === undefined) point[metric] = value
    hours.set(t, point)
  }
  return [...hours.values()].sort((a, b) => a.t.localeCompare(b.t))
}

/** Strike observations for the map; one marker per strike even if it hit several sites. */
export function toStrikes(rows: SiteObservationDTO[]): LightningStrike[] {
  const byStrike = new Map<string, LightningStrike>()
  for (const { site, observation } of rows) {
    const distance = observation.numeric_value ?? 0
    const key = `${observation.source}:${observation.source_event_id}`
    const existing = byStrike.get(key)
    if (existing && existing.distanceMi <= distance) continue
    byStrike.set(key, {
      id: observation.id,
      siteId: observation.site_id,
      lat: observation.latitude ?? site.latitude,
      lon: observation.longitude ?? site.longitude,
      distanceMi: Math.round(distance * 10) / 10,
      at: observation.observed_at,
    })
  }
  return [...byStrike.values()]
}

/** Per-site strike observations (each carries its distance to that site). */
export function toSiteStrikes(
  observations: ObservationDTO[]
): LightningStrike[] {
  return observations
    .filter((observation) => observation.hazard_type === 'lightning')
    .filter(
      (observation) =>
        observation.latitude !== null && observation.longitude !== null
    )
    .map((observation) => ({
      id: observation.id,
      siteId: observation.site_id,
      lat: observation.latitude as number,
      lon: observation.longitude as number,
      distanceMi: Math.round((observation.numeric_value ?? 0) * 10) / 10,
      at: observation.observed_at,
    }))
}

// ---------------------------------------------------------------------------
// Crew reports

function toReportStatus(status: string): HazardReportStatus {
  if (status === 'unverified') return 'new'
  if (status === 'verified') return 'verified'
  return 'dismissed'
}

export function toHazardReport(dto: ReportDTO): HazardReport {
  return {
    id: dto.id,
    siteId: dto.site_id,
    type: alertTypeFromHazard(dto.hazard_type),
    note: dto.description,
    lat: dto.latitude,
    lon: dto.longitude,
    reportedBy: dto.reporter_subject,
    createdAt: dto.reported_at,
    status: toReportStatus(dto.verification_status),
  }
}

// ---------------------------------------------------------------------------
// Guided photo reports

export function toCaptureSession(dto: CaptureSessionDTO): CaptureSession {
  return {
    id: dto.id,
    siteId: dto.site_id,
    type: dto.hazard_type ? alertTypeFromHazard(dto.hazard_type) : undefined,
    status: dto.status,
    guided: dto.guided,
    nextStep: dto.next_step ?? undefined,
    checklist: dto.checklist.map((step) => ({
      item: step.item,
      instruction: step.instruction,
      frames: step.frames,
      status: step.status,
      text: step.text ?? undefined,
    })),
    draft: dto.draft,
    danger: dto.danger ?? undefined,
    reportId: dto.report_id ?? undefined,
  }
}

export function toCaptureFeedback(dto: CaptureFeedbackDTO): CaptureFeedback {
  return {
    item: dto.item,
    satisfied: dto.satisfied,
    text: dto.text ?? undefined,
    hint: dto.hint ?? undefined,
    typeGuess: dto.hazard_guess
      ? alertTypeFromHazard(dto.hazard_guess)
      : undefined,
    confidence: dto.confidence ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Briefings

function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(\s|$)/.exec(text.trim())
  return match ? match[1] : text.trim()
}

function generatorOf(dto: BriefingDTO): 'gemini' | 'template' {
  const source = asString(asRecord(dto.hazard_details).briefing_source) ?? ''
  return source.startsWith('gemini') ? 'gemini' : 'template'
}

const WATCH_TYPES: AlertType[] = [
  'lightning',
  'flood',
  'heat',
  'wildfire',
  'wildlife',
]

function compareScores(a: number | null, b: number | null): number {
  return (b ?? -1) - (a ?? -1)
}

/**
 * The fleet view for the most recent shift date: one entry per stored site
 * briefing, scored only when the site's latest risk is for that same date.
 */
export function buildFleetBriefing(
  rows: BriefingDTO[],
  risks: Map<string, SiteRisk>,
  activeAlerts: Alert[]
): Briefing | undefined {
  if (rows.length === 0) return undefined
  const shiftDate = rows.reduce(
    (latest, row) => (row.briefing_date > latest ? row.briefing_date : latest),
    rows[0].briefing_date
  )
  const current = rows.filter((row) => row.briefing_date === shiftDate)

  const sites: BriefingSite[] = current
    .map((row) => {
      const risk = risks.get(row.site_id)
      const scored = risk?.predictionDate === shiftDate ? risk : undefined
      return {
        siteId: row.site_id,
        score: scored?.score ?? null,
        recommendation: scored?.recommendation ?? null,
        headline: firstSentence(row.summary),
        summary: row.summary,
        actions: scored?.workPlan ?? [],
        generator: generatorOf(row),
      }
    })
    .sort((a, b) => compareScores(a.score, b.score))

  const calls = {
    GO: 0,
    CAUTION: 0,
    'NO-GO': 0,
    'REVIEW REQUIRED': 0,
  }
  for (const site of sites)
    if (site.recommendation) calls[site.recommendation] += 1
  const scoredCount = sites.filter((site) => site.score !== null).length
  const gemini = sites.filter((site) => site.generator === 'gemini').length

  const sitesWithAlert = new Map<AlertType, Set<string>>()
  for (const alert of activeAlerts) {
    if (alert.status === 'resolved') continue
    const set = sitesWithAlert.get(alert.type) ?? new Set<string>()
    set.add(alert.siteId)
    sitesWithAlert.set(alert.type, set)
  }
  const watchTypes = [
    ...WATCH_TYPES,
    ...[...sitesWithAlert.keys()].filter((type) => !WATCH_TYPES.includes(type)),
  ]
  const watchlist = watchTypes.map((type) => {
    const count = sitesWithAlert.get(type)?.size ?? 0
    return {
      type,
      label: ALERT_TYPE_LABEL[type],
      count,
      detail: `${count} site${count === 1 ? '' : 's'} with an active ${ALERT_TYPE_LABEL[type].toLowerCase()} alert`,
    }
  })
  const alertSites = new Set(activeAlerts.map((alert) => alert.siteId)).size

  const headline =
    scoredCount > 0
      ? `${calls['NO-GO']} NO-GO · ${calls.CAUTION} CAUTION · ${calls['REVIEW REQUIRED']} REVIEW · ${calls.GO} GO`
      : `${sites.length} site briefing${sites.length === 1 ? '' : 's'}`
  const summary = [
    `${sites.length} site briefing${sites.length === 1 ? '' : 's'} stored for this shift.`,
    `${scoredCount} ${scoredCount === 1 ? 'has' : 'have'} a model hazard index; ${sites.length - scoredCount} use the deterministic report and alert briefing.`,
    `${alertSites} site${alertSites === 1 ? '' : 's'} currently ${alertSites === 1 ? 'has' : 'have'} active alerts.`,
  ].join(' ')

  return {
    id: `briefings-${shiftDate}`,
    generatedAt: current.reduce(
      (latest, row) => (row.generated_at > latest ? row.generated_at : latest),
      current[0].generated_at
    ),
    shiftDate,
    headline,
    summary,
    sites,
    watchlist,
    generator: gemini > sites.length / 2 ? 'gemini' : 'template',
  }
}

/** Earlier shift dates, newest first. */
export function buildBriefingHistory(
  rows: BriefingDTO[]
): BriefingHistoryEntry[] {
  const byDate = new Map<string, BriefingHistoryEntry>()
  for (const row of rows) {
    const details = asRecord(row.hazard_details)
    const entry = byDate.get(row.briefing_date) ?? {
      shiftDate: row.briefing_date,
      sites: 0,
      fallback: 0,
      withAlerts: 0,
    }
    entry.sites += 1
    if (details.generation_status === 'fallback') entry.fallback += 1
    if (
      Array.isArray(details.active_alert_ids) &&
      details.active_alert_ids.length > 0
    )
      entry.withAlerts += 1
    byDate.set(row.briefing_date, entry)
  }
  return [...byDate.values()].sort((a, b) =>
    b.shiftDate.localeCompare(a.shiftDate)
  )
}
