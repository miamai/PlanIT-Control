import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveApiBaseUrl } from './base-url'

afterEach(() => vi.unstubAllEnvs())

describe('API base URL', () => {
  it('uses the first-party proxy on Vercel even with an old Render URL configured', () => {
    vi.stubEnv('VITE_API_SAME_ORIGIN', 'true')
    vi.stubEnv('VITE_API_BASE_URL', 'https://planit-control-core.onrender.com')
    expect(resolveApiBaseUrl()).toBe(window.location.origin)
  })
  it('retains a configured API for local development and other hosting', () => {
    vi.stubEnv('VITE_API_SAME_ORIGIN', '')
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000/')
    expect(resolveApiBaseUrl()).toBe('http://localhost:8000')
  })
  it('supports relative same-origin configuration', () => {
    vi.stubEnv('VITE_API_SAME_ORIGIN', '')
    vi.stubEnv('VITE_API_BASE_URL', '/')
    expect(resolveApiBaseUrl()).toBe(window.location.origin)
  })
})
