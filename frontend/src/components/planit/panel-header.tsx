import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CardHeader, CardTitle } from '@/components/ui/card'

/** Card header: icon + title on the left, an optional action or value on the right. */
export function PanelHeader({
  icon: Icon,
  title,
  aside,
  className,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  aside?: React.ReactNode
  className?: string
}) {
  return (
    <CardHeader
      className={cn(
        'flex flex-row items-center justify-between gap-2',
        className
      )}
    >
      <CardTitle className='flex min-w-0 items-center gap-2'>
        {Icon ? (
          <Icon className='size-4 shrink-0 text-muted-foreground' />
        ) : null}
        {title}
      </CardTitle>
      {aside ? (
        <div className='flex shrink-0 items-center gap-2 text-xs text-muted-foreground'>
          {aside}
        </div>
      ) : null}
    </CardHeader>
  )
}
