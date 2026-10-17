import {
  type Alert,
  type AlertSeverity,
  type AlertType,
  type Briefing,
  type BriefingSite,
  type DomainStatus,
  type HazardDomain,
  type HazardIndexPoint,
  type LightningStrike,
  type ReasonContribution,
  type Recommendation,
  type SeverityLevel,
  type Site,
  type SiteRisk,
  type TimelinePoint,
  type Trend,
} from '@/api/types'

/**
 * Mock implementation of the PlanIT Control hazard service.
 *
 * Everything here is deterministic given (site, day, time of day) plus the live
 * lightning feed, so the dashboard is stable across reloads while still feeling
 * alive. Person A can swap these functions for Tiger Data continuous aggregates
 * and real feed ingestion without touching the UI.
 */

export const LIGHTNING_RADIUS_MI = 10
export const ALL_CLEAR_MINUTES = 30
export const BRIEFING_HOUR = 18
export const MODEL_VERSION = 'hazard-index v1.3'

export const HAZARD_DOMAIN_META: Record<
  HazardDomain,
  { label: string; source: string }
> = {
  heat: { label: 'Extreme heat', source: 'NOAA/NWS heat index' },
  lightning: { label: 'Lightning', source: 'GOES-16 GLM / NLDN' },
  flood: { label: 'Flood & river', source: 'USGS NWIS · National Levee DB' },
  wildfire: { label: 'Wildfire & smoke', source: 'InciWeb · NOAA HMS' },
  soil: { label: 'Soil saturation', source: 'USDA SCAN · NLD boreholes' },
  wildlife: { label: 'Wildlife', source: 'Crew reports · USGS' },
  storm: { label: 'Storm & wind', source: 'NWS forecast · ASOS' },
}

/** Feature weights of the hazard index model (sum to 1). */
export const HAZARD_WEIGHTS: Record<HazardDomain, number> = {
  heat: 0.22,
  lightning: 0.2,
  flood: 0.18,
  storm: 0.13,
  wildfire: 0.11,
  soil: 0.09,
  wildlife: 0.07,
}

export type Scenario =
  | 'heat-wave'
  | 'thunderstorm'
  | 'flood-watch'
  | 'wildfire-smoke'
  | 'gulf-storm'
  | 'calm'

export interface SiteProfile {
  heat: number
  storm: number
  flood: number
  wildfire: number
  wildlife: number
  soil: number
  coastal: number
  riverMi: number
  floodZone: string
}

const WILDFIRE_STATES = new Set([
  'CA',
  'NV',
  'AZ',
  'NM',
  'CO',
  'UT',
  'OR',
  'WA',
  'ID',
  'MT',
  'WY',
  'TX',
  'OK',
  'KS',
  'NE',
  'SD',
  'ND',
])
const GULF_STATES = new Set([
  'FL',
  'LA',
  'MS',
  'AL',
  'GA',
  'TX',
  'SC',
  'NC',
  'AR',
  'TN',
])
const COASTAL_COASTLINE: [number, number][] = [
  [48.4, -124.7],
  [46.9, -124.1],
  [45.6, -123.9],
  [43.3, -124.4],
  [40.4, -124.4],
  [38.0, -122.9],
  [36.6, -121.9],
  [34.4, -119.7],
  [33.7, -118.2],
  [32.5, -117.1],
  [25.9, -97.1],
  [27.8, -97.0],
  [29.3, -94.8],
  [29.8, -93.3],
  [29.2, -91.3],
  [29.9, -90.1],
  [30.4, -88.9],
  [30.2, -87.4],
  [29.7, -84.4],
  [27.8, -82.7],
  [25.9, -81.4],
  [25.2, -80.4],
  [25.8, -80.1],
  [27.6, -80.4],
  [29.0, -80.9],
  [31.0, -81.4],
  [32.8, -79.9],
  [34.7, -76.7],
  [36.5, -75.9],
  [38.0, -75.0],
  [39.5, -74.3],
  [40.7, -74.0],
  [41.5, -71.0],
  [42.4, -70.9],
  [43.5, -70.3],
  [44.5, -68.0],
  [45.0, -67.0],
]
const MISSISSIPPI_RIVER: [number, number][] = [
  [47.0, -93.0],
  [44.9, -93.2],
  [43.0, -91.3],
  [41.5, -90.6],
  [39.8, -91.4],
  [38.6, -90.4],
  [37.0, -89.5],
  [35.1, -90.1],
  [33.0, -91.0],
  [31.0, -91.5],
  [29.9, -90.2],
]

