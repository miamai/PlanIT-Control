import { cn } from '@/lib/utils'
import { type RankedAlert } from '@/hooks/use-planit'
import { AlertItem } from '@/components/planit/alert-item'

export function AlertsFeed({
  alerts,
  limit,
  onSimulate,
  scrollable = false,
  emptyMessage = 'No active alerts — conditions nominal across the fleet.',
  className,
}: {
  alerts: RankedAlert[]
  limit?: number
  onSimulate?: (siteId: string) => void
  scrollable?: boolean
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
    <div
      className={cn(
        'space-y-3',
        scrollable && 'max-h-[560px] overflow-y-auto pe-1',
        className
      )}
    >
      {rows.map((alert) => (
        <AlertItem
          key={alert.id}
          alert={alert}
          site={alert.site}
          onSimulate={onSimulate ? () => onSimulate(alert.site.id) : undefined}
        />
      ))}
    </div>
  )
}
