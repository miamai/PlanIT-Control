import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { type DomainStatus, type SeverityLevel } from '@/api/types'
import {
  DOMAIN_ICON,
  SEVERITY_DOT,
  SEVERITY_LABEL,
  SEVERITY_TEXT,
  trendLabel,
} from '@/lib/planit'
import { cn } from '@/lib/utils'

const LEVELS: SeverityLevel[] = ['low', 'moderate', 'high', 'extreme']

function SeverityMeter({ severity }: { severity: SeverityLevel }) {
  const level = LEVELS.indexOf(severity)
  return (
    <div
      className='flex gap-0.5'
      role='meter'
      aria-valuemin={1}
      aria-valuemax={LEVELS.length}
      aria-valuenow={level + 1}
      aria-label={`${SEVERITY_LABEL[severity]} severity`}
    >
      {LEVELS.map((step, index) => (
        <span
          key={step}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            index <= level ? SEVERITY_DOT[severity] : 'bg-muted'
          )}
        />
      ))}
    </div>
  )
}

/** One row per hazard domain on a shared Low → Extreme scale. */
export function RiskPicture({
  domains,
  className,
}: {
  domains: DomainStatus[]
  className?: string
}) {
  if (domains.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground',
          className
        )}
      >
        No hazard observations recorded in the last 72 hours
      </div>
    )
  }
  return (
    <ul className={cn('divide-y', className)}>
      {domains.map((domain) => {
        const Icon = DOMAIN_ICON[domain.domain]
        const TrendIcon = !domain.trend
          ? null
          : domain.trend === 'rising'
            ? TrendingUp
            : domain.trend === 'falling'
              ? TrendingDown
              : Minus
        return (
          <li
            key={domain.domain}
            className='flex items-center gap-3 py-2.5 first:pt-0 last:pb-0'
          >
            <span className='flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'>
              <Icon className='size-4' />
            </span>
            <div className='flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3'>
              <p className='text-sm font-medium' title={domain.source}>
                {domain.label}
              </p>
              <p
                className='text-sm font-semibold text-foreground tabular-nums'
                title={domain.summary}
              >
                {domain.display}
              </p>
            </div>
            <div className='w-24 shrink-0 space-y-1.5 sm:w-32'>
              <SeverityMeter severity={domain.severity} />
              <div className='flex items-center justify-between text-[11px]'>
                <span
                  className={cn('font-medium', SEVERITY_TEXT[domain.severity])}
                >
                  {SEVERITY_LABEL[domain.severity]}
                </span>
                {domain.trend && TrendIcon ? (
                  <span
                    className='inline-flex items-center gap-0.5 text-muted-foreground'
                    title={trendLabel(domain.trend)}
                  >
                    <TrendIcon className='size-3' />
                    <span className='hidden sm:inline'>
                      {trendLabel(domain.trend)}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
