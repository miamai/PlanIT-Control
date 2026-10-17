import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getBriefing, listBriefings } from '@/api'
import {
  ArrowRight,
  CalendarDays,
  Eye,
  MessageSquareText,
  Radar,
  Sparkles,
} from 'lucide-react'
import { RECOMMENDATION_TEXT, relativeTime } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useSiteBundles } from '@/hooks/use-planit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { HazardGauge } from '@/components/planit/hazard-gauge'
import { PlanitHeader } from '@/components/planit/planit-header'
import { RecommendationBadge } from '@/components/planit/risk-badge'

export function BriefingPage() {
  const bundles = useSiteBundles()

  const currentQuery = useQuery({
    queryKey: ['briefing', 'current'],
    queryFn: () => getBriefing(),
    staleTime: 60_000,
  })
  const historyQuery = useQuery({
    queryKey: ['briefings', 'history'],
    queryFn: () => listBriefings(),
    staleTime: 60_000,
  })

  const briefing = currentQuery.data
  const history = historyQuery.data ?? []

  const scoresBySite = useMemo(() => {
    const map = new Map<string, { score: number; recommendation: string }>()
    for (const bundle of bundles) {
      map.set(bundle.site.id, {
        score: bundle.risk.score,
        recommendation: bundle.risk.recommendation,
      })
    }
    return map
  }, [bundles])

  return (
    <>
      <PlanitHeader active='briefing' />
      <Main>
        <div className='mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <div className='space-y-1'>
            <h1 className='text-2xl font-bold tracking-tight'>
              Shift briefing
            </h1>
            <p className='text-sm text-muted-foreground'>
              Every day at 6:00 PM local time we push tomorrow&apos;s safety
              briefing to every supervisor on the network.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Badge
              variant='outline'
              className='flex items-center gap-1 text-muted-foreground'
            >
              <Sparkles className='size-3' />
              {briefing?.generator === 'gemini'
                ? 'Gemini generated'
                : 'Template fallback'}
            </Badge>
            <Button size='sm' variant='outline' asChild>
              <a
                href='#briefing-sms'
                onClick={(e) => e.preventDefault()}
                className='hidden sm:inline-flex'
              >
                <MessageSquareText /> SMS preview
              </a>
            </Button>
          </div>
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          <div className='space-y-4 lg:col-span-2'>
            {currentQuery.isLoading || !briefing ? (
              <Card>
                <CardContent className='space-y-3 p-5'>
                  <Skeleton className='h-6 w-2/3' />
                  <Skeleton className='h-4 w-full' />
                  <Skeleton className='h-4 w-5/6' />
                  <Skeleton className='h-40 w-full' />
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader className='pb-3'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <CardTitle className='flex items-center gap-2 text-base'>
                        <CalendarDays className='size-4 text-muted-foreground' />
                        {format(
                          parseISO(briefing.shiftDate),
                          'EEEE, MMMM d, yyyy'
                        )}{' '}
                        shift
                      </CardTitle>
                      <span className='text-xs text-muted-foreground'>
                        Generated {relativeTime(briefing.generatedAt)}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    <p className='text-lg font-semibold'>{briefing.headline}</p>
                    <p className='text-sm leading-relaxed text-muted-foreground'>
                      {briefing.summary}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className='pb-3'>
                    <CardTitle className='flex items-center gap-2 text-base'>
                      <Radar className='size-4 text-muted-foreground' />
                      Sites needing attention tomorrow
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    {briefing.sites.map((site) => {
                      const live = scoresBySite.get(site.siteId)
                      return (
                        <div
                          key={site.siteId}
                          className='rounded-lg border p-3'
                        >
                          <div className='flex flex-wrap items-center gap-2'>
                            <Link
                              to='/sites/$siteId'
                              params={{ siteId: site.siteId }}
                              className='text-sm font-medium hover:underline'
                            >
                              {site.headline}
                            </Link>
                            <RecommendationBadge
                              recommendation={site.recommendation}
                            />
                            {live ? (
                              <span
                                className={cn(
                                  'ms-auto text-xs tabular-nums',
                                  RECOMMENDATION_TEXT[site.recommendation]
                                )}
                              >
                                forecast {site.score.toFixed(1)} / 10
                              </span>
                            ) : null}
                          </div>
                          <ul className='mt-2 list-inside list-disc text-xs text-muted-foreground'>
                            {site.actions.map((action) => (
                              <li key={action}>{action}</li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>

                <Card id='briefing-sms'>
                  <CardHeader className='pb-3'>
                    <CardTitle className='flex items-center gap-2 text-base'>
                      <MessageSquareText className='size-4 text-muted-foreground' />
                      SMS preview (160 chars)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className='rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed'>
                      {briefing.smsPreview}
                    </p>
                  </CardContent>
                </Card>
              </>
            )}

            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <Eye className='size-4 text-muted-foreground' />
                  Watchlist
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                {briefing?.watchlist.map((item) => (
                  <div key={item.label} className='space-y-1'>
                    <p className='text-sm font-medium'>{item.label}</p>
                    <p className='text-xs leading-relaxed text-muted-foreground'>
                      {item.detail}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className='space-y-4'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>Today vs tomorrow</CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                {bundles.slice(0, 6).map((bundle) => (
                  <Link
                    key={bundle.site.id}
                    to='/sites/$siteId'
                    params={{ siteId: bundle.site.id }}
                    className='flex items-center justify-between rounded-md px-2 py-1 hover:bg-muted/60'
                  >
                    <span className='truncate text-sm'>{bundle.site.name}</span>
                    <HazardGauge
                      score={bundle.risk.score}
                      recommendation={bundle.risk.recommendation}
                      size='sm'
                    />
                  </Link>
                ))}
                <Button asChild variant='outline' size='sm' className='w-full'>
                  <Link to='/sites'>
                    See all monitored sites <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>Previous briefings</CardTitle>
              </CardHeader>
              <CardContent className='space-y-2'>
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className='flex items-center justify-between rounded-md border px-3 py-2 text-sm'
                  >
                    <span>
                      {format(parseISO(entry.shiftDate), 'EEE, MMM d')}
                    </span>
                    <span className='text-xs text-muted-foreground'>
                      {entry.sites.length} sites flagged
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
