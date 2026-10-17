/**
 * PlanIT Control — shared API contract.
 *
 * These types are the single source of truth for the boundary between the data
 * layer, the hazard-scoring service and the UI. Person A (data/alerts) and
 * Person B (ML/AI) can implement these shapes against real feeds without the
 * frontend changing.
 */

export type PlantType =
  | 'Nuclear'
  | 'Coal'
  | 'Natural Gas'
  | 'Hydro'
  | 'Solar'
  | 'Wind'
  | 'Petroleum'
  | 'Geothermal'
  | 'Biomass'
  | 'Storage'
  | 'Other'

/** A job site. Seeded from real EIA-860M power plant locations. */
export interface Site {
  id: string
  eiaPlantId: string
  name: string
  utility: string
  county: string
  state: string
  lat: number
  lon: number
  capacityMw: number
  plantType: PlantType | string
}

/** The hazard domains the platform fuses into one risk picture per site. */
export type HazardDomain =
  | 'heat'
  | 'lightning'
  | 'flood'
  | 'wildfire'
  | 'soil'
  | 'wildlife'
  | 'storm'

export type SeverityLevel = 'low' | 'moderate' | 'high' | 'extreme'

export type Trend = 'rising' | 'falling' | 'steady'

/** One fused domain reading for a site (weather, heat, lightning, ...). */
export interface DomainStatus {
  domain: HazardDomain
  label: string
  /** Normalized 0..1 hazard intensity used by the hazard index model. */
  value: number
  severity: SeverityLevel
  trend: Trend
  /** Human readable measurement, e.g. "108°F". */
  display: string
  unit: string
  summary: string
  source: string
  updatedAt: string
}

export type Recommendation = 'GO' | 'CAUTION' | 'NO-GO'

/** A single feature contribution in the hazard index explanation. */
export interface ReasonContribution {
  domain: HazardDomain
  label: string
  /** 0..1 share of the total score attributable to this feature. */
  contribution: number
  detail: string
}

/** The 0-10 hazard index plus the explanation and go/no-go call. */
export interface SiteRisk {
  siteId: string
  score: number
  severity: SeverityLevel
  recommendation: Recommendation
  reasons: ReasonContribution[]
  domains: DomainStatus[]
  trend: Trend
  modelVersion: string
  backtest: string
  updatedAt: string
}

export type AlertType =
  | 'lightning'
  | 'flood'
  | 'heat'
  | 'wildfire'
  | 'storm'
  | 'wildlife'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export type AlertStatus = 'active' | 'all-clear' | 'resolved'

export interface Alert {
  id: string
  siteId: string
  type: AlertType
  severity: AlertSeverity
  status: AlertStatus
  title: string
  message: string
  /** Recommended crew action, e.g. "Stop work and move to a safe structure". */
  action: string
  createdAt: string
  /** Lightning only: timestamp of the most recent strike within 10 miles. */
  lastStrikeAt?: string
  /** Lightning only: lastStrikeAt + 30 minutes. Resets on every new strike. */
  allClearAt?: string
  /** Lightning only: distance in miles to the nearest detected strike. */
  distanceMi?: number
  /** Lightning only: number of strikes inside the 10 mile radius. */
  strikeCount?: number
  channels: ('push' | 'sms' | 'email')[]
}

/** A lightning strike detected by the GLM/NLDN feed. */
export interface LightningStrike {
  id: string
  siteId: string
  lat: number
  lon: number
  distanceMi: number
  /** 0..1 relative intensity. */
  intensity: number
  at: string
}

export type HazardReportStatus = 'new' | 'verified' | 'dismissed'

export type ReporterRole = 'crew' | 'supervisor'

/** Crew reports can also cover ground conditions (soil) which are not alerts. */
export type HazardReportType = AlertType | 'soil'

/** A crew-submitted hazard pinned to the map and shared with the network. */
export interface HazardReport {
  id: string
  siteId: string
  type: HazardReportType
  severity: AlertSeverity
  note: string
  photoUrl?: string
  lat: number
  lon: number
  reportedBy: string
  reporterRole: ReporterRole
  createdAt: string
  status: HazardReportStatus
  confirmations: number
}

export type NewHazardReport = Pick<
  HazardReport,
  | 'siteId'
  | 'type'
  | 'severity'
  | 'note'
  | 'lat'
  | 'lon'
  | 'reportedBy'
  | 'reporterRole'
> & { photoUrl?: string }

export interface BriefingSite {
  siteId: string
  score: number
  recommendation: Recommendation
  headline: string
  actions: string[]
}

/** The 6 PM local-time next-day safety briefing. */
export interface Briefing {
  id: string
  /** Scheduled send time (18:00 local on the day before the shift). */
  sendAt: string
  generatedAt: string
  /** ISO date of the shift day the briefing covers. */
  shiftDate: string
  headline: string
  summary: string
  sites: BriefingSite[]
  watchlist: { label: string; detail: string }[]
  /** Which model produced the narrative. */
  generator: 'gemini' | 'template'
  smsPreview: string
}

export interface TimelinePoint {
  t: string
  heatIndex: number
  windMph: number
  precipIn: number
  hazardIndex: number
}

export interface DashboardSummary {
  sites: number
  noGo: number
  caution: number
  go: number
  activeAlerts: number
  lightningAlerts: number
  crewReports24h: number
  avgScore: number
}

export interface HazardIndexPoint {
  date: string
  score: number
}
