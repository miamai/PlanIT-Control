import {
  CalendarClock,
  FileWarning,
  LayoutDashboard,
  MapPinned,
  Settings,
  Siren,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Dana Reyes',
    email: 'dana.reyes@gridwatch.energy',
    avatar: '/avatars/shadcn.jpg',
  },
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
