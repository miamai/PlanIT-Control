import axios, { type AxiosInstance } from 'axios'

export type Envelope<T> = {
  data: T
  meta?: { limit: number; offset: number; total: number } | Record<string, unknown> | null
}

export type HazardType =
  | 'weather'
  | 'heat'
  | 'lightning'
  | 'flood'
  | 'wildfire'
  | 'soil'
  | 'wildlife'
export type Severity = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'
export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'ALL_CLEAR_ELIGIBLE' | 'RESOLVED'

export interface Site {
  id: string
  eia_plant_id: number
  name: string
  latitude: number
  longitude: number
  state: string
  county: string | null
  plant_type: string | null
  primary_energy_source: string | null
  operator_name: string | null
  timezone: string
  source_release: string
  source_url: string
  is_reference_location: boolean
  created_at: string
  updated_at: string
}

export interface HazardObservation {
  id: string
  site_id: string
  hazard_type: HazardType
  source: string
  source_event_id: string
  observed_at: string
  valid_until: string | null
  ingested_at: string
  metric_name: string
  numeric_value: number | null
  unit: string | null
  latitude: number | null
  longitude: number | null
  quality_status: 'verified' | 'provisional' | 'stale' | 'estimated' | 'synthetic'
  is_estimated: boolean
  metadata: Record<string, unknown>
}

export interface Alert {
  id: string
  site_id: string
  hazard_type: HazardType
  severity: Severity
  status: AlertStatus
  action_code: string | null
  title: string
  message: string
  recommended_action: string
  triggered_at: string
  updated_at: string
  resolved_at: string | null
  expires_at: string | null
  source_reference: string | null
  details: Record<string, unknown>
}

export interface RiskScore {
  id: string
  site_id: string
  score: number
  generated_at: string
  valid_for_seconds: number
  model_version: string
  score_source: string
  contributing_factors: Record<string, unknown>
}

export interface RiskResult {
  site_id: string
  status: 'available' | 'missing'
  score: RiskScore | null
}

export interface Briefing {
  id: string
  site_id: string
  briefing_date: string
  generated_at: string
  summary: string
  hazard_details: Record<string, unknown>
}

export function createPlanitApi(
  baseURL: string,
  getToken?: () => Promise<string | null>,
): AxiosInstance {
  const client = axios.create({ baseURL })
  client.interceptors.request.use(async (config) => {
    const token = await getToken?.()
    if (token) config.headers.Authorization = `Bearer ${token}`
    else {
      config.headers['X-PlanIT-Role'] = 'crew'
      config.headers['X-PlanIT-Subject'] = 'frontend-developer'
    }
    return config
  })
  return client
}

export const planitKeys = {
  sites: (filters: Record<string, unknown>) => ['sites', filters] as const,
  site: (siteId: string) => ['site', siteId] as const,
  hazards: (siteId: string) => ['site', siteId, 'hazards'] as const,
  alerts: (siteId: string) => ['site', siteId, 'alerts'] as const,
  risk: (siteId: string) => ['site', siteId, 'risk'] as const,
  briefings: (siteId: string) => ['site', siteId, 'briefings'] as const,
}

type StreamEvent = {
  id: string
  event: string
  data: Record<string, unknown>
}

export async function streamPlanitEvents(options: {
  baseUrl: string
  getToken: () => Promise<string | null>
  onEvent: (event: StreamEvent) => void
  lastEventId?: string
  signal?: AbortSignal
}): Promise<void> {
  const token = await options.getToken()
  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/api/stream`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.lastEventId ? { 'Last-Event-ID': options.lastEventId } : {}),
    },
    signal: options.signal,
  })
  if (!response.ok || !response.body) throw new Error(`SSE connection failed: ${response.status}`)

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const fields = Object.fromEntries(
        block
          .split('\n')
          .filter((line) => !line.startsWith(':'))
          .map((line) => {
            const separator = line.indexOf(':')
            return [line.slice(0, separator), line.slice(separator + 1).trim()]
          }),
      )
      if (fields.data) {
        options.onEvent({
          id: fields.id ?? '',
          event: fields.event ?? 'message',
          data: JSON.parse(fields.data),
        })
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}
