import { Link } from '@tanstack/react-router'
import type { SiteBundle } from '@/hooks/use-planit'
import { RiskDriverIcon } from '@/components/planit/risk-driver-icon'
import { RecommendationStatus } from '@/components/planit/risk-status'
import { ScoreBar } from '@/components/planit/score-bar'

/** Ranking pairs with map markers; every viewport retains the score and decision. */
export function PrioritySites({ items }: { items: SiteBundle[] }) {
  return (
    <ol className='divide-y'>
      {items.map((bundle, index) => (
        <li key={bundle.site.id}>
          <Link
            to='/sites/$siteId'
            params={{ siteId: bundle.site.id }}
            className='-mx-2 grid grid-cols-[2rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-1 rounded-md px-2 py-2.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[2rem_minmax(0,1fr)_6rem]'
          >
            <span className='row-span-2 flex size-8 shrink-0 items-center justify-center self-start rounded-lg bg-muted text-xs font-medium text-muted-foreground tabular-nums sm:row-span-1'>
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className='col-span-2 min-w-0 sm:col-span-1'>
              <span className='flex items-start gap-1 text-sm leading-5 font-semibold'>
                <span className='min-w-0 break-words'>{bundle.site.name}</span>
                <RiskDriverIcon
                  driver={bundle.risk.reasons[0]}
                  className='mt-0.5'
                />
              </span>
              <span className='block text-xs leading-5 text-muted-foreground'>
                {bundle.risk.reasons[0]?.label ?? 'No dominant driver'} ·{' '}
                {bundle.site.state}
              </span>
            </span>
            <ScoreBar
              score={bundle.risk.score}
              className='col-start-2 row-start-2 w-24 sm:col-start-3 sm:row-start-1'
            />
            <RecommendationStatus
              withDesktopLegend
              recommendation={bundle.risk.recommendation}
              status={bundle.risk.status}
              className='col-start-3 row-start-2 justify-end'
            />
          </Link>
        </li>
      ))}
    </ol>
  )
}
