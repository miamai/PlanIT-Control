import { type Alert, type Site } from '@/api/types'
import {
  ALERT_TYPE_BADGE,
  ALERT_TYPE_ICON,
  ALERT_TYPE_LABEL,
  relativeTime,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { LightningCountdown } from './lightning-countdown'
import { AlertSeverityBadge } from './risk-badge'

export function AlertItem({
  alert,
  site,
  onSimulate,
  className,
}: {
  alert: Alert
  site?: Site
  onSimulate?: () => void
  className?: string
}) {
  const Icon = ALERT_TYPE_ICON[alert.type]
  const isLightning = alert.type === 'lightning'

  return (
    <Card
      className={cn(
        'border-l-2',
        alert.severity === 'critical'
          ? 'border-l-red-600'
          : alert.severity === 'warning'
            ? 'border-l-amber-500'
            : 'border-l-sky-500',
        className
      )}
    >
      <CardContent className='space-y-3 p-4'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex min-w-0 items-start gap-3'>
            <span className='mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted'>
              <Icon className='size-4' />
            </span>
            <div className='min-w-0 space-y-1'>
              <div className='flex flex-wrap items-center gap-1.5'>
                <Badge
                  variant='outline'
                  className={cn(
                    'text-[10px] uppercase',
                    ALERT_TYPE_BADGE[alert.type]
                  )}
                >
                  {ALERT_TYPE_LABEL[alert.type]}
                </Badge>
                <AlertSeverityBadge severity={alert.severity} />
              </div>
              <p className='text-sm font-medium'>{alert.title}</p>
              <p className='text-xs text-muted-foreground'>{alert.message}</p>
              {site ? (
                <p className='text-xs text-muted-foreground'>
                  <span className='font-medium text-foreground'>
                    {site.name}
                  </span>
                  {' · '}
                  {site.county} County, {site.state}
                </p>
              ) : null}
            </div>
          </div>
          <span className='shrink-0 text-xs text-muted-foreground'>
            {relativeTime(alert.createdAt)}
          </span>
        </div>

        <div className='rounded-md bg-muted/50 px-3 py-2'>
          <p className='text-xs font-medium'>Recommended action</p>
          <p className='text-xs text-muted-foreground'>{alert.action}</p>
        </div>

        {isLightning && alert.allClearAt ? (
          <LightningCountdown
            allClearAt={alert.allClearAt}
            strikeCount={alert.strikeCount}
            distanceMi={alert.distanceMi}
            compact
            onSimulate={onSimulate}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
