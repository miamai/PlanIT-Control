import { Link } from '@tanstack/react-router'
import { type Alert, type Site } from '@/api/types'
import {
  ALERT_SEVERITY_ICON_BOX,
  ALERT_TYPE_ICON,
  relativeTime,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { LightningCountdown } from './lightning-countdown'
import { AlertSeverityBadge } from './risk-badge'

/**
 * One alert as a compact row: severity-colored type icon, title, site, message,
 * the live all-clear timer for lightning, and optionally the crew action.
 */
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
    <div className={cn('flex gap-3 py-3', className)}>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          ALERT_SEVERITY_ICON_BOX[alert.severity]
        )}
      >
        <Icon className='size-4' />
      </span>
      <div className='min-w-0 flex-1 space-y-1'>
        <div className='flex items-start justify-between gap-2'>
          <p className='text-sm leading-tight font-medium'>{alert.title}</p>
          <span className='shrink-0 text-[11px] whitespace-nowrap text-muted-foreground'>
            {relativeTime(alert.createdAt)}
          </span>
        </div>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
          <AlertSeverityBadge
            severity={alert.severity}
            className='px-1.5 py-0 text-[10px]'
          />
          {site ? (
            <Link
              to='/sites/$siteId'
              params={{ siteId: site.id }}
              className='font-medium text-foreground hover:underline'
            >
              {site.name}
              <span className='font-normal text-muted-foreground'>
                {' '}
                · {site.state}
              </span>
            </Link>
          ) : null}
        </div>
        <p className='line-clamp-2 text-xs text-muted-foreground'>
          {alert.message}
        </p>
        {alert.type === 'lightning' && alert.allClearAt ? (
          <LightningCountdown
            allClearAt={alert.allClearAt}
            variant='inline'
            className='mt-1.5 max-w-sm'
          />
        ) : null}
        {showAction ? (
          <p className='text-xs'>
            <span className='font-medium'>Action: </span>
            <span className='text-muted-foreground'>{alert.action}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}
