import { useAuthStore } from '@/stores/auth-store'
import { usePreferencesStore } from '@/stores/preferences-store'

export function useProfile() {
  const user = useAuthStore((state) => state.auth.user)
  const email = user?.email ?? 'dana.reyes@gridwatch.energy'
  const profile = usePreferencesStore(
    (state) => state.profiles[email.toLowerCase()]
  )
  const defaultName =
    email === 'dana.reyes@gridwatch.energy'
      ? 'Dana Reyes'
      : email.split('@')[0].replace(/[._-]+/g, ' ')
  const name = profile?.name ?? defaultName
  const role: 'supervisor' | 'crew' =
    (user?.role.includes('supervisor') ?? true) ? 'supervisor' : 'crew'
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return { email, name, bio: profile?.bio ?? '', role, initials }
}
