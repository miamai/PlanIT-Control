import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import {
  type AlertSeverity,
  type Recommendation,
  type RiskStatus,
  type Trend,
} from '@/api/types'
import {
  ALERT_SEVERITY_LABEL,
  ALERT_SEVERITY_STYLE,
  CAUTION_BELOW,
  GO_BELOW,
  RECOMMENDATION_BG,
  RECOMMENDATION_TEXT,
  trendLabel,
} from '@/lib/planit'
import { cn } from '@/lib/utils'

const NO_SCORE_LABEL: Record<RiskStatus, string> = {
  available: 'No score',
  missing: 'No score',
  stale: 'Stale',
  unsupported: 'Not modeled',
}

export function RecommendationStatus({
  recommendation,
  status = 'missing',
  className,
  withDesktopLegend = false,
}: {
  /** Null when there is no hazard index; `status` then explains why. */
  recommendation: Recommendation | null
  status?: RiskStatus
  className?: string
  /** Keep the decision accessible when the desktop legend replaces its visible label. */
  withDesktopLegend?: boolean
}) {
  if (!recommendation) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center text-xs font-medium whitespace-nowrap text-muted-foreground',
          className
        )}
        title={
          status === 'unsupported'
            ? 'This site is outside the current ML model catalog'
            : 'No hazard index has been generated for this site yet'
        }
      >
        {NO_SCORE_LABEL[status]}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center text-xs font-semibold tracking-wide whitespace-nowrap',
        RECOMMENDATION_TEXT[recommendation],
        className,
        withDesktopLegend && 'sm:sr-only'
      )}
    >
      {recommendation}
    </span>
  )
}

export function AlertSeverityStatus({
  severity,
  className,
}: {
  severity: AlertSeverity
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs leading-5 font-semibold whitespace-nowrap',
        ALERT_SEVERITY_STYLE[severity],
        className
      )}
    >
      {ALERT_SEVERITY_LABEL[severity]}
    </span>
  )
}

/** Lists can use a desktop legend and explicit per-row decisions on mobile. */
export function RiskLegend({
  className,
  desktopOnly = false,
}: {
  className?: string
  desktopOnly?: boolean
}) {
  const labels = [
    { call: 'GO', range: `< ${GO_BELOW}` },
    { call: 'CAUTION', range: `${GO_BELOW}–<${CAUTION_BELOW}` },
    { call: 'NO-GO', range: `≥ ${CAUTION_BELOW}` },
  ] as const
  return (
    <ul
      aria-label='Hazard index thresholds'
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] leading-4 text-muted-foreground',
        className,
        desktopOnly && 'hidden sm:flex'
      )}
    >
      {labels.map(({ call, range }) => (
        <li
          key={call}
          className='inline-flex items-center gap-1.5 whitespace-nowrap'
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              RECOMMENDATION_BG[call]
            )}
          />
          <span>
            {call} {range}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function TrendIndicator({
  trend,
  className,
}: {
  trend: Trend
  className?: string
}) {
  const Icon =
    trend === 'rising' ? TrendingUp : trend === 'falling' ? TrendingDown : Minus
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-muted-foreground',
        className
      )}
    >
      <Icon className='size-3.5' />
      {trendLabel(trend)}
    </span>
  )
}
