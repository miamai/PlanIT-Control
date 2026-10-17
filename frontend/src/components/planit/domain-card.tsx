import { type DomainStatus } from '@/api/types'
import { DOMAIN_ICON, SEVERITY_DOT, SEVERITY_TEXT } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { SeverityBadge, TrendIndicator } from './risk-badge'

export function DomainCard({
  domain,
  className,
}: {
  domain: DomainStatus
  className?: string
}) {
  const Icon = DOMAIN_ICON[domain.domain]
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className='space-y-3 p-4'>
        <div className='flex items-start justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <span
              className={cn(
                'flex size-8 items-center justify-center rounded-md bg-muted'
              )}
            >
              <Icon className={cn('size-4', SEVERITY_TEXT[domain.severity])} />
            </span>
            <div className='leading-tight'>
              <p className='text-sm font-medium'>{domain.label}</p>
              <p className='text-[11px] text-muted-foreground'>
                {domain.source}
              </p>
            </div>
          </div>
          <SeverityBadge severity={domain.severity} />
        </div>

        <div className='flex items-end justify-between gap-2'>
          <p
            className={cn(
              'text-xl leading-none font-semibold tabular-nums',
              SEVERITY_TEXT[domain.severity]
            )}
          >
            {domain.display}
          </p>
          <TrendIndicator trend={domain.trend} />
        </div>

        <div className='h-1.5 w-full overflow-hidden rounded-full bg-muted'>
          <div
            className={cn('h-full rounded-full', SEVERITY_DOT[domain.severity])}
            style={{ width: `${Math.round(domain.value * 100)}%` }}
          />
        </div>

        <p className='text-xs text-muted-foreground'>{domain.summary}</p>
      </CardContent>
    </Card>
  )
}
