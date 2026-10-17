import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = 'default',
  className,
}: {
  label: string
  value: string | number
  icon?: LucideIcon
  hint?: string
  tone?: 'default' | 'danger' | 'warning' | 'success'
  className?: string
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'success'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-muted-foreground'

  return (
    <Card className={className}>
      <CardContent className='flex items-start justify-between gap-3 p-4'>
        <div className='space-y-1'>
          <p className='text-xs font-medium text-muted-foreground'>{label}</p>
          <p className='text-2xl font-bold tabular-nums'>{value}</p>
          {hint ? <p className={cn('text-xs', toneClass)}>{hint}</p> : null}
        </div>
        {Icon ? (
          <span className='flex size-9 items-center justify-center rounded-md bg-muted'>
            <Icon className={cn('size-4', toneClass)} />
          </span>
        ) : null}
      </CardContent>
    </Card>
  )
}
