import { Link } from '@tanstack/react-router'
import { CalendarClock } from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { type Briefing } from '@/api/types'
import { useLiveStore } from '@/stores/live-store'
import { formatCountdownTo } from '@/lib/planit'
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
  const now = useLiveStore((state) => state.now)

  return (
    <Card className='gap-4'>
      <PanelHeader
        icon={CalendarClock}
        title="Tomorrow's briefing"
        aside={<CardActions to='/briefing' label='Open' />}
      />
      <CardContent className='space-y-3'>
        {isLoading || !briefing ? (
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
                18:00 · {formatCountdownTo(briefing.sendAt, now)}
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
                      {SITE_SEED.find((s) => s.id === site.siteId)?.name ??
                        site.siteId}
                    </span>
                    <span className='text-xs text-muted-foreground tabular-nums'>
                      {site.score.toFixed(1)}
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
