import { z } from 'zod'
import { create } from 'zustand'

const STORAGE_KEY = 'planit.preferences.v1'

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must contain at least 2 characters.')
    .max(60),
  bio: z.string().trim().max(160, 'Bio must not exceed 160 characters.'),
})
export type LocalProfile = z.infer<typeof profileSchema>

const notificationsSchema = z.object({
  enabled: z.boolean(),
  minimumSeverity: z.enum(['info', 'warning', 'critical']),
})
export type NotificationPreferences = z.infer<typeof notificationsSchema>

const preferencesSchema = z.object({
  profiles: z.record(z.string(), profileSchema),
  notifications: notificationsSchema,
})

type Preferences = z.infer<typeof preferencesSchema>
const DEFAULTS: Preferences = {
  profiles: {},
  notifications: { enabled: false, minimumSeverity: 'critical' },
}

function readPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = preferencesSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

/** Write before updating state so blocked storage never produces a false success. */
function writePreferences(preferences: Preferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}

interface PreferencesState extends Preferences {
  saveProfile: (email: string, profile: LocalProfile) => void
  saveNotifications: (preferences: NotificationPreferences) => void
}

export function createPreferencesStore() {
  return create<PreferencesState>()((set, get) => ({
    ...readPreferences(),
    saveProfile: (email, input) => {
      const profile = profileSchema.parse(input)
      const profiles = { ...get().profiles, [email.toLowerCase()]: profile }
      writePreferences({ profiles, notifications: get().notifications })
      set({ profiles })
    },
    saveNotifications: (input) => {
      const notifications = notificationsSchema.parse(input)
      writePreferences({ profiles: get().profiles, notifications })
      set({ notifications })
    },
  }))
}

export const usePreferencesStore = createPreferencesStore()
