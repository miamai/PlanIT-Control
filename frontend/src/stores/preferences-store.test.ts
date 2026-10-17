import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPreferencesStore } from './preferences-store'

const KEY = 'planit.preferences.v1'

async function store() {
  return createPreferencesStore()
}

beforeEach(() => {
  localStorage.removeItem(KEY)
  vi.resetModules()
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(KEY)
})

describe('local preferences persistence', () => {
  it('keeps profiles separate by email and restores them after reload', async () => {
    const preferences = await store()
    preferences.getState().saveProfile('CREW@example.com', {
      name: 'Field Crew',
      bio: 'Transmission crew',
    })
    preferences.getState().saveProfile('supervisor@example.com', {
      name: 'Site Supervisor',
      bio: '',
    })
    vi.resetModules()
    const restored = await store()
    expect(restored.getState().profiles['crew@example.com'].name).toBe(
      'Field Crew'
    )
    expect(restored.getState().profiles['supervisor@example.com'].name).toBe(
      'Site Supervisor'
    )
  })

  it('persists banner settings without changing profiles', async () => {
    const preferences = await store()
    preferences
      .getState()
      .saveProfile('crew@example.com', { name: 'Field Crew', bio: '' })
    preferences
      .getState()
      .saveNotifications({ enabled: true, minimumSeverity: 'warning' })
    vi.resetModules()
    const restored = await store()
    expect(restored.getState().notifications).toEqual({
      enabled: true,
      minimumSeverity: 'warning',
    })
    expect(restored.getState().profiles['crew@example.com'].name).toBe(
      'Field Crew'
    )
  })

  it.each([
    '{invalid',
    JSON.stringify({ profiles: {}, notifications: { enabled: 'yes' } }),
  ])('recovers from invalid stored preferences', async (raw) => {
    localStorage.setItem(KEY, raw)
    expect((await store()).getState().notifications).toEqual({
      enabled: false,
      minimumSeverity: 'critical',
    })
  })

  it('does not apply an unsaved profile when storage fails', async () => {
    const preferences = await store()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
    expect(() =>
      preferences
        .getState()
        .saveProfile('crew@example.com', { name: 'Field Crew', bio: '' })
    ).toThrow()
    expect(preferences.getState().profiles).toEqual({})
  })

  it('rejects invalid profile input before persisting', async () => {
    const preferences = await store()
    expect(() =>
      preferences
        .getState()
        .saveProfile('crew@example.com', { name: ' ', bio: '' })
    ).toThrow()
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
