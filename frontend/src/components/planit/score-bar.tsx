import { type Recommendation } from '@/api/types'
import {
  CAUTION_BELOW,
  GO_BELOW,
  RECOMMENDATION_BG,
  RECOMMENDATION_TEXT,
  recommendationFromScore,
} from '@/lib/planit'
import { cn } from '@/lib/utils'

/** Inline 0-10 hazard index: the number plus a bar with the GO/CAUTION/NO-GO cut-offs marked. */
export function ScoreBar({
  score,
  showValue = true,
  className,
}: {
  score: number
  showValue?: boolean
  className?: string
}) {
  const call = recommendationFromScore(score)
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showValue ? (
        <span
          className={cn(
            'w-7 text-sm font-semibold tabular-nums',
            RECOMMENDATION_TEXT[call]
          )}
        >
          {score.toFixed(1)}
        </span>
      ) : null}
      <span
        className={cn(
          'relative h-1.5 w-full min-w-16 rounded-full bg-muted',
          showValue && 'max-w-28'
        )}
      >
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            RECOMMENDATION_BG[call]
          )}
          style={{ width: `${Math.min(100, score * 10)}%` }}
        />
        {[GO_BELOW, CAUTION_BELOW].map((cut) => (
          <span
            key={cut}
            aria-hidden
            className='absolute -inset-y-0.5 w-px bg-background'
            style={{ left: `${cut * 10}%` }}
          />
        ))}
      </span>
    </div>
  )
}

/** Stacked GO / CAUTION / NO-GO split of the fleet with counts. */
export function RiskDistributionBar({
  counts,
  className,
}: {
  counts: Record<Recommendation, number>
  className?: string
}) {
  const order: Recommendation[] = ['NO-GO', 'CAUTION', 'GO']
  const total = order.reduce((sum, call) => sum + counts[call], 0) || 1
  return (
    <div className={cn('space-y-2', className)}>
      <div className='flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted'>
        {order.map((call) =>
          counts[call] > 0 ? (
            <span
              key={call}
              className={cn(
                'h-full first:rounded-s-full last:rounded-e-full',
                RECOMMENDATION_BG[call]
              )}
              style={{ width: `${(counts[call] / total) * 100}%` }}
            />
          ) : null
        )}
      </div>
      <div className='flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground'>
        {order.map((call) => (
          <span key={call} className='inline-flex items-center gap-1.5'>
            <span
              className={cn('size-2 rounded-full', RECOMMENDATION_BG[call])}
            />
            <span className='font-medium text-foreground tabular-nums'>
              {counts[call]}
            </span>
            {call}
          </span>
        ))}
      </div>
    </div>
  )
}
