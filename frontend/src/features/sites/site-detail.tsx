import { format, parseISO } from 'date-fns'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  CalendarClock,
  ChartLine,
  CloudSun,
  Map as MapIcon,
  Pin,
  Scale,
  Siren,
  TriangleAlert,
} from 'lucide-react'
import { useHazardReports, useSiteDetail } from '@/hooks/use-planit'
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
import { RiskPicture } from '@/components/planit/risk-picture'
import { TrendIndicator } from '@/components/planit/risk-status'
import { SiteMap } from '@/components/planit/site-map'
import { ConditionsChart } from './components/conditions-chart'
import { HazardIndexChart } from './components/hazard-index-chart'

export function SiteDetail({ siteId }: { siteId: string }) {
  const detail = useSiteDetail(siteId)
  const reportsQuery = useHazardReports(siteId)

  if (detail.isLoading) {
    return (
      <>
        <PlanitHeader />
        <Main>
          <Skeleton className='mb-4 h-48 w-full' />
          <div className='grid gap-4 lg:grid-cols-3'>
            <Skeleton className='h-96 w-full lg:col-span-2' />
            <Skeleton className='h-96 w-full' />
          </div>
        </Main>
      </>
    )
  }

  if (detail.notFound || !detail.site || !detail.risk) {
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

  const { site, risk, alerts, domains, strikes, timeline, history } = detail
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
                {site.utility} · {site.county} County, {site.state}
                {site.capacityMw !== undefined
                  ? ` · ${site.capacityMw.toLocaleString()} MW`
                  : ''}
              </p>
              <p className='text-xs text-muted-foreground tabular-nums'>
                {site.lat.toFixed(4)}, {site.lon.toFixed(4)} · EIA plant #
                {site.eiaPlantId}
                {risk.updatedAt
                  ? ` · scored ${format(risk.updatedAt, 'MMM d, HH:mm')}`
                  : ''}
              </p>
              <div className='flex flex-wrap gap-2 pt-2'>
                <Button asChild size='sm'>
                  <Link to='/hazards/new' search={{ site: site.id }}>
                    <TriangleAlert /> Report hazard
                  </Link>
                </Button>
              </div>
            </div>

            <div className='flex flex-col items-center gap-1 self-center'>
              <HazardGauge
                score={risk.score}
                recommendation={risk.recommendation}
                status={risk.status}
              />
              {risk.trend ? <TrendIndicator trend={risk.trend} /> : null}
              {risk.predictionDate ? (
                <span className='text-[11px] text-muted-foreground'>
                  Forecast ·{' '}
                  {format(parseISO(risk.predictionDate), 'EEE, MMM d')}
                  {risk.status === 'stale' ? ' · stale' : ''}
                </span>
              ) : null}
              {risk.decisionBasis[0] ? (
                <span className='max-w-64 text-center text-[11px] text-muted-foreground'>
                  {risk.decisionBasis[0]}. Environmental assessment only; work
                  authorization is not granted by this dashboard.
                </span>
              ) : null}
            </div>
          </div>
        </Card>

        <div className='grid gap-4 lg:grid-cols-3'>
          <div className='min-w-0 space-y-4 lg:col-span-2'>
            <Card className='gap-4'>
              <PanelHeader icon={Activity} title='Hazards' />
              <CardContent>
                <RiskPicture domains={domains} />
              </CardContent>
            </Card>

            <Card className='gap-4'>
              <PanelHeader
                icon={ChartLine}
                title='Hazard index'
                aside='Last 14 days'
              />
              <CardContent>
                {detail.historyError ? (
                  <p
                    role='alert'
                    className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'
                  >
                    Could not load historical scores. Please try refreshing this
                    page.
                  </p>
                ) : history ? (
                  history.length > 0 ? (
                    <>
                      <HazardIndexChart points={history} />
                    </>
                  ) : (
                    <div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
                      {site.mlSupported
                        ? 'No historical scores are available for the last 14 days. Forecasts are shown separately above.'
                        : 'Historical hazard scores are unavailable because this site is not covered by the hazard model.'}
                    </div>
                  )
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
                {timeline ? (
                  timeline.length > 0 ? (
                    <ConditionsChart points={timeline} />
                  ) : (
                    <div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
                      No weather observations stored in the last 24 hours.
                    </div>
                  )
                ) : (
                  <Skeleton className='h-[160px] w-full' />
                )}
              </CardContent>
            </Card>
          </div>

          <div className='min-w-0 space-y-4'>
            <Card className='gap-4'>
              <PanelHeader icon={Scale} title='Score drivers' />
              <CardContent className='space-y-3'>
                {risk.reasons.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>
                    {risk.score === null
                      ? 'No hazard index for this site.'
                      : 'Insufficient data: no valid score contribution explanation was reported for this prediction.'}
                  </p>
                ) : null}
                <ul className='space-y-3'>
                  {risk.reasons.map((reason) => (
                    <li key={reason.label}>
                      <div className='mb-1 flex items-center justify-between gap-2 text-sm'>
                        <span className='font-medium'>{reason.label}</span>
                        <span className='text-xs text-muted-foreground tabular-nums'>
                          +{reason.impact.toFixed(1)} sub-score
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
                {risk.modelVersion ? (
                  <p className='text-[11px] text-muted-foreground'>
                    {risk.modelVersion}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {risk.workPlan.length > 0 ? (
              <Card className='gap-4'>
                <PanelHeader icon={CalendarClock} title='Work plan' />
                <CardContent>
                  <ul className='list-disc space-y-1.5 ps-4 text-sm leading-relaxed marker:text-muted-foreground'>
                    {risk.workPlan.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

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
                      activeLightning: detail.lightningActive,
                    },
                  ]}
                  strikes={strikes}
                  reports={reportsQuery.reports ?? []}
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
                  reports={reportsQuery.reports}
                  isLoading={reportsQuery.isLoading}
                  emptyMessage={
                    reportsQuery.canView ? 'No reports' : 'Visible to admins'
                  }
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
