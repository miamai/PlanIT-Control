import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { Link } from '@tanstack/react-router'
import { CalendarClock } from 'lucide-react'
import { type Briefing } from '@/api/types'
import { useSites } from '@/hooks/use-planit'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CardActions } from '@/components/planit/card-actions'
import { PanelHeader } from '@/components/planit/panel-header'
import { RecommendationStatus } from '@/components/planit/risk-status'

export function BriefingPreview({
  briefing,
  isLoading,
}: {
  briefing: Briefing | undefined
  isLoading: boolean
}) {
  const { sites } = useSites()
  const names = useMemo(
    () => new Map(sites.map((site) => [site.id, site.name])),
    [sites]
  )

  return (
    <Card className='gap-4'>
      <PanelHeader
        icon={CalendarClock}
        title='Next briefing'
        aside={<CardActions to='/briefing' label='Open' />}
      />
      <CardContent className='space-y-3'>
        {!isLoading && !briefing ? (
          <div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
            No briefings stored yet. The worker generates them after 18:00
            site-local time.
          </div>
        ) : isLoading || !briefing ? (
          <div className='space-y-2'>
            <Skeleton className='h-4 w-2/3' />
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-5/6' />
          </div>
        ) : (
          <>
            <div className='flex items-baseline justify-between gap-2'>
              <p className='text-sm font-medium'>{briefing.headline}</p>
              <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
                {format(parseISO(briefing.shiftDate), 'EEE, MMM d')}
              </span>
            </div>
            <ul className='divide-y rounded-md border'>
              {briefing.sites.slice(0, 5).map((site) => (
                <li key={site.siteId}>
                  <Link
                    to='/sites/$siteId'
                    params={{ siteId: site.siteId }}
                    className='flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent'
                  >
                    <span className='min-w-0 flex-1 truncate'>
                      {names.get(site.siteId) ?? site.siteId}
                    </span>
                    <span className='text-xs text-muted-foreground tabular-nums'>
                      {site.score === null ? '—' : site.score.toFixed(1)}
                    </span>
                    <RecommendationStatus
                      recommendation={site.recommendation}
                      className='w-[72px] justify-end'
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
