import { type Recommendation, type SeverityLevel } from '@/api/types'
import { SEVERITY_TEXT, severityFromScore } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { RecommendationBadge } from './risk-badge'

const RADIUS = 80
const ARC_LENGTH = Math.PI * RADIUS
const ARC_PATH = `M ${100 - RADIUS} 100 A ${RADIUS} ${RADIUS} 0 0 1 ${100 + RADIUS} 100`

export function HazardGauge({
  score,
  recommendation,
  size = 'default',
  className,
}: {
  score: number
  recommendation?: Recommendation
  size?: 'default' | 'sm'
  className?: string
}) {
  const severity: SeverityLevel = severityFromScore(score)
  const progress = Math.min(1, Math.max(0, score / 10))
  const recommended =
    recommendation ?? (score >= 6.5 ? 'NO-GO' : score >= 3.5 ? 'CAUTION' : 'GO')

  return (
    <div
      className={cn(
        'flex flex-col items-center',
        size === 'sm' ? 'w-32' : 'w-44',
        className
      )}
    >
      <svg viewBox='0 0 200 118' className='w-full'>
        <path
          d={ARC_PATH}
          fill='none'
          strokeWidth={16}
          strokeLinecap='round'
          className='stroke-muted'
        />
        <path
          d={ARC_PATH}
          fill='none'
          strokeWidth={16}
          strokeLinecap='round'
          strokeDasharray={`${ARC_LENGTH * progress} ${ARC_LENGTH}`}
          className={cn(
            'transition-[stroke-dasharray] duration-700 ease-out',
            severity === 'extreme'
              ? 'stroke-red-600'
              : severity === 'high'
                ? 'stroke-orange-500'
                : severity === 'moderate'
                  ? 'stroke-amber-500'
                  : 'stroke-emerald-500'
          )}
        />
        <text
          x='100'
          y='92'
          textAnchor='middle'
          className={cn(
            'fill-foreground font-bold tabular-nums',
            size === 'sm' ? 'text-[34px]' : 'text-[40px]'
          )}
        >
          {score.toFixed(1)}
        </text>
        <text
          x='100'
          y='110'
          textAnchor='middle'
          className='fill-muted-foreground text-[11px]'
        >
          HAZARD INDEX / 10
        </text>
      </svg>
      <div className={cn('mt-1 text-xs font-medium', SEVERITY_TEXT[severity])}>
        {severity === 'extreme'
          ? 'Extreme'
          : severity === 'high'
            ? 'High'
            : severity === 'moderate'
              ? 'Moderate'
              : 'Low'}{' '}
        exposure
      </div>
      <RecommendationBadge recommendation={recommended} className='mt-2' />
    </div>
  )
}
