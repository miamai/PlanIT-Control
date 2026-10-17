import { ShieldAlert, Zap } from 'lucide-react'
import {
  ALL_CLEAR_MINUTES,
  LIGHTNING_RADIUS_MI,
  formatDuration,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useCountdown } from '@/hooks/use-planit'

const ALL_CLEAR_SECONDS = ALL_CLEAR_MINUTES * 60

/**
 * Lightning stop-work all-clear timer. Reaching zero means the site is
 * all-clear *eligible*: the backend never authorizes work to resume on its own,
 * so an admin still has to clear it. `inline` fits inside an alert row,
 * `ring` is the large dial used where the countdown is the main content.
 */
export function LightningCountdown({
  allClearAt,
  strikeCount,
  distanceMi,
  variant = 'ring',
  heading,
  className,
}: {
  allClearAt: string
  strikeCount?: number
  distanceMi?: number
  variant?: 'ring' | 'inline'
  /** Replaces the default "Stop-work in effect" line, e.g. with the site name. */
  heading?: React.ReactNode
  className?: string
}) {
  const remaining = useCountdown(allClearAt)
  const cleared = remaining <= 0
  // Share of the 30-minute window still to run; the bar drains like a timer.
  const remainingShare = cleared
    ? 0
    : Math.min(1, remaining / ALL_CLEAR_SECONDS)

  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center gap-2 rounded-md border px-2 py-1.5',
          cleared
            ? 'border-amber-500/30 bg-amber-500/5'
            : 'border-red-600/30 bg-red-600/5',
          className
        )}
      >
        {cleared ? (
          <ShieldAlert className='size-3.5 shrink-0 text-amber-600' />
        ) : (
          <Zap className='size-3.5 shrink-0 fill-red-600 text-red-600' />
        )}
        <span className='min-w-0 flex-1 text-xs leading-5 break-words'>
          {cleared ? (
            'All-clear eligible · admin sign-off required'
          ) : (
            <>
              All-clear in{' '}
              <span className='font-semibold tabular-nums'>
                {formatDuration(remaining)}
              </span>
            </>
          )}
        </span>
        {!cleared ? (
          <span className='h-1 w-full overflow-hidden rounded-full bg-muted'>
            <span
              className={cn(
                'block h-full rounded-full transition-[width] duration-1000 ease-linear',
                cleared ? 'bg-amber-500' : 'bg-red-600'
              )}
              style={{ width: `${remainingShare * 100}%` }}
            />
          </span>
        ) : null}
      </div>
    )
  }

  const size = 112
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-4', className)}>
      <div className='relative shrink-0' style={{ width: size, height: size }}>
        <svg width={size} height={size} className='-rotate-90'>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill='none'
            strokeWidth={stroke}
            className='stroke-muted'
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill='none'
            strokeWidth={stroke}
            strokeLinecap='round'
            strokeDasharray={`${circumference * (cleared ? 1 : remainingShare)} ${circumference}`}
            className={cn(
              'transition-[stroke-dasharray] duration-1000 ease-linear',
              cleared ? 'stroke-amber-500' : 'stroke-red-600'
            )}
          />
        </svg>
        <div className='absolute inset-0 flex flex-col items-center justify-center'>
          <span className='text-xl font-bold tabular-nums'>
            {cleared ? 'Eligible' : formatDuration(remaining)}
          </span>
          <span className='text-[10px] text-muted-foreground uppercase'>
            {cleared ? 'needs sign-off' : 'to all-clear'}
          </span>
        </div>
      </div>

      <div className='min-w-0 flex-1 basis-40 space-y-1 break-words'>
        {heading ? (
          <div className='text-sm font-semibold'>{heading}</div>
        ) : (
          <p
            className={cn(
              'text-sm font-semibold',
              cleared ? 'text-amber-600' : 'text-red-600 dark:text-red-400'
            )}
          >
            {cleared
              ? 'All-clear eligible · admin sign-off required'
              : 'Stop-work in effect'}
          </p>
        )}
        <p className='text-xs text-muted-foreground'>
          {typeof strikeCount === 'number'
            ? `${strikeCount} strike${strikeCount === 1 ? '' : 's'} within ${LIGHTNING_RADIUS_MI} mi`
            : `Strike within ${LIGHTNING_RADIUS_MI} mi`}
          {typeof distanceMi === 'number' && distanceMi > 0
            ? ` · nearest ${distanceMi} mi`
            : ''}
        </p>
      </div>
    </div>
  )
}
