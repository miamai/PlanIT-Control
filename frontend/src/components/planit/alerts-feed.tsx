import { cn } from '@/lib/utils'
import { type RankedAlert } from '@/hooks/use-planit'
import { AlertItem } from '@/components/planit/alert-item'

export function AlertsFeed({
  alerts,
  limit,
  showAction = false,
  emptyMessage = 'No active alerts',
  className,
}: {
  alerts: RankedAlert[]
  limit?: number
  showAction?: boolean
  emptyMessage?: string
  className?: string
}) {
  const rows = limit ? alerts.slice(0, limit) : alerts

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground',
          className
        )}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className={cn('divide-y', className)}>
      {rows.map((alert) => (
        <AlertItem
          key={alert.id}
          alert={alert}
          site={alert.site}
          showAction={showAction}
          className='first:pt-0 last:pb-0'
        />
      ))}
    </div>
  )
}