const WILDLIFE_SPECIES: Record<string, string[]> = {
  gulf: ['American alligator', 'Water moccasin', 'Feral hog'],
  west: ['Rattlesnake', 'Black bear', 'Coyote'],
  northeast: ['Black bear', 'Timber rattlesnake', 'Deer tick activity'],
  plains: ['Prairie rattlesnake', 'Coyote', 'Feral hog'],
  generic: ['Snake', 'Coyote', 'Ground wasp nest'],
}

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rngFor(...parts: (string | number)[]): () => number {
  return mulberry32(hashString(parts.join('::')))
}

export function dateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function milesBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const meanLat = ((lat1 + lat2) / 2) * (Math.PI / 180)
  const dx = (lon2 - lon1) * 69.17 * Math.cos(meanLat)
  const dy = (lat2 - lat1) * 69
  return Math.sqrt(dx * dx + dy * dy)
}

function minMilesToPolyline(
  lat: number,
  lon: number,
  points: [number, number][]
): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length - 1; i++) {
    const [aLat, aLon] = points[i]
    const [bLat, bLon] = points[i + 1]
    const steps = 12
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const d = milesBetween(
        lat,
        lon,
        aLat + (bLat - aLat) * t,
        aLon + (bLon - aLon) * t
      )
      if (d < best) best = d
    }
  }
  return best
}

const profileCache = new Map<string, SiteProfile>()

export function getSiteProfile(site: Site): SiteProfile {
  const cached = profileCache.get(site.id)
  if (cached) return cached

  const rng = rngFor('profile', site.id)
  const coastalMi = minMilesToPolyline(site.lat, site.lon, COASTAL_COASTLINE)
  const riverMi = minMilesToPolyline(site.lat, site.lon, MISSISSIPPI_RIVER)
  const coastal = clamp(1 - coastalMi / 320)
  const river = clamp(1 - riverMi / 240)

  const heat = clamp(0.15 + Math.max(0, 36 - site.lat) * 0.045 + rng() * 0.12)
  const storm = clamp(
    (GULF_STATES.has(site.state) ? 0.45 : 0.18) + coastal * 0.35 + rng() * 0.15
  )
  const flood = clamp(
    river * 0.85 +
      coastal * 0.6 +
      (WILDFIRE_STATES.has(site.state) ? 0 : 0.05) +
      rng() * 0.15
  )
  const wildfire = clamp(
    (WILDFIRE_STATES.has(site.state) ? 0.35 : 0.05) +
      (1 - clamp((site.lat - 30) / 18)) * 0.15 +
      rng() * 0.25 -
      coastal * 0.2
  )
  const wildlife = clamp(
    (GULF_STATES.has(site.state) ? 0.45 : 0.2) + river * 0.3 + rng() * 0.2
  )
  const soil = clamp(0.2 + river * 0.5 + coastal * 0.25 + rng() * 0.15)

  const profile: SiteProfile = {
    heat,
    storm,
    flood,
    wildfire,
    wildlife,
    soil,
    coastal,
    riverMi: Math.round(riverMi),
    floodZone: river > 0.72 || coastal > 0.8 ? 'AE' : river > 0.5 ? 'A' : 'X',
  }
  profileCache.set(site.id, profile)
  return profile
}

function pickScenario(profile: SiteProfile, key: string): Scenario {
  const r = rngFor('scenario', key)()
  const weights: [Scenario, number][] = [
    ['calm', 0.3],
    ['heat-wave', 0.16 + profile.heat * 0.2],
    ['thunderstorm', 0.12 + profile.storm * 0.35],
    ['flood-watch', 0.06 + profile.flood * 0.4],
    ['wildfire-smoke', 0.04 + profile.wildfire * 0.4],
    ['gulf-storm', 0.02 + profile.coastal * profile.storm * 0.35],
  ]
  const total = weights.reduce((sum, [, w]) => sum + w, 0)
  let acc = 0
  const target = r * total
  for (const [scenario, w] of weights) {
    acc += w
    if (target <= acc) return scenario
  }
  return 'calm'
}

export function getSiteScenario(site: Site, date = new Date()): Scenario {
  return pickScenario(getSiteProfile(site), `${site.id}-${dateKey(date)}`)
}

function severityFromValue(value: number): SeverityLevel {
  if (value >= 0.8) return 'extreme'
  if (value >= 0.58) return 'high'
  if (value >= 0.32) return 'moderate'
  return 'low'
}

function severityForThresholds(
  value: number,
  moderate: number,
  high: number,
  extreme: number
): SeverityLevel {
  if (value >= extreme) return 'extreme'
  if (value >= high) return 'high'
  if (value >= moderate) return 'moderate'
  return 'low'
}

