import createClient, { type Middleware } from 'openapi-fetch'
import { useAuthStore } from '@/stores/auth-store'
import { type components, type paths } from './schema'

/**
 * Typed client for the PlanIT core API.
 *
 * Request and response types come from `schema.d.ts`, generated from
 * `core/docs/openapi.json` (`pnpm api:types`). The middleware attaches the
 * in-memory access token and transparently refreshes it through the HttpOnly
 * refresh cookie, retrying a request once after a 401.
 */

export type TokenResponse = components['schemas']['TokenResponse']

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

/** Refresh this long before the access token expires. */
const REFRESH_LEEWAY_MS = 30_000

/** An API failure carrying the RFC 7807 problem `title`/`detail` from the backend. */
export class ApiError extends Error {
  readonly status: number
  readonly detail?: string

  constructor(status: number, title: string, detail?: string) {
    super(title)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function isPublicAuthPath(url: string): boolean {
  return ['/api/auth/login', '/api/auth/refresh'].includes(
    new URL(url).pathname
  )
}

let refreshing: Promise<TokenResponse | null> | null = null

/** Web Lock held by whichever of the app's tabs is refreshing. */
const REFRESH_LOCK = 'planit-auth-refresh'

/**
 * Exchange the refresh cookie for a new access token. The backend rotates the
 * cookie on every refresh, so concurrent callers in a tab share one request,
 * and tabs take turns through a Web Lock so each sends the cookie the previous
 * refresh stored. Web Locks need a secure context (HTTPS or localhost);
 * elsewhere the backend's reuse grace window still covers overlapping tabs.
 */
export function withSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  return 'locks' in navigator
    ? navigator.locks.request(REFRESH_LOCK, operation)
    : operation()
}

export function refreshSession(): Promise<TokenResponse | null> {
  refreshing ??= withSessionLock(async () => {
    // Retry one transient failure, without interpreting an outage as logout.
    for (let attempt = 0; ; attempt++) {
      try {
        return await postRefresh()
      } catch (error) {
        if (attempt > 0) throw error
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }).finally(() => {
    refreshing = null
  })
  return refreshing
}

async function postRefresh(): Promise<TokenResponse | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    throw new ApiError(
      503,
      'Session refresh unavailable',
      'Check your connection and retry. Your session has not been cleared.'
    )
  }
  if (response.status === 401 || response.status === 403) {
    useAuthStore.getState().auth.reset()
    return null
  }
  if (!response.ok)
    throw new ApiError(
      503,
      'Session refresh unavailable',
      'The service is temporarily unavailable. Please retry.'
    )
  let session: TokenResponse
  try {
    session = (await response.json()) as TokenResponse
    if (!session.access_token || !session.user?.id || !(session.expires_in > 0))
      throw new Error('Invalid session')
  } catch {
    throw new ApiError(
      503,
      'Invalid session refresh response',
      'Please retry when the service is available.'
    )
  }
  useAuthStore
    .getState()
    .auth.setSession(session.access_token, session.expires_in, session.user)
  return session
}

const retryable = new Map<string, Request>()

const authMiddleware: Middleware = {
  async onRequest({ request, id }) {
    if (isPublicAuthPath(request.url)) return request
    const { accessToken, expiresAt } = useAuthStore.getState().auth
    if (
      new URL(request.url).pathname !== '/api/auth/me/password' &&
      accessToken &&
      expiresAt - Date.now() < REFRESH_LEEWAY_MS
    ) {
      await refreshSession()
    }
    const token = useAuthStore.getState().auth.accessToken
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    retryable.set(id, request.clone())
    return request
  },
  async onResponse({ response, id }) {
    const retry = retryable.get(id)
    retryable.delete(id)
    if (
      response.status !== 401 ||
      !retry ||
      new URL(retry.url).pathname === '/api/auth/me/password'
    )
      return response
    // Another concurrent request may already have renewed the access token.
    const current = useAuthStore.getState().auth.accessToken
    let token =
      current && retry.headers.get('Authorization') !== `Bearer ${current}`
        ? current
        : undefined
    if (!token) {
      const session = await refreshSession()
      if (!session) return response
      token = session.access_token
    }
    retry.headers.set('Authorization', `Bearer ${token}`)
    return fetch(retry)
  },
  onError({ id }) {
    retryable.delete(id)
  },
}

export const api = createClient<paths>({
  baseUrl: API_BASE_URL,
  credentials: 'include',
})
api.use(authMiddleware)

function toApiError(response: Response, error: unknown): ApiError {
  if (error && typeof error === 'object') {
    const problem = error as { title?: unknown; detail?: unknown }
    const title =
      typeof problem.title === 'string' && problem.title
        ? problem.title
        : response.statusText || `Request failed (${response.status})`
    const detail =
      typeof problem.detail === 'string' ? problem.detail : undefined
    return new ApiError(response.status, title, detail)
  }
  return new ApiError(
    response.status,
    response.statusText || `Request failed (${response.status})`
  )
}

type Result<T> = { data?: T; error?: unknown; response: Response }

/** Resolve an openapi-fetch call to its body, throwing `ApiError` on failure. */
export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await request
  if (!response.ok || data === undefined) throw toApiError(response, error)
  return data
}

/** Resolve an enveloped (`{ data, meta }`) response to its `data`. */
export async function unwrapData<T>(
  request: Promise<Result<{ data: T }>>
): Promise<T> {
  return (await unwrap(request)).data
}

/** Successful DELETE endpoints may intentionally return no response body. */
export async function unwrapEmpty(
  request: Promise<Result<unknown>>
): Promise<void> {
  const { error, response } = await request
  if (!response.ok) throw toApiError(response, error)
}
