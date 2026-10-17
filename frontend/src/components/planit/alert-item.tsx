import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { type Alert, type Site } from '@/api/types'
import { ALERT_TYPE_ICON, relativeTime } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { LightningCountdown } from './lightning-countdown'
import { AlertSeverityStatus } from './risk-status'

/** A neutral hazard icon, one tinted severity label, and readable safety details. */
export function AlertItem({
  alert,
  site,
  showAction = false,
  className,
}: {
  alert: Alert
  site?: Site
  showAction?: boolean
  className?: string
}) {
  const Icon = ALERT_TYPE_ICON[alert.type]

  return (
    <div className={cn('flex gap-3 py-4', className)}>
      <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
        <Icon className='size-4' aria-hidden />
      </span>
      <div className='@container/alert min-w-0 flex-1 space-y-2'>
        <div className='flex flex-wrap items-start justify-between gap-x-3 gap-y-1 @max-[360px]/alert:flex-col'>
          <p className='min-w-0 flex-1 text-sm leading-5 font-semibold break-words'>
            {alert.title}
          </p>
          <time
            dateTime={alert.createdAt}
            title={new Date(alert.createdAt).toLocaleString('en-US')}
            className='shrink-0 text-xs leading-5 whitespace-nowrap text-muted-foreground'
          >
            {relativeTime(alert.createdAt)}
          </time>
        </div>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground'>
          <AlertSeverityStatus severity={alert.severity} />
          {site ? (
            <Link
              to='/sites/$siteId'
              params={{ siteId: site.id }}
              className='rounded-sm font-medium hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring'
            >
              {site.name} · {site.state}
            </Link>
          ) : null}
        </div>
        <p className='text-sm leading-relaxed break-words'>{alert.message}</p>
        {alert.type === 'lightning' && alert.allClearAt ? (
          <LightningCountdown
            allClearAt={alert.allClearAt}
            variant='inline'
            className='max-w-sm'
          />
        ) : null}
        {showAction ? (
          <p className='text-sm leading-relaxed break-words'>
            <span className='font-medium'>Action: </span>
            {alert.action}
          </p>
        ) : (
          <details className='group'>
            <summary className='flex min-h-9 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11 [&::-webkit-details-marker]:hidden'>
              <ChevronDown
                className='size-3.5 transition-transform group-open:rotate-180'
                aria-hidden
              />
              <span className='group-open:hidden'>View safety action</span>
              <span className='hidden group-open:inline'>
                Hide safety action
              </span>
              <span className='sr-only'>
                {' '}
                for {alert.title}
                {site ? ` at ${site.name}` : ''}
              </span>
            </summary>
            <p className='pt-1 text-sm leading-relaxed break-words'>
              {alert.action}
            </p>
          </details>
        )}
      </div>
    </div>
  )
}
