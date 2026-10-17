import { type ReasonContribution } from '@/api/types'
import { DOMAIN_ICON } from '@/lib/planit'
import { cn } from '@/lib/utils'

/** Identifies the leading score contributor, independently of stop-work status. */
export function RiskDriverIcon({
  driver,
  className,
}: {
  driver: ReasonContribution | undefined
  className?: string
}) {
  if (!driver) return null

  const Icon = DOMAIN_ICON[driver.domain]
  const description = `Top risk driver: ${driver.label} · ${Math.round(driver.contribution * 100)}% of score`

  return (
    <span
      role='img'
      aria-label={description}
      title={description}
      className={cn('inline-flex shrink-0 text-muted-foreground', className)}
    >
      <Icon className='size-3.5' aria-hidden />
    </span>
  )
}
