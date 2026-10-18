import {
  CAUTION_BELOW,
  GO_BELOW,
  RECOMMENDATION_BG,
  recommendationFromScore,
} from '@/lib/planit'
import { cn } from '@/lib/utils'

/** Inline 0-10 hazard index: the number plus a bar with the GO/CAUTION/NO-GO cut-offs marked. */
export function ScoreBar({
  score,
  className,
}: {
  /** Null when the site has no hazard index; never drawn as zero. */
  score: number | null
  className?: string
}) {
  if (score === null) {
    return (
      <div
        className={cn('flex items-center gap-2', className)}
        role='img'
        aria-label='No hazard index'
      >
        <span className='w-7 text-sm font-semibold text-muted-foreground'>
          —
        </span>
        <span className='relative h-1.5 w-full max-w-28 min-w-16 rounded-full border border-dashed' />
      </div>
    )
  }
  const call = recommendationFromScore(score)
  return (
    <div
      className={cn('flex items-center gap-2', className)}
      role='img'
      aria-label={`Hazard index ${score.toFixed(1)} out of 10`}
    >
      <span className='w-7 text-sm font-semibold text-foreground tabular-nums'>
        {score.toFixed(1)}
      </span>
      <span className='relative h-1.5 w-full max-w-28 min-w-16 rounded-full bg-muted'>
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
