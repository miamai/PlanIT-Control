import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import {
  type AlertSeverity,
  type Recommendation,
  type SeverityLevel,
  type Trend,
} from '@/api/types'
import {
  RECOMMENDATION_BADGE,
  SEVERITY_ALERT_BADGE,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  trendLabel,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export function RecommendationBadge({
  recommendation,
  className,
}: {
  recommendation: Recommendation
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn(
        'gap-1.5 px-2 py-1 text-[11px] font-semibold tracking-wide uppercase',
        RECOMMENDATION_BADGE[recommendation],
        className
      )}
    >
      <span className='size-1.5 rounded-full bg-current' />
      {recommendation}
    </Badge>
  )
}

export function SeverityBadge({
  severity,
  className,
}: {
  severity: SeverityLevel
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn(SEVERITY_BADGE[severity], 'font-medium', className)}
    >
      {SEVERITY_LABEL[severity]}
    </Badge>
  )
}

export function AlertSeverityBadge({
  severity,
  className,
}: {
  severity: AlertSeverity
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn(SEVERITY_ALERT_BADGE[severity], 'font-medium', className)}
    >
      {severity}
    </Badge>
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
