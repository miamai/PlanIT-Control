/** Vercel proxies /api to Core so refresh cookies remain first-party. */
export function resolveApiBaseUrl(): string {
  if (import.meta.env.VITE_API_SAME_ORIGIN === 'true')
    return window.location.origin
  return new URL(
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
    window.location.origin
  ).href.replace(/\/$/, '')
}