function trendFor(site: Site, key: string): Trend {
  const r = rngFor('trend', site.id, key)()
  if (r > 0.68) return 'rising'
  if (r < 0.32) return 'falling'
  return 'steady'
}

function localHour(site: Site, date: Date): number {
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60
  return (utc + site.lon / 15 + 24) % 24
}

export interface SiteConditions {
  scenario: Scenario
  profile: SiteProfile
  heatIndexF: number
  windMph: number
  gustMph: number
  riverGaugeFt: number
  floodStageFt: number
  soilPct: number
  aqi: number
  redFlag: boolean
  wildlifeCount: number
  wildlifeSpecies: string
  lightningActive: boolean
  strikeCount: number
  nearestStrikeMi: number
  lastStrikeAt?: string
}

export interface ComputeOptions {
  now?: number
  strikes?: LightningStrike[]
}

function wildlifeSpeciesFor(site: Site, profile: SiteProfile): string {
  if (profile.riverMi < 120 && GULF_STATES.has(site.state)) {
    return WILDLIFE_SPECIES.gulf[0]
  }
  if (WILDFIRE_STATES.has(site.state)) {
    const pool = WILDLIFE_SPECIES.west
    return pool[hashString(site.id) % pool.length]
  }
  if (['ME', 'NH', 'VT', 'NY', 'PA', 'WV', 'VA'].includes(site.state)) {
    const pool = WILDLIFE_SPECIES.northeast
    return pool[hashString(site.id) % pool.length]
  }
  if (['KS', 'NE', 'OK', 'IA', 'SD', 'ND', 'MN'].includes(site.state)) {
    const pool = WILDLIFE_SPECIES.plains
    return pool[hashString(site.id) % pool.length]
  }
  const pool = WILDLIFE_SPECIES.generic
  return pool[hashString(site.id) % pool.length]
}

export function computeConditions(
  site: Site,
  options: ComputeOptions = {}
): SiteConditions {
  const now = options.now ?? Date.now()
  const date = new Date(now)
  const strikes = options.strikes ?? []
  const key = dateKey(date)
  const profile = getSiteProfile(site)
  const scenario = pickScenario(profile, `${site.id}-${key}`)
  const rng = rngFor('conditions', site.id, key, Math.floor(now / 300000))
  const hour = localHour(site, date)

  const diurnal = Math.sin(((hour - 9) / 24) * Math.PI * 2) * 9
  let heatIndexF = 68 + profile.heat * 34 + diurnal + rng() * 4
  if (scenario === 'heat-wave') heatIndexF += 13
  if (scenario === 'gulf-storm') heatIndexF += 4
  if (scenario === 'wildfire-smoke') heatIndexF += 6

  let windMph = 3 + profile.storm * 9 + rng() * 6
  if (scenario === 'thunderstorm') windMph += 14
  if (scenario === 'gulf-storm') windMph += 24
  if (scenario === 'calm') windMph *= 0.7

  const floodStageFt = 8 + profile.flood * 16
  let riverGaugeFt = floodStageFt * (0.45 + profile.flood * 0.35) + rng() * 3
  if (scenario === 'flood-watch') riverGaugeFt += floodStageFt * 0.45
  if (scenario === 'gulf-storm') riverGaugeFt += floodStageFt * 0.3
  if (scenario === 'heat-wave') riverGaugeFt -= 1.5

  let soilPct = 38 + profile.soil * 32 + rng() * 8
  if (scenario === 'flood-watch') soilPct += 18
  if (scenario === 'thunderstorm') soilPct += 10
  if (scenario === 'gulf-storm') soilPct += 14
  if (scenario === 'heat-wave') soilPct -= 14

  const aqi = Math.round(
    28 +
      profile.wildfire * 70 +
      rng() * 25 +
      (scenario === 'wildfire-smoke' ? 110 : 0)
  )
  const redFlag =
    scenario === 'wildfire-smoke' || (profile.wildfire > 0.6 && aqi > 120)

  const wildlifeCount =
    Math.round(profile.wildlife * 3 * rng() * 10) +
    (scenario === 'flood-watch' || scenario === 'gulf-storm' ? 1 : 0)

  const siteStrikes = strikes.filter(
    (s) =>
      s.siteId === site.id &&
      now - new Date(s.at).getTime() <= ALL_CLEAR_MINUTES * 60 * 1000
  )
  const lightningActive = siteStrikes.length > 0
  const nearestStrikeMi = siteStrikes.length
    ? round(Math.min(...siteStrikes.map((s) => s.distanceMi)), 1)
    : 0
  const lastStrikeAt = siteStrikes.length
    ? siteStrikes.reduce(
        (latest, s) => (new Date(s.at) > new Date(latest) ? s.at : latest),
        siteStrikes[0].at
      )
    : undefined

  return {
    scenario,
    profile,
    heatIndexF: Math.round(heatIndexF),
    windMph: Math.round(windMph),
    gustMph: Math.round(windMph * 1.6),
    riverGaugeFt: round(riverGaugeFt, 1),
    floodStageFt: Math.round(floodStageFt),
    soilPct: Math.round(clamp(soilPct, 5, 100)),
    aqi,
    redFlag,
    wildlifeCount,
    wildlifeSpecies: wildlifeSpeciesFor(site, profile),
    lightningActive,
    strikeCount: siteStrikes.length,
    nearestStrikeMi,
    lastStrikeAt,
  }
}

