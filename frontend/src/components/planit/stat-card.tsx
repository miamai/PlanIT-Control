import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = 'default',
  className,
  children,
}: {
  label: string
  value: React.ReactNode
  icon?: LucideIcon
  hint?: React.ReactNode
  tone?: 'default' | 'danger' | 'warning' | 'success'
  className?: string
  children?: React.ReactNode
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
    <Card className={cn('gap-3', className)}>
      <CardHeader className='flex flex-row items-center justify-between'>
        <CardTitle className='text-sm font-medium'>{label}</CardTitle>
        {Icon ? (
          <Icon
            className={cn(
              'size-4',
              tone === 'default' ? 'text-muted-foreground' : toneClass
            )}
          />
        ) : null}
      </CardHeader>
      <CardContent className='space-y-2'>
        <div className='text-2xl font-bold tabular-nums'>{value}</div>
        {hint ? <p className={cn('text-xs', toneClass)}>{hint}</p> : null}
        {children}
      </CardContent>
    </Card>
  )
}
