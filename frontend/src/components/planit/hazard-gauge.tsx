import { type Recommendation, type RiskStatus } from '@/api/types'
import {
  RECOMMENDATION_HEX,
  RISK_BANDS,
  recommendationFromScore,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { RecommendationStatus } from './risk-status'

const RADIUS = 80
const STROKE = 14
const GAP = 0.012

/** Point on the upper semicircle for a 0..1 fraction (0 = left, 1 = right). */
function pointAt(fraction: number): [number, number] {
  const angle = Math.PI * (1 - fraction)
  return [100 + RADIUS * Math.cos(angle), 100 - RADIUS * Math.sin(angle)]
}

function arc(from: number, to: number): string {
  const [x1, y1] = pointAt(from)
  const [x2, y2] = pointAt(to)
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${RADIUS} ${RADIUS} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

/**
 * 0-10 hazard index dial. The track is split into the GO / CAUTION / NO-GO
 * bands so the reading is obvious at a glance; the filled part shows the score.
 */
export function HazardGauge({
  score,
  recommendation,
  status,
  size = 'default',
  showLabel = true,
  className,
}: {
  /** Null when the site has no hazard index; the dial is then left empty. */
  score: number | null
  recommendation?: Recommendation | null
  status?: RiskStatus
  size?: 'default' | 'sm'
  showLabel?: boolean
  className?: string
}) {
  const value = score === null ? 0 : Math.min(10, Math.max(0, score))
  const call =
    score === null ? null : (recommendation ?? recommendationFromScore(score))
  const [markerX, markerY] = pointAt(value / 10)

  return (
    <div
      className={cn(
        'flex flex-col items-center',
        size === 'sm' ? 'w-28' : 'w-48',
        className
      )}
    >
      <svg
        viewBox='0 0 200 112'
        className='w-full overflow-visible'
        role='img'
        aria-label={
          score === null
            ? 'No hazard index'
            : `Hazard index ${score.toFixed(1)} of 10, ${call}`
        }
      >
        {RISK_BANDS.map((band) => {
          const from = band.from / 10 + (band.from > 0 ? GAP / 2 : 0)
          const to = band.to / 10 - (band.to < 10 ? GAP / 2 : 0)
          const filledTo = Math.min(to, value / 10)
          return (
            <g key={band.recommendation}>
              <path
                d={arc(from, to)}
                fill='none'
                strokeWidth={STROKE}
                stroke={RECOMMENDATION_HEX[band.recommendation]}
                strokeOpacity={0.16}
              />
              {score !== null && filledTo > from ? (
                <path
                  d={arc(from, filledTo)}
                  fill='none'
                  strokeWidth={STROKE}
                  stroke={RECOMMENDATION_HEX[band.recommendation]}
                />
              ) : null}
            </g>
          )
        })}
        {call ? (
          <circle
            cx={markerX}
            cy={markerY}
            r={STROKE / 2 + 2}
            fill={RECOMMENDATION_HEX[call]}
            className='stroke-background'
            strokeWidth={3}
          />
        ) : null}
        <text
          x='100'
          y='90'
          textAnchor='middle'
          className={cn(
            'fill-foreground font-bold tabular-nums',
            size === 'sm' ? 'text-[38px]' : 'text-[42px]'
          )}
        >
          {score === null ? '—' : score.toFixed(1)}
        </text>
        <text
          x='100'
          y='108'
          textAnchor='middle'
          className='fill-muted-foreground text-[11px] tracking-wider'
        >
          OF 10
        </text>
      </svg>
      {showLabel ? (
        <RecommendationStatus
          recommendation={call}
          status={status}
          className='mt-2'
        />
      ) : null}
    </div>
  )
}
