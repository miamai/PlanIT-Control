import { Link } from '@tanstack/react-router'
import { useLiveStore } from '@/stores/live-store'
import { formatDuration } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

export type PlanitSection =
  | 'dashboard'
  | 'sites'
  | 'alerts'
  | 'briefing'
  | 'hazards'

const SECTIONS: {
  id: PlanitSection
  title: string
  to: '/' | '/sites' | '/alerts' | '/briefing' | '/hazards'
}[] = [
  { id: 'dashboard', title: 'Dashboard', to: '/' },
  { id: 'sites', title: 'Sites', to: '/sites' },
  { id: 'alerts', title: 'Alerts', to: '/alerts' },
  { id: 'briefing', title: 'Briefing', to: '/briefing' },
  { id: 'hazards', title: 'Hazards', to: '/hazards' },
]

function LiveIndicator() {
  const now = useLiveStore((state) => state.now)
  const strikes = useLiveStore((state) => state.strikes)
  const lastAt = strikes.reduce<string | undefined>(
    (latest, strike) =>
      !latest || new Date(strike.at) > new Date(latest) ? strike.at : latest,
    undefined
  )
  const age = lastAt
    ? Math.max(0, Math.floor((now - new Date(lastAt).getTime()) / 1000))
    : undefined

  return (
    <span className='hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex'>
      <span className='relative flex size-2'>
        <span className='absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75' />
        <span className='relative inline-flex size-2 rounded-full bg-emerald-500' />
      </span>
      LIVE
      {strikes.length > 0
        ? ` · ${strikes.length} strike${strikes.length === 1 ? '' : 's'} · last ${formatDuration(age ?? 0)} ago`
        : ' · feed idle'}
    </span>
  )
}

export function PlanitHeader({
  active,
  actions,
  className,
}: {
  active: PlanitSection
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <Header className={cn(className)}>
      <nav className='flex items-center gap-1 overflow-x-auto'>
        {SECTIONS.map((section) => (
          <Link
            key={section.id}
            to={section.to}
            activeProps={{
              className: 'bg-accent text-foreground',
            }}
            inactiveProps={{
              className: 'text-muted-foreground',
            }}
            aria-current={section.id === active ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors hover:bg-accent hover:text-accent-foreground',
              section.id === active && 'bg-accent text-foreground'
            )}
          >
            {section.title}
          </Link>
        ))}
      </nav>
      <div className='ms-auto flex items-center gap-2'>
        <LiveIndicator />
        {actions}
        <Search />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </div>
    </Header>
  )
}
