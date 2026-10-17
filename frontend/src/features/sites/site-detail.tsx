import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getHazardIndexHistory, getTimeline, listHazardReports } from '@/api'
import {
  Activity,
  ArrowLeft,
  ChartLine,
  CloudSun,
  Map as MapIcon,
  Pin,
  RadioTower,
  Scale,
  Siren,
  TriangleAlert,
} from 'lucide-react'
import {
  useLiveStrikes,
  useSiteBundle,
  useSimulateStrike,
} from '@/hooks/use-planit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { AlertItem } from '@/components/planit/alert-item'
import { HazardGauge } from '@/components/planit/hazard-gauge'
import { LightningCountdown } from '@/components/planit/lightning-countdown'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'
import { ReportList } from '@/components/planit/report-list'
import { TrendIndicator } from '@/components/planit/risk-badge'
import { RiskPicture } from '@/components/planit/risk-picture'
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
        <PlanitHeader />
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
  const lightningAlert = alerts.find(
    (alert) => alert.type === 'lightning' && alert.allClearAt
  )

  return (
    <>
      <PlanitHeader />
      <Main>
        <Button asChild variant='ghost' size='sm' className='-ms-2 mb-3'>
          <Link to='/sites'>
            <ArrowLeft /> All sites
          </Link>
        </Button>

        <Card className='mb-4 gap-0 overflow-hidden py-0'>
          {lightningAlert?.allClearAt ? (
            <div className='border-b border-red-600/20 bg-red-600/5 px-6 py-4'>
              <LightningCountdown
                allClearAt={lightningAlert.allClearAt}
                strikeCount={lightningAlert.strikeCount}
                distanceMi={lightningAlert.distanceMi}
              />
            </div>
          ) : null}
          <div className='flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between'>
            <div className='min-w-0 space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <h1 className='text-2xl font-bold tracking-tight'>
                  {site.name}
                </h1>
                <Badge variant='outline'>{site.plantType}</Badge>
              </div>
              <p className='text-sm text-muted-foreground'>
                {site.utility} · {site.county} County, {site.state} ·{' '}
                {site.capacityMw.toLocaleString()} MW
              </p>
              <p className='text-xs text-muted-foreground tabular-nums'>
                {site.lat.toFixed(4)}, {site.lon.toFixed(4)} · EIA plant #
                {site.eiaPlantId} · updated {format(risk.updatedAt, 'HH:mm:ss')}
              </p>
              <div className='flex flex-wrap gap-2 pt-2'>
                <Button asChild size='sm'>
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

            <div className='flex flex-col items-center gap-1 self-center'>
              <HazardGauge
                score={risk.score}
                recommendation={risk.recommendation}
              />
              <TrendIndicator trend={risk.trend} />
            </div>
          </div>
        </Card>

        <div className='grid gap-4 lg:grid-cols-3'>
          <div className='min-w-0 space-y-4 lg:col-span-2'>
            <Card className='gap-4'>
              <PanelHeader icon={Activity} title='Hazards' />
              <CardContent>
                <RiskPicture domains={risk.domains} />
              </CardContent>
            </Card>

            <Card className='gap-4'>
              <PanelHeader
                icon={ChartLine}
                title='Hazard index'
                aside='Last 14 days'
              />
              <CardContent>
                {historyQuery.data ? (
                  <HazardIndexChart points={historyQuery.data} />
                ) : (
                  <Skeleton className='h-[240px] w-full' />
                )}
              </CardContent>
            </Card>

            <Card className='gap-4'>
              <PanelHeader
                icon={CloudSun}
                title='Weather'
                aside='Last 24 hours'
              />
              <CardContent>
                {timelineQuery.data ? (
                  <ConditionsChart points={timelineQuery.data} />
                ) : (
                  <Skeleton className='h-[160px] w-full' />
                )}
              </CardContent>
            </Card>
          </div>

          <div className='space-y-4'>
            <Card className='gap-4'>
              <PanelHeader icon={Scale} title='Score drivers' />
              <CardContent className='space-y-3'>
                <ul className='space-y-3'>
                  {risk.reasons.map((reason) => (
                    <li key={reason.domain}>
                      <div className='mb-1 flex items-center justify-between gap-2 text-sm'>
                        <span className='font-medium'>{reason.label}</span>
                        <span className='text-xs text-muted-foreground tabular-nums'>
                          {Math.round(reason.contribution * 100)}%
                        </span>
                      </div>
                      <div
                        className='h-2 w-full overflow-hidden rounded-full bg-muted'
                        title={reason.detail}
                      >
                        <div
                          className='h-full rounded-full bg-foreground/70'
                          style={{ width: `${reason.contribution * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                <p
                  className='text-[11px] text-muted-foreground'
                  title={risk.backtest}
                >
                  {risk.modelVersion}
                </p>
              </CardContent>
            </Card>

            <Card className='gap-4'>
              <PanelHeader
                icon={Siren}
                title='Alerts'
                aside={alerts.length ? alerts.length : undefined}
              />
              <CardContent>
                {alerts.length === 0 ? (
                  <div className='rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground'>
                    No active alerts
                  </div>
                ) : (
                  <div className='divide-y'>
                    {alerts.map((alert) => (
                      <AlertItem
                        key={alert.id}
                        alert={alert}
                        showAction
                        className='first:pt-0 last:pb-0'
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className='gap-4'>
              <PanelHeader icon={MapIcon} title='Map' />
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
                  height='h-[280px]'
                  interactive={false}
                  showRiskLegend={false}
                />
              </CardContent>
            </Card>

            <Card className='gap-4'>
              <PanelHeader
                icon={Pin}
                title='Crew reports'
                aside={
                  <Button
                    asChild
                    size='sm'
                    variant='ghost'
                    className='h-7 px-2 text-xs'
                  >
                    <Link to='/hazards/new' search={{ site: site.id }}>
                      Add
                    </Link>
                  </Button>
                }
              />
              <CardContent>
                <ReportList
                  reports={reportsQuery.data}
                  isLoading={reportsQuery.isLoading}
                  emptyMessage='No reports'
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
