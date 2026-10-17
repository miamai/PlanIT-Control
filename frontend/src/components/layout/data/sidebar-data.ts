import {
  Bot,
  FileWarning,
  LayoutDashboard,
  MapPinned,
  Palette,
  RadioTower,
  Settings,
  Siren,
  UserCog,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Dana Reyes',
    email: 'dana.reyes@gridwatch.energy',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'GridWatch Energy',
      logo: RadioTower,
      plan: 'Control Center',
    },
    {
      name: 'Crew Tablet',
      logo: MapPinned,
      plan: 'Field mode',
    },
  ],
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
          title: 'Shift Briefing',
          url: '/briefing',
          icon: Bot,
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
          items: [
            {
              title: 'Profile',
              url: '/settings',
              icon: UserCog,
            },
            {
              title: 'Appearance',
              url: '/settings/appearance',
              icon: Palette,
            },
          ],
        },
      ],
    },
  ],
}
