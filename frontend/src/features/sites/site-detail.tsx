import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getHazardIndexHistory, getTimeline, listHazardReports } from '@/api'
import {
  Activity,
  ArrowLeft,
  Bot,
  RadioTower,
  TriangleAlert,
} from 'lucide-react'
import { RECOMMENDATION_DESCRIPTION } from '@/lib/planit'
import { cn } from '@/lib/utils'
import {
  useLiveStrikes,
  useSiteBundle,
  useSimulateStrike,
} from '@/hooks/use-planit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { AlertItem } from '@/components/planit/alert-item'
import { CardActions } from '@/components/planit/card-actions'
import { DomainCard } from '@/components/planit/domain-card'
import { HazardGauge } from '@/components/planit/hazard-gauge'
import { PlanitHeader } from '@/components/planit/planit-header'
import { ReportList } from '@/components/planit/report-list'
import {
  RecommendationBadge,
  TrendIndicator,
} from '@/components/planit/risk-badge'
import { SiteMap } from '@/components/planit/site-map'
import { ConditionsChart } from './components/conditions-chart'
import { HazardIndexChart } from './components/hazard-index-chart'

export function SiteDetail({ siteId }: { siteId: string }) {
  const bundle = useSiteBundle(siteId)
  const strikes = useLiveStrikes()
  const simulateStrike = useSimulateStrike()

  const reportsQuery = useQuery({
    queryKey: ['hazard-reports', siteId],
    queryFn: () => listHazardReports(siteId),
    staleTime: 30_000,
  })
  const historyQuery = useQuery({
    queryKey: ['hazard-index-history', siteId],
    queryFn: () => getHazardIndexHistory(siteId),
    staleTime: 60_000,
  })
  const timelineQuery = useQuery({
    queryKey: ['timeline', siteId],
    queryFn: () => getTimeline(siteId),
    staleTime: 60_000,
  })

  if (!bundle) {
    return (
      <>
        <PlanitHeader active='sites' />
        <Main>
          <Card>
            <CardContent className='p-10 text-center'>
              <p className='text-lg font-medium'>Site not found</p>
              <p className='mb-4 text-sm text-muted-foreground'>
                This site is not in the monitored portfolio.
              </p>
              <Button asChild>
                <Link to='/sites'>
                  <ArrowLeft /> Back to sites
                </Link>
              </Button>
            </CardContent>
          </Card>
        </Main>
      </>
    )
  }

  const { site, risk, conditions, alerts } = bundle
  const siteStrikes = strikes.filter((strike) => strike.siteId === siteId)

  return (
    <>
      <PlanitHeader
        active='sites'
        actions={
          <Button asChild size='sm' className='hidden sm:inline-flex'>
            <Link to='/hazards/new' search={{ site: site.id }}>
              <TriangleAlert /> Report hazard
            </Link>
          </Button>
        }
      />
      <Main>
        <Button asChild variant='ghost' size='sm' className='mb-3 px-2'>
          <Link to='/sites'>
            <ArrowLeft /> All sites
          </Link>
        </Button>

        <Card className='mb-4'>
          <CardContent className='flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between'>
            <div className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <h1 className='text-2xl font-bold tracking-tight'>
                  {site.name}
                </h1>
                <Badge variant='outline'>{site.plantType}</Badge>
                {conditions.lightningActive ? (
                  <Badge className='border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'>
                    Lightning active
                  </Badge>
                ) : null}
              </div>
              <p className='text-sm text-muted-foreground'>
                {site.utility} · {site.county} County, {site.state} ·{' '}
                {site.capacityMw.toLocaleString()} MW
              </p>
              <p className='text-xs text-muted-foreground'>
                {site.lat.toFixed(4)}, {site.lon.toFixed(4)} · EIA plant #
                {site.eiaPlantId} · profile updated{' '}
                {format(risk.updatedAt, 'HH:mm:ss')}
              </p>
              <div className='flex flex-wrap gap-2 pt-1'>
                <Button asChild size='sm' variant='outline'>
                  <Link to='/hazards/new' search={{ site: site.id }}>
                    <TriangleAlert /> Report hazard
                  </Link>
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => simulateStrike(site.id)}
                >
                  <RadioTower /> Simulate strike
                </Button>
              </div>
            </div>

            <HazardGauge
              score={risk.score}
              recommendation={risk.recommendation}
            />
          </CardContent>
        </Card>

        <div className='grid gap-4 lg:grid-cols-3'>
          <div className='space-y-4 lg:col-span-2'>
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <Bot className='size-4 text-muted-foreground' />
                  Why this score
                </CardTitle>
                <div className='flex items-center gap-2'>
                  <Badge variant='outline' className='text-[10px]'>
                    {risk.modelVersion}
                  </Badge>
                  <TrendIndicator trend={risk.trend} />
                </div>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex flex-wrap items-center gap-3'>
                  <RecommendationBadge recommendation={risk.recommendation} />
                  <p className='text-sm text-muted-foreground'>
                    {RECOMMENDATION_DESCRIPTION[risk.recommendation]}
                  </p>
                </div>

                <ul className='space-y-3'>
                  {risk.reasons.map((reason) => (
                    <li key={reason.domain}>
                      <div className='mb-1 flex items-center justify-between text-sm'>
                        <span className='font-medium'>{reason.label}</span>
                        <span className='text-xs text-muted-foreground tabular-nums'>
                          {Math.round(reason.contribution * 100)}% of score
                        </span>
                      </div>
                      <div className='mb-1 h-2 w-full overflow-hidden rounded-full bg-muted'>
                        <div
                          className={cn(
                            'h-full rounded-full',
                            reason.contribution >= 0.3
                              ? 'bg-red-600'
                              : reason.contribution >= 0.2
                                ? 'bg-amber-500'
                                : 'bg-sky-500'
                          )}
                          style={{ width: `${reason.contribution * 100}%` }}
                        />
                      </div>
                      <p className='text-xs text-muted-foreground'>
                        {reason.detail}
                      </p>
                    </li>
                  ))}
                </ul>

                <div className='rounded-md bg-muted/50 px-3 py-2'>
                  <p className='text-[11px] font-medium text-muted-foreground uppercase'>
                    Model validation
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    {risk.backtest}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <Activity className='size-4 text-muted-foreground' />
                  Combined risk picture
                </CardTitle>
                <span className='text-xs text-muted-foreground'>
                  7 fused hazard domains
                </span>
              </CardHeader>
              <CardContent>
                <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
                  {risk.domains.map((domain) => (
                    <DomainCard key={domain.domain} domain={domain} />
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
                <CardTitle className='text-base'>
                  Hazard index history
                </CardTitle>
                <span className='text-xs text-muted-foreground'>
                  Last 14 days
                </span>
              </CardHeader>
              <CardContent>
                {historyQuery.data ? (
                  <HazardIndexChart points={historyQuery.data} />
                ) : (
                  <Skeleton className='h-[240px] w-full' />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
                <CardTitle className='text-base'>
                  Conditions — last 24 hours
                </CardTitle>
                <span className='text-xs text-muted-foreground'>
                  Heat index · wind · rainfall
                </span>
              </CardHeader>
              <CardContent>
                {timelineQuery.data ? (
                  <ConditionsChart points={timelineQuery.data} />
                ) : (
                  <Skeleton className='h-[260px] w-full' />
                )}
              </CardContent>
            </Card>
          </div>

          <div className='space-y-4'>
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
                <CardTitle className='text-base'>Live alerts</CardTitle>
                <CardActions to='/alerts' label='All alerts' />
              </CardHeader>
              <CardContent className='space-y-3'>
                {alerts.length === 0 ? (
                  <div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
                    No active alerts for this site.
                  </div>
                ) : (
                  alerts.map((alert) => (
                    <AlertItem
                      key={alert.id}
                      alert={alert}
                      onSimulate={() => simulateStrike(site.id)}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
                <CardTitle className='text-base'>Site map</CardTitle>
                <span className='text-xs text-muted-foreground'>
                  {siteStrikes.length} strike
                  {siteStrikes.length === 1 ? '' : 's'} nearby
                </span>
              </CardHeader>
              <CardContent>
                <SiteMap
                  markers={[
                    {
                      site,
                      score: risk.score,
                      activeLightning: conditions.lightningActive,
                    },
                  ]}
                  strikes={siteStrikes}
                  reports={reportsQuery.data ?? []}
                  selectedSiteId={site.id}
                  height='h-[300px]'
                  interactive={false}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
                <CardTitle className='text-base'>Crew reports</CardTitle>
                <Button
                  asChild
                  size='sm'
                  variant='ghost'
                  className='h-7 text-xs'
                >
                  <Link to='/hazards/new' search={{ site: site.id }}>
                    Add report
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                <ReportList
                  reports={reportsQuery.data}
                  isLoading={reportsQuery.isLoading}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
