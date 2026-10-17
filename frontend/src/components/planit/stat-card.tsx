import { Link } from '@tanstack/react-router'
import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface StatSegment {
  value: number
  label: string
  /** Tailwind background class, e.g. `bg-red-600`. */
  color: string
}

/**
 * KPI card with a fixed anatomy: label + icon, one number, one bar. With `max`
 * the bar fills against that total; without it the segments split the bar.
 * Exact counts are on hover; `to` makes the card open the detailed page.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  segments,
  max,
  to,
  className,
}: {
  label: string
  value: React.ReactNode
  icon: LucideIcon
  segments: StatSegment[]
  max?: number
  to?: '/sites' | '/alerts' | '/hazards' | '/briefing'
  className?: string
}) {
  const total = max ?? segments.reduce((sum, s) => sum + s.value, 0)
  const summary = segments.map((s) => `${s.value} ${s.label}`).join(' · ')

  const card = (
    <Card
      className={cn(
        'h-full gap-3',
        to && 'transition-colors group-hover:bg-accent/50',
        className
      )}
    >
      <CardHeader className='flex flex-row items-center justify-between'>
        <CardTitle className='text-sm font-medium'>{label}</CardTitle>
        <Icon className='size-4 text-muted-foreground' />
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='text-2xl font-bold tabular-nums'>{value}</div>
        <div
          className='flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted'
          title={summary}
          role='img'
          aria-label={summary}
        >
          {segments.map((segment) =>
            segment.value > 0 && total > 0 ? (
              <span
                key={segment.label}
                className={cn('h-full', segment.color)}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ) : null
          )}
        </div>
      </CardContent>
    </Card>
  )

  if (!to) return card

  return (
    <Link
      to={to}
      className='group rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
    >
      {card}
    </Link>
  )
}
