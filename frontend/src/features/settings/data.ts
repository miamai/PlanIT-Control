import { Bell, Monitor, Palette, UserCog, Wrench } from 'lucide-react'

export const settingsSections = [
  { title: 'Profile', href: '/settings', icon: UserCog },
  { title: 'Account', href: '/settings/account', icon: Wrench },
  { title: 'Appearance', href: '/settings/appearance', icon: Palette },
  { title: 'Notifications', href: '/settings/notifications', icon: Bell },
  { title: 'Display', href: '/settings/display', icon: Monitor },
] as const