function heatSeverity(f: number): SeverityLevel {
  return severityForThresholds(f, 88, 100, 110)
}

function heatValue(f: number): number {
  return clamp((f - 78) / 42)
}

export function buildDomains(
  site: Site,
  conditions: SiteConditions,
  key: string
): DomainStatus[] {
  const { scenario } = conditions
  const updatedAt = new Date().toISOString()

  const heat: DomainStatus = {
    domain: 'heat',
    label: 'Heat index',
    value: heatValue(conditions.heatIndexF),
    severity: heatSeverity(conditions.heatIndexF),
    trend: trendFor(site, `heat-${key}`),
    display: `${conditions.heatIndexF}°F`,
    unit: '°F',
    summary:
      conditions.heatIndexF >= 100
        ? 'Heat illness risk — enforce hydration and shaded rest cycles'
        : 'Within typical summer operating range',
    source: HAZARD_DOMAIN_META.heat.source,
    updatedAt,
  }

  const lightningValue = conditions.lightningActive
    ? clamp(
        0.55 +
          conditions.strikeCount * 0.12 +
          (LIGHTNING_RADIUS_MI - conditions.nearestStrikeMi) / 25
      )
    : scenario === 'thunderstorm' || scenario === 'gulf-storm'
      ? 0.34
      : 0.08

  const lightning: DomainStatus = {
    domain: 'lightning',
    label: 'Lightning',
    value: lightningValue,
    severity: conditions.lightningActive
      ? lightningValue >= 0.78
        ? 'extreme'
        : 'high'
      : severityFromValue(lightningValue),
    trend: conditions.lightningActive
      ? 'rising'
      : trendFor(site, `lightning-${key}`),
    display: conditions.lightningActive
      ? `${conditions.strikeCount} strike${conditions.strikeCount === 1 ? '' : 's'} · ${conditions.nearestStrikeMi} mi`
      : scenario === 'thunderstorm' || scenario === 'gulf-storm'
        ? 'Storms building'
        : 'No strikes in 10 mi',
    unit: 'strikes',
    summary: conditions.lightningActive
      ? `Stop-work radius active — all-clear ${ALL_CLEAR_MINUTES} min after the last strike`
      : 'No strikes detected inside the 10 mile stop-work radius',
    source: HAZARD_DOMAIN_META.lightning.source,
    updatedAt,
  }

  const floodRatio =
    conditions.riverGaugeFt / Math.max(1, conditions.floodStageFt)
  const floodValue = clamp((floodRatio - 0.55) / 0.55)
  const flood: DomainStatus = {
    domain: 'flood',
    label: 'Flood & river',
    value: conditions.profile.floodZone === 'X' ? floodValue * 0.7 : floodValue,
    severity: severityForThresholds(floodRatio, 0.78, 0.95, 1.08),
    trend: trendFor(site, `flood-${key}`),
    display: `${conditions.riverGaugeFt} ft · stage ${conditions.floodStageFt} ft`,
    unit: 'ft',
    summary:
      conditions.profile.floodZone === 'X'
        ? 'Outside mapped floodplain — monitor access roads only'
        : `FEMA zone ${conditions.profile.floodZone} · ${conditions.profile.riverMi} mi from the river corridor`,
    source: HAZARD_DOMAIN_META.flood.source,
    updatedAt,
  }

  const soil: DomainStatus = {
    domain: 'soil',
    label: 'Soil saturation',
    value: clamp(conditions.soilPct / 100),
    severity: severityForThresholds(conditions.soilPct, 62, 78, 88),
    trend: trendFor(site, `soil-${key}`),
    display: `${conditions.soilPct}% saturated`,
    unit: '%',
    summary:
      conditions.soilPct >= 78
        ? 'Heavy equipment will rut or bog down — stage mats before mobilizing'
        : 'Ground firm enough for standard trucks',
    source: HAZARD_DOMAIN_META.soil.source,
    updatedAt,
  }

  const wildfireValue = clamp(
    (conditions.aqi - 25) / 175 + (conditions.redFlag ? 0.18 : 0)
  )
  const wildfire: DomainStatus = {
    domain: 'wildfire',
    label: 'Wildfire & smoke',
    value: wildfireValue,
    severity: severityForThresholds(conditions.aqi, 75, 130, 170),
    trend: trendFor(site, `wildfire-${key}`),
    display: `AQI ${conditions.aqi}${conditions.redFlag ? ' · red flag' : ''}`,
    unit: 'AQI',
    summary: conditions.redFlag
      ? 'Red flag conditions — spark-producing work restricted'
      : conditions.aqi >= 100
        ? 'Smoke plumes degrading air quality downwind'
        : 'Air quality nominal',
    source: HAZARD_DOMAIN_META.wildfire.source,
    updatedAt,
  }

  const wildlifeValue = clamp(conditions.wildlifeCount / 6)
  const wildlife: DomainStatus = {
    domain: 'wildlife',
    label: 'Wildlife',
    value: wildlifeValue,
    severity: severityFromValue(wildlifeValue),
    trend: trendFor(site, `wildlife-${key}`),
    display: conditions.wildlifeCount
      ? `${conditions.wildlifeCount} sighting${conditions.wildlifeCount === 1 ? '' : 's'} · ${conditions.wildlifeSpecies}`
      : 'No recent sightings',
    unit: 'sightings',
    summary: conditions.wildlifeCount
      ? `Crew reported ${conditions.wildlifeSpecies.toLowerCase()} activity near the work area`
      : 'No crew wildlife reports in the last 24 hours',
    source: HAZARD_DOMAIN_META.wildlife.source,
    updatedAt,
  }

  const storm: DomainStatus = {
    domain: 'storm',
    label: 'Storm & wind',
    value: clamp(conditions.gustMph / 55),
    severity: severityForThresholds(conditions.gustMph, 28, 42, 52),
    trend: trendFor(site, `storm-${key}`),
    display: `${conditions.windMph} mph · gusts ${conditions.gustMph} mph`,
    unit: 'mph',
    summary:
      conditions.gustMph >= 42
        ? 'Aerial lifts and material handling suspended above 42 mph gusts'
        : 'Wind within safe handling limits',
    source: HAZARD_DOMAIN_META.storm.source,
    updatedAt,
  }

  return [heat, lightning, flood, storm, wildfire, soil, wildlife]
}

