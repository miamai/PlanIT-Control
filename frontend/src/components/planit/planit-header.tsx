import { useLiveStore } from '@/stores/live-store'
import { formatDuration } from '@/lib/planit'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const STATUS_STYLE = {
  live: { dot: 'bg-emerald-500', label: 'Live', ping: true },
  connecting: { dot: 'bg-amber-500', label: 'Connecting', ping: false },
  offline: { dot: 'bg-muted-foreground', label: 'Offline', ping: false },
} as const

function LiveIndicator() {
  const now = useLiveStore((state) => state.now)
  const status = useLiveStore((state) => state.streamStatus)
  const lastEventAt = useLiveStore((state) => state.lastEventAt)
  const style = STATUS_STYLE[status]
  const age =
    lastEventAt !== null
      ? Math.max(0, Math.floor((now - lastEventAt) / 1000))
      : undefined

  return (
    <span
      className='inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground'
      title='Realtime alert and risk event stream'
    >
      <span className='relative flex size-2'>
        {style.ping ? (
          <span className='absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75' />
        ) : null}
        <span
          className={`relative inline-flex size-2 rounded-full ${style.dot}`}
        />
      </span>
      <span className='font-medium text-foreground'>{style.label}</span>
      {age !== undefined ? (
        <span className='hidden tabular-nums md:inline'>
          last event {formatDuration(age)} ago
        </span>
      ) : status === 'live' ? (
        <span className='hidden md:inline'>waiting for events</span>
      ) : null}
    </span>
  )
}

/** App bar: live-feed status on the left, search and account on the right. */
export function PlanitHeader() {
  return (
    <Header>
      <LiveIndicator />
      <div className='ms-auto flex items-center gap-2'>
        <Search
          aria-label='Search'
          className='max-sm:size-8 max-sm:flex-none max-sm:p-0 max-sm:[&>span]:sr-only'
        />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </div>
    </Header>
  )
}
