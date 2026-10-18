/**
 * Precognition — UI view model.
 *
 * Components render these shapes. `src/api/mappers.ts` builds them from the
 * core API's DTOs (generated in `schema.d.ts`), so backend field names never
 * leak into the UI. Fields the backend cannot supply are optional and the UI
 * hides them rather than inventing values.
 */

/** A monitored site. Seeded from EIA-860M power plant reference locations. */
export interface Site {
  id: string
  eiaPlantId: string
  name: string
  utility: string
  county: string
  state: string
  lat: number
  lon: number
  /** Not stored by the bundled EIA import; shown only when present. */
  capacityMw?: number
  plantType: string
  timezone: string
  /** Whether the site is in the ML model catalog (otherwise it has no score). */
  mlSupported: boolean
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

export type SeverityLevel = 'low' | 'moderate' | 'high' | 'extreme' | 'unknown'

export type Trend = 'rising' | 'falling' | 'steady'

/** One fused domain reading for a site (weather, heat, lightning, ...). */
export interface DomainStatus {
  domain: HazardDomain
  label: string
  severity: SeverityLevel
  trend?: Trend
  /** Human readable measurement, e.g. "108°F". */
  display: string
  summary: string
  source: string
  updatedAt?: string
}

export type Recommendation = 'GO' | 'CAUTION' | 'NO-GO' | 'REVIEW REQUIRED'

/** Backend availability of a site's hazard index. Absent scores are never zero. */
export type RiskStatus = 'available' | 'missing' | 'stale' | 'unsupported'

/** A single feature contribution in the hazard index explanation. */
export interface ReasonContribution {
  domain: HazardDomain
  label: string
  severity: SeverityLevel
  /** 0..1 share of the displayed explanation impacts, not of the overall index. */
  contribution: number
  /** Change in the hazard's 0-10 sub-score attributed to this feature. */
  impact: number
  explanationMethod: 'tree_shap' | 'rule_based'
  detail: string
}

/** The 0-10 hazard index plus the explanation and go/no-go call. */
export interface SiteRisk {
  siteId: string
  status: RiskStatus
  /** Null when the site has no score (unsupported or missing). */
  score: number | null
  severity: SeverityLevel | null
  recommendation: Recommendation | null
  decisionBasis: string[]
  reasons: ReasonContribution[]
  /** 0-10 per-hazard sub-scores from the model, keyed by UI domain. */
  subScores: Partial<Record<HazardDomain, number>>
  /** Next-day work plan from the model, as readable lines. */
  workPlan: string[]
  trend?: Trend
  modelVersion?: string
  scoreSource?: string
  predictionDate?: string
  updatedAt?: string
}

export type AlertType =
  | 'lightning'
  | 'flood'
  | 'heat'
  | 'wildfire'
  | 'storm'
  | 'wildlife'
  | 'soil'

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
  /** Lightning only: when the 30-minute window after the latest strike ends. */
  allClearAt?: string
  /** Lightning only: distance in miles to the qualifying strike. */
  distanceMi?: number
  /** Lightning only: number of strikes inside the radius, when known. */
  strikeCount?: number
}

/** A lightning strike observation recorded for a site. */
export interface LightningStrike {
  id: string
  siteId: string
  lat: number
  lon: number
  distanceMi: number
  at: string
}

export type HazardReportStatus = 'new' | 'verified' | 'dismissed'

/** Crew reports can also cover ground conditions (soil) which are not alerts. */
export type HazardReportType = AlertType

/** A crew-submitted hazard pinned to the map and shared with the network. */
export interface HazardReport {
  id: string
  siteId: string
  type: HazardReportType
  note: string
  lat: number
  lon: number
  reportedBy: string
  createdAt: string
  status: HazardReportStatus
}

export type NewHazardReport = Pick<
  HazardReport,
  'siteId' | 'type' | 'note' | 'lat' | 'lon'
>

/** One step of a guided photo report: what the crew is asked to point the camera at. */
export interface CaptureStep {
  item: string
  instruction: string
  /** Photos the step takes; the flow step takes two, a couple of seconds apart. */
  frames: number
}

export interface CaptureChecklistItem extends CaptureStep {
  status: 'pending' | 'done' | 'skipped'
  /** What the photo showed, once the step is done. */
  text?: string
}

/** A guided photo report in progress, as the core API tracks it. */
export interface CaptureSession {
  id: string
  siteId: string
  type?: HazardReportType
  status: 'active' | 'stopped' | 'submitted'
  /** Whether the hazard has a guided checklist (only flood, for now). */
  guided: boolean
  nextStep?: CaptureStep
  checklist: CaptureChecklistItem[]
  /** The report note joined from what each photo showed. */
  draft: string
  danger?: { code: string; instruction: string; summary: string }
  reportId?: string
}

/** What one photo check found. */
export interface CaptureFeedback {
  item: string
  satisfied: boolean
  text?: string
  /** How to retake the shot when it didn't answer the step. */
  hint?: string
  typeGuess?: HazardReportType
  confidence?: number
}

export interface BriefingSite {
  siteId: string
  score: number | null
  recommendation: Recommendation | null
  headline: string
  summary: string
  actions: string[]
  generator: 'gemini' | 'template'
}

/** The fleet view of the next-day safety briefings stored for one shift date. */
export interface Briefing {
  id: string
  generatedAt: string
  /** ISO date of the shift day the briefing covers. */
  shiftDate: string
  headline: string
  summary: string
  sites: BriefingSite[]
  watchlist: { type: AlertType; label: string; detail: string; count: number }[]
  /** Which generator produced most of the site narratives. */
  generator: 'gemini' | 'template'
}

/** A past shift date and how many site briefings were stored for it. */
export interface BriefingHistoryEntry {
  shiftDate: string
  sites: number
  fallback: number
  withAlerts: number
}

export interface TimelinePoint {
  t: string
  heatIndex?: number
  windMph?: number
  precipIn?: number
}

export interface HazardIndexPoint {
  date: string
  score: number
}
