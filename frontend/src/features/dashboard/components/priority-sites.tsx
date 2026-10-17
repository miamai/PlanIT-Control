import { Link } from '@tanstack/react-router'
import { Zap } from 'lucide-react'
import { RECOMMENDATION_BG } from '@/lib/planit'
import { cn } from '@/lib/utils'
import type { SiteBundle } from '@/hooks/use-planit'
import { RecommendationBadge } from '@/components/planit/risk-badge'
import { ScoreBar } from '@/components/planit/score-bar'

/** Compact top-N ranking that pairs with the numbered markers on the risk map. */
export function PrioritySites({ items }: { items: SiteBundle[] }) {
  return (
    <ol className='divide-y'>
      {items.map((bundle, index) => (
        <li key={bundle.site.id}>
          <Link
            to='/sites/$siteId'
            params={{ siteId: bundle.site.id }}
            className='-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent'
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white',
                RECOMMENDATION_BG[bundle.risk.recommendation]
              )}
            >
              {index + 1}
            </span>
            <span className='min-w-0 flex-1'>
              <span className='flex items-center gap-1 truncate text-sm font-medium'>
                <span className='truncate'>{bundle.site.name}</span>
                {bundle.conditions.lightningActive ? (
                  <Zap
                    className='size-3.5 shrink-0 fill-violet-500 text-violet-500'
                    aria-label='Lightning stop-work active'
                  />
                ) : null}
              </span>
              <span className='block truncate text-xs text-muted-foreground'>
                {bundle.risk.reasons[0]?.label ?? 'No dominant driver'} ·{' '}
                {bundle.site.state}
              </span>
            </span>
            <ScoreBar
              score={bundle.risk.score}
              className='hidden w-28 shrink-0 sm:flex'
            />
            <RecommendationBadge
              recommendation={bundle.risk.recommendation}
              className='w-[76px] shrink-0 justify-center'
            />
          </Link>
        </li>
      ))}
    </ol>
  )
}
