import { Link } from '@tanstack/react-router'
import { ArrowRight, Clock, MessageSquareText, Sparkles } from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { type Briefing } from '@/api/types'
import { useLiveStore } from '@/stores/live-store'
import { formatCountdownTo, relativeTime } from '@/lib/planit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RecommendationBadge } from '@/components/planit/risk-badge'

export function BriefingPreview({
  briefing,
  isLoading,
}: {
  briefing: Briefing | undefined
  isLoading: boolean
}) {
  const now = useLiveStore((state) => state.now)

  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Clock className='size-4 text-muted-foreground' />
          Next-day briefing
        </CardTitle>
        <Badge variant='outline' className='text-[10px]'>
          18:00 local
        </Badge>
      </CardHeader>
      <CardContent className='space-y-3'>
        {isLoading || !briefing ? (
          <div className='space-y-2'>
            <Skeleton className='h-4 w-2/3' />
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-5/6' />
          </div>
        ) : (
          <>
            <p className='text-xs text-muted-foreground'>
              Sending in{' '}
              <span className='font-semibold text-foreground tabular-nums'>
                {formatCountdownTo(briefing.sendAt, now)}
              </span>
            </p>
            <p className='text-sm font-medium'>{briefing.headline}</p>
            <ul className='space-y-1.5'>
              {briefing.sites.slice(0, 3).map((site) => (
                <li key={site.siteId} className='flex items-center gap-2'>
                  <Link
                    to='/sites/$siteId'
                    params={{ siteId: site.siteId }}
                    className='truncate text-xs font-medium hover:text-primary'
                  >
                    {SITE_SEED.find((s) => s.id === site.siteId)?.name ??
                      site.siteId}
                  </Link>
                  <RecommendationBadge
                    recommendation={site.recommendation}
                    className='origin-left scale-90'
                  />
                  <span className='ms-auto text-xs tabular-nums'>
                    {site.score.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
            <div className='rounded-md bg-muted/60 p-2.5'>
              <p className='mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase'>
                <MessageSquareText className='size-3' /> SMS preview
              </p>
              <p className='text-[11px] leading-relaxed text-muted-foreground'>
                {briefing.smsPreview}
              </p>
            </div>
            <div className='flex items-center justify-between gap-2 pt-1'>
              <span className='flex items-center gap-1 text-[11px] text-muted-foreground'>
                <Sparkles className='size-3 text-violet-500' />
                {briefing.generator === 'gemini'
                  ? 'Gemini briefing template'
                  : 'Rule template'}{' '}
                · {relativeTime(briefing.generatedAt)}
              </span>
              <Button asChild size='sm' variant='ghost'>
                <Link to='/briefing'>
                  Open <ArrowRight />
                </Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
