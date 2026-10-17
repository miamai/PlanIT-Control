import { Zap } from 'lucide-react'
import { formatDuration } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useCountdown } from '@/hooks/use-planit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const ALL_CLEAR_SECONDS = 30 * 60

export function LightningCountdown({
  allClearAt,
  strikeCount,
  distanceMi,
  compact = false,
  onSimulate,
  className,
}: {
  allClearAt: string
  strikeCount?: number
  distanceMi?: number
  compact?: boolean
  onSimulate?: () => void
  className?: string
}) {
  const remaining = useCountdown(allClearAt)
  const cleared = remaining <= 0
  const progress = cleared ? 1 : 1 - remaining / ALL_CLEAR_SECONDS
  const size = compact ? 72 : 104
  const stroke = compact ? 7 : 9
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className='relative' style={{ width: size, height: size }}>
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
            strokeDasharray={`${circumference * progress} ${circumference}`}
            className={cn(
              'transition-[stroke-dasharray] duration-1000 ease-linear',
              cleared ? 'stroke-emerald-500' : 'stroke-red-600'
            )}
          />
        </svg>
        <div className='absolute inset-0 flex flex-col items-center justify-center'>
          <span
            className={cn(
              'font-bold tabular-nums',
              compact ? 'text-sm' : 'text-xl'
            )}
          >
            {cleared ? 'CLEAR' : formatDuration(remaining)}
          </span>
          {!cleared ? (
            <span className='text-[10px] text-muted-foreground'>
              to all-clear
            </span>
          ) : null}
        </div>
      </div>

      <div className='space-y-1.5'>
        <div className='flex flex-wrap items-center gap-2'>
          <CountdownIcon
            className={cleared ? 'text-emerald-500' : 'text-red-600'}
          />
          <p className='text-sm font-medium'>
            {cleared ? 'All-clear reached' : 'Lightning stop-work active'}
          </p>
        </div>
        <div className='flex flex-wrap gap-1.5'>
          {typeof strikeCount === 'number' ? (
            <Badge variant='outline' className='text-[11px]'>
              {strikeCount} strike{strikeCount === 1 ? '' : 's'} / 10 mi
            </Badge>
          ) : null}
          {typeof distanceMi === 'number' && distanceMi > 0 ? (
            <Badge variant='outline' className='text-[11px]'>
              nearest {distanceMi} mi
            </Badge>
          ) : null}
        </div>
        <p className='max-w-[26ch] text-xs text-muted-foreground'>
          Countdown resets on every new strike inside the 10 mile radius.
        </p>
        {onSimulate ? (
          <Button
            size='sm'
            variant='outline'
            className='mt-1'
            onClick={onSimulate}
          >
            <Zap /> Simulate strike
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CountdownIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-4 items-center justify-center rounded-full',
        className
      )}
    >
      <span className='size-2 animate-ping rounded-full bg-current' />
    </span>
  )
}
