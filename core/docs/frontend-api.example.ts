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
export type UserRole = 'crew' | 'supervisor' | 'admin'
export type UserStatus = 'active' | 'disabled'

export interface User {
  id: string
  username: string
  display_name: string | null
  role: UserRole
  status: UserStatus
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface TokenResponse {
  access_token: string
  token_type: 'bearer'
  expires_in: number
  user: User
}

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

export interface SiteObservation {
  site: Site
  observation: HazardObservation
}

export interface FeedMeta {
  limit: number
  offset: number
  total: number
  states: string[]
  data_mode: 'stored-live' | 'stored-fixture' | 'stored-proxy'
  last_successful_ingestion: string | null
  last_run_status: string | null
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
  getAccessToken: () => string | null,
  setAccessToken: (token: string | null) => void,
): AxiosInstance {
  const client = axios.create({ baseURL, withCredentials: true })
  client.interceptors.request.use((config) => {
    const token = getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })
  client.interceptors.response.use(undefined, async (error) => {
    const request = error.config as typeof error.config & { _planitRetried?: boolean }
    if (error.response?.status !== 401 || request._planitRetried) throw error
    request._planitRetried = true
    const refreshed = await axios.post<TokenResponse>(
      `${baseURL.replace(/\/$/, '')}/api/auth/refresh`,
      {},
      { withCredentials: true },
    )
    setAccessToken(refreshed.data.access_token)
    request.headers.Authorization = `Bearer ${refreshed.data.access_token}`
    return client.request(request)
  })
  return client
}

export async function login(
  api: AxiosInstance,
  username: string,
  password: string,
): Promise<TokenResponse> {
  return (await api.post<TokenResponse>('/api/auth/login', { username, password })).data
}

export async function loadHazardFeed(
  api: AxiosInstance,
  feed: 'weather' | 'lightning' | 'flood' | 'wildfire' | 'soil',
  states: string[],
): Promise<Envelope<SiteObservation[]> & { meta: FeedMeta }> {
  const params = new URLSearchParams()
  for (const state of states) params.append('state', state)
  return (await api.get(`/api/sites/${feed}`, { params })).data
}

export const planitKeys = {
  sites: (filters: Record<string, unknown>) => ['sites', filters] as const,
  site: (siteId: string) => ['site', siteId] as const,
  hazards: (siteId: string) => ['site', siteId, 'hazards'] as const,
  alerts: (siteId: string) => ['site', siteId, 'alerts'] as const,
  risk: (siteId: string) => ['site', siteId, 'risk'] as const,
  briefings: (siteId: string) => ['site', siteId, 'briefings'] as const,
  feed: (name: string, states: string[]) => ['hazard-feed', name, [...states].sort()] as const,
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
