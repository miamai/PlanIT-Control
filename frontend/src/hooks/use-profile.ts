import {
  displayName,
  ROLE_LABEL,
  type UserRole,
  useAuthStore,
} from '@/stores/auth-store'
import { usePreferencesStore } from '@/stores/preferences-store'

/**
 * The signed-in account plus the display name and bio saved on this browser.
 * Account fields come from the core API (`/api/auth/login`); the local profile
 * is keyed by username.
 */
export function useProfile() {
  const user = useAuthStore((state) => state.auth.user)
  const username = user?.username ?? ''
  const profile = usePreferencesStore((state) =>
    username ? state.profiles[username.toLowerCase()] : undefined
  )
  const name = profile?.name ?? displayName(user)
  const role: UserRole = user?.role ?? 'crew'
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return {
    username,
    name,
    bio: profile?.bio ?? '',
    role,
    roleLabel: ROLE_LABEL[role],
    initials,
  }
}
