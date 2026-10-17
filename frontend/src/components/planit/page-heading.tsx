import { cn } from '@/lib/utils'

export function PageHeading({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between',
        className
      )}
    >
      <div className='min-w-0 space-y-1'>
        <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
        {description ? (
          <p className='text-sm text-muted-foreground'>{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className='flex flex-wrap items-center gap-2'>{actions}</div>
      ) : null}
    </div>
  )
}
