import { useLiveStore } from '@/stores/live-store'
import { formatDuration } from '@/lib/planit'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

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
    <span
      className='inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground'
      title='Realtime hazard feed'
    >
      <span className='relative flex size-2'>
        <span className='absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75' />
        <span className='relative inline-flex size-2 rounded-full bg-emerald-500' />
      </span>
      <span className='font-medium text-foreground'>Live</span>
      {age !== undefined ? (
        <span className='hidden tabular-nums @min-[640px]/planit-header:inline'>
          last strike {formatDuration(age)} ago
        </span>
      ) : (
        <span className='hidden @min-[640px]/planit-header:inline'>
          feed idle
        </span>
      )}
    </span>
  )
}

/** App bar: live-feed status on the left, search and account on the right. */
export function PlanitHeader() {
  return (
    <Header className='@container/planit-header'>
      <LiveIndicator />
      <div className='ms-auto flex items-center gap-2'>
        <Search
          aria-label='Search'
          className='@max-[640px]/planit-header:size-8 @max-[640px]/planit-header:flex-none @max-[640px]/planit-header:p-0 @max-[640px]/planit-header:[&>kbd]:hidden @max-[640px]/planit-header:[&>span]:sr-only'
        />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </div>
    </Header>
  )
}
