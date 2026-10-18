import {
  CalendarClock,
  FileWarning,
  LayoutDashboard,
  MapPinned,
  Settings,
  Siren,
  Users,
} from 'lucide-react'
import { hasRole, type AuthUser } from '@/stores/auth-store'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  navGroups: [
    {
      title: 'Operations',
      items: [
        {
          title: 'Dashboard',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Sites',
          url: '/sites',
          icon: MapPinned,
        },
        {
          title: 'Alerts',
          url: '/alerts',
          icon: Siren,
        },
        {
          title: 'Briefing',
          url: '/briefing',
          icon: CalendarClock,
        },
        {
          title: 'Hazard Reports',
          url: '/hazards',
          icon: FileWarning,
        },
      ],
    },
    {
      title: 'Account',
      items: [
        {
          title: 'Settings',
          icon: Settings,
          url: '/settings',
        },
      ],
    },
  ],
}

export function getNavGroups(user: AuthUser | null): SidebarData['navGroups'] {
  return [
    ...sidebarData.navGroups,
    ...(hasRole(user, 'admin')
      ? [
          {
            title: 'Administration',
            items: [{ title: 'Users', url: '/admin/users', icon: Users }],
          },
        ]
      : []),
  ]
}