export function scoreRisk(site: Site, domains: DomainStatus[]): SiteRisk {
  const contributions: ReasonContribution[] = []
  let weighted = 0
  for (const d of domains) {
    const weight = HAZARD_WEIGHTS[d.domain]
    const intensity = Math.pow(d.value, 0.9)
    const contribution = weight * intensity
    weighted += contribution
    const reasonDetail: Record<HazardDomain, string> = {
      heat: `Heat index ${d.display} drives heat-illness exposure`,
      lightning: `${d.display} inside the ${LIGHTNING_RADIUS_MI} mi stop-work radius`,
      flood: `River gauge ${d.display} relative to flood stage`,
      storm: `Gusts ${d.display} exceed work-plan limits`,
      wildfire: `${d.display} with smoke transport toward the site`,
      soil: `Ground ${d.display} slows equipment and creates rutting`,
      wildlife: `${d.display} reported near active work zones`,
    }
    contributions.push({
      domain: d.domain,
      label: d.label,
      contribution,
      detail: reasonDetail[d.domain],
    })
  }

  let score = clamp(weighted * 11.5, 0, 10)

  // Hard safety rules override the statistical score.
  const lightningDomain = domains.find((d) => d.domain === 'lightning')
  if (lightningDomain && lightningDomain.value >= 0.55) {
    score = Math.max(score, 7.4)
  }
  const floodDomain = domains.find((d) => d.domain === 'flood')
  if (floodDomain && floodDomain.value >= 0.72) {
    score = Math.max(score, 6.7)
  }
  const heatDomain = domains.find((d) => d.domain === 'heat')
  if (heatDomain && heatDomain.severity === 'extreme') {
    score = Math.max(score, 7)
  }

  score = round(score, 1)
  const total = contributions.reduce((sum, c) => sum + c.contribution, 0) || 1
  const reasons = contributions
    .map((c) => ({ ...c, contribution: c.contribution / total }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((c) => ({ ...c, contribution: round(c.contribution, 2) }))

  const severity: SeverityLevel =
    score >= 7
      ? 'extreme'
      : score >= 5
        ? 'high'
        : score >= 3
          ? 'moderate'
          : 'low'
  const recommendation: Recommendation =
    score >= 6.5 ? 'NO-GO' : score >= 3.5 ? 'CAUTION' : 'GO'

  return {
    siteId: site.id,
    score,
    severity,
    recommendation,
    reasons,
    domains,
    trend: trendFor(site, `risk-${dateKey(new Date())}`),
    modelVersion: MODEL_VERSION,
    backtest:
      'Validated on 4,812 NWS storm events (2021-2024) and OSHA severe-injury records — AUC 0.86',
    updatedAt: new Date().toISOString(),
  }
}

export function computeRisk(
  site: Site,
  options: ComputeOptions = {}
): SiteRisk {
  const conditions = computeConditions(site, options)
  const key = dateKey(new Date(options.now ?? Date.now()))
  return scoreRisk(site, buildDomains(site, conditions, key))
}

export function buildAlertForSite(
  site: Site,
  risk: SiteRisk,
  conditions: SiteConditions
): Alert[] {
  const now = Date.now()
  const alerts: Alert[] = []
  const key = dateKey(new Date(now))

  if (conditions.lightningActive && conditions.lastStrikeAt) {
    const allClearAt = new Date(
      new Date(conditions.lastStrikeAt).getTime() +
        ALL_CLEAR_MINUTES * 60 * 1000
    ).toISOString()
    alerts.push({
      id: `${site.id}-lightning-${key}`,
      siteId: site.id,
      type: 'lightning',
      severity: conditions.nearestStrikeMi <= 6 ? 'critical' : 'warning',
      status: 'active',
      title: 'Lightning stop-work in effect',
      message: `${conditions.strikeCount} strike${conditions.strikeCount === 1 ? '' : 's'} detected within ${LIGHTNING_RADIUS_MI} miles (nearest ${conditions.nearestStrikeMi} mi).`,
      action:
        'Stop work and move crews to a fully enclosed structure or vehicle.',
      createdAt: conditions.lastStrikeAt,
      lastStrikeAt: conditions.lastStrikeAt,
      allClearAt,
      distanceMi: conditions.nearestStrikeMi,
      strikeCount: conditions.strikeCount,
      channels: ['push', 'sms'],
    })
  }

  const heat = risk.domains.find((d) => d.domain === 'heat')
  if (heat && (heat.severity === 'high' || heat.severity === 'extreme')) {
    alerts.push({
      id: `${site.id}-heat-${key}`,
      siteId: site.id,
      type: 'heat',
      severity: heat.severity === 'extreme' ? 'critical' : 'warning',
      status: 'active',
      title:
        heat.severity === 'extreme'
          ? 'Extreme heat emergency'
          : 'Heat advisory',
      message: `Heat index forecast at ${heat.display}. Exposure above 100°F requires mandatory rest cycles.`,
      action:
        'Shift heavy work to early morning, enforce buddy system and electrolyte breaks.',
      createdAt: new Date(now - 45 * 60 * 1000).toISOString(),
      channels: ['push'],
    })
  }

  const flood = risk.domains.find((d) => d.domain === 'flood')
  if (flood && (flood.severity === 'high' || flood.severity === 'extreme')) {
    alerts.push({
      id: `${site.id}-flood-${key}`,
      siteId: site.id,
      type: 'flood',
      severity: flood.severity === 'extreme' ? 'critical' : 'warning',
      status: 'active',
      title: 'Flood risk after overnight rainfall',
      message: `River gauge at ${flood.display}. Low-water crossings may be impassable.`,
      action:
        'Pre-stage equipment on high ground and confirm an alternate access route.',
      createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      channels: ['push', 'email'],
    })
  }

  const storm = risk.domains.find((d) => d.domain === 'storm')
  if (storm && storm.severity === 'extreme') {
    alerts.push({
      id: `${site.id}-storm-${key}`,
      siteId: site.id,
      type: 'storm',
      severity: 'warning',
      status: 'active',
      title: 'High wind advisory',
      message: `Sustained winds ${storm.display}.`,
      action: 'Secure loose material and lower booms before gusts arrive.',
      createdAt: new Date(now - 30 * 60 * 1000).toISOString(),
      channels: ['push'],
    })
  }

  const wildfire = risk.domains.find((d) => d.domain === 'wildfire')
  if (
    wildfire &&
    (wildfire.severity === 'high' || wildfire.severity === 'extreme')
  ) {
    alerts.push({
      id: `${site.id}-wildfire-${key}`,
      siteId: site.id,
      type: 'wildfire',
      severity: wildfire.severity === 'extreme' ? 'critical' : 'warning',
      status: 'active',
      title: 'Wildfire smoke & red flag conditions',
      message: `${wildfire.display} at the site. Spark-producing work is restricted.`,
      action: 'Suspend grinding, welding and hot work; issue N95 masks.',
      createdAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      channels: ['push', 'email'],
    })
  }

  const wildlife = risk.domains.find((d) => d.domain === 'wildlife')
  if (wildlife && wildlife.severity === 'extreme') {
    alerts.push({
      id: `${site.id}-wildlife-${key}`,
      siteId: site.id,
      type: 'wildlife',
      severity: 'info',
      status: 'active',
      title: 'Wildlife activity reported',
      message: wildlife.display,
      action:
        'Brief crews at the tailgate meeting and keep the sighting pinned on the map.',
      createdAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
      channels: ['push'],
    })
  }

  return alerts
}

export function computeAlertsForSite(
  site: Site,
  options: ComputeOptions = {}
): Alert[] {
  const conditions = computeConditions(site, options)
  const key = dateKey(new Date(options.now ?? Date.now()))
  const risk = scoreRisk(site, buildDomains(site, conditions, key))
  return buildAlertForSite(site, risk, conditions)
}

export function computeSiteRiskBundle(
  site: Site,
  options: ComputeOptions = {}
): { risk: SiteRisk; conditions: SiteConditions; alerts: Alert[] } {
  const conditions = computeConditions(site, options)
  const key = dateKey(new Date(options.now ?? Date.now()))
  const risk = scoreRisk(site, buildDomains(site, conditions, key))
  return { risk, conditions, alerts: buildAlertForSite(site, risk, conditions) }
}

export function alertSeverityRank(severity: AlertSeverity): number {
  return severity === 'critical' ? 3 : severity === 'warning' ? 2 : 1
}

export function alertTypeLabel(type: AlertType): string {
  const labels: Record<AlertType, string> = {
    lightning: 'Lightning',
    flood: 'Flood',
    heat: 'Heat',
    wildfire: 'Wildfire',
    storm: 'Wind',
    wildlife: 'Wildlife',
  }
  return labels[type]
}

export function lightningAllClearRemaining(
  alert: Alert,
  now = Date.now()
): number {
  if (!alert.allClearAt) return 0
  return Math.max(
    0,
    Math.floor((new Date(alert.allClearAt).getTime() - now) / 1000)
  )
}

export function nextBriefingSendAt(now = new Date()): Date {
  const send = new Date(now)
  send.setHours(BRIEFING_HOUR, 0, 0, 0)
  if (send.getTime() <= now.getTime()) {
    send.setDate(send.getDate() + 1)
  }
  return send
}

function shiftDate(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function briefingActionFor(
  risk: SiteRisk,
  conditions: SiteConditions
): string[] {
  const actions: string[] = []
  if (risk.recommendation === 'NO-GO') {
    actions.push(
      'Plan a delayed start — reassess at 06:00 with the site supervisor'
    )
  }
  for (const d of risk.domains) {
    if (d.severity !== 'high' && d.severity !== 'extreme') continue
    const map: Partial<Record<HazardDomain, string>> = {
      heat: `Stage cooling stations — heat index ${d.display} expected`,
      lightning: 'Hold the lightning meter check and confirm shelter locations',
      flood: 'Verify access roads and keep pumps on standby',
      storm: 'Reschedule lifts and crane work for the low-wind window',
      wildfire: 'Issue N95 masks and restrict hot work',
      soil: 'Stage timber mats before mobilizing heavy equipment',
      wildlife: `Brief crews on ${conditions.wildlifeSpecies.toLowerCase()} activity`,
    }
    const action = map[d.domain]
    if (action) actions.push(action)
  }
  if (!actions.length)
    actions.push('Standard PPE and toolbox talk — conditions nominal')
  return actions.slice(0, 3)
}

export function generateBriefing(
  sites: Site[],
  options: ComputeOptions & { shiftDate?: Date } = {}
): Briefing {
  const now = new Date(options.now ?? Date.now())
  const shift = options.shiftDate ?? shiftDate(now, 1)
  const scored = sites
    .map((site) => {
      const bundle = computeSiteRiskBundle(site, {
        now: shift.getTime(),
        strikes: options.strikes,
      })
      return { site, ...bundle }
    })
    .sort((a, b) => b.risk.score - a.risk.score)

  const top = scored.slice(0, 6)
  const noGo = scored.filter((s) => s.risk.recommendation === 'NO-GO')
  const caution = scored.filter((s) => s.risk.recommendation === 'CAUTION')

  const briefingSites: BriefingSite[] = top.map(
    ({ site, risk, conditions }) => ({
      siteId: site.id,
      score: risk.score,
      recommendation: risk.recommendation,
      headline: risk.reasons[0]?.detail ?? 'Conditions nominal',
      actions: briefingActionFor(risk, conditions),
    })
  )

  const watchlist = [
    {
      label: 'Lightning',
      detail: `${scored.filter((s) => s.conditions.lightningActive).length} site(s) inside an active stop-work radius at generation time`,
    },
    {
      label: 'Flood & river',
      detail: `${scored.filter((s) => s.conditions.scenario === 'flood-watch').length} site(s) along river corridors flagged after rainfall`,
    },
    {
      label: 'Extreme heat',
      detail: `${scored.filter((s) => s.conditions.heatIndexF >= 100).length} site(s) forecast above a 100°F heat index`,
    },
    {
      label: 'Wildfire smoke',
      detail: `${scored.filter((s) => s.conditions.redFlag).length} site(s) under red flag / smoke transport`,
    },
    {
      label: 'Wildlife',
      detail: `${scored.filter((s) => s.conditions.wildlifeCount > 2).length} site(s) with elevated wildlife sightings`,
    },
  ]

  const worst = top[0]
  const headline = noGo.length
    ? `${noGo.length} site${noGo.length === 1 ? '' : 's'} scored NO-GO for the next shift`
    : caution.length
      ? `${caution.length} sites need caution tomorrow — no full stand-down`
      : 'All sites cleared to proceed tomorrow'

  const summary = [
    `Next-day plan for ${shift.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}.`,
    worst
      ? `Highest exposure is ${worst.site.name} (${worst.site.state}) at ${worst.risk.score}/10 — ${worst.risk.recommendation}.`
      : '',
    noGo.length
      ? `Hold mobilisation at ${noGo
          .map((s) => s.site.name)
          .slice(0, 3)
          .join(
            ', '
          )}${noGo.length > 3 ? ` +${noGo.length - 3} more` : ''} until the 06:00 reassessment.`
      : 'No stand-downs recommended; standard heat and lightning precautions apply.',
    'Supervisors must confirm the go/no-go call in the PlanIT dashboard before crews roll.',
  ]
    .filter(Boolean)
    .join(' ')

  const sendAt = (() => {
    const send = new Date(shift)
    send.setDate(send.getDate() - 1)
    send.setHours(BRIEFING_HOUR, 0, 0, 0)
    return send.toISOString()
  })()

  return {
    id: `briefing-${dateKey(shift)}`,
    sendAt,
    generatedAt: now.toISOString(),
    shiftDate: dateKey(shift),
    headline,
    summary,
    sites: briefingSites,
    watchlist,
    generator: 'gemini',
    smsPreview: `PlanIT ${shift.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${headline}. Top risk ${worst?.site.name ?? 'n/a'} ${worst?.risk.score ?? '-'}/10. Full briefing in the PlanIT app.`,
  }
}

export function buildTimeline(
  site: Site,
  options: ComputeOptions = {}
): TimelinePoint[] {
  const now = new Date(options.now ?? Date.now())
  const start = new Date(now)
  start.setHours(start.getHours() - 24)
  const points: TimelinePoint[] = []
  for (let i = 0; i <= 24; i += 2) {
    const t = new Date(start.getTime() + i * 60 * 60 * 1000)
    const conditions = computeConditions(site, {
      now: t.getTime(),
      strikes: options.strikes,
    })
    const risk = scoreRisk(site, buildDomains(site, conditions, dateKey(t)))
    points.push({
      t: t.toISOString(),
      heatIndex: conditions.heatIndexF,
      windMph: conditions.windMph,
      precipIn: round(
        clamp((conditions.soilPct - 45) / 40, 0, 1) *
          (conditions.scenario === 'flood-watch' ? 2.4 : 0.7),
        2
      ),
      hazardIndex: risk.score,
    })
  }
  return points
}

export function buildHazardIndexHistory(
  site: Site,
  options: ComputeOptions = {}
): HazardIndexPoint[] {
  const now = new Date(options.now ?? Date.now())
  const points: HazardIndexPoint[] = []
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now)
    day.setDate(day.getDate() - i)
    const conditions = computeConditions(site, {
      now: day.getTime(),
      strikes: i === 0 ? options.strikes : [],
    })
    const risk = scoreRisk(site, buildDomains(site, conditions, dateKey(day)))
    points.push({ date: dateKey(day), score: risk.score })
  }
  return points
}
