import { format, parseISO } from 'date-fns'
import { Link } from '@tanstack/react-router'
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  ShieldAlert,
} from 'lucide-react'
import { type Alert, type BriefingSite, type Site } from '@/api/types'
import { formatDateTime } from '@/lib/planit'
import {
  useFleetBriefing,
  useSiteBundles,
  type SiteBundle,
} from '@/hooks/use-planit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { AlertControls } from '@/components/planit/alert-controls'
import { PageHeading } from '@/components/planit/page-heading'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'
import { RecommendationStatus } from '@/components/planit/risk-status'
import { ScoreBar } from '@/components/planit/score-bar'

const CALLS = ['NO-GO', 'CAUTION', 'GO'] as const

export function BriefingPage() {
  const { briefing, isLoading, isEmpty, isError, refresh } = useFleetBriefing()
  const fleet = useSiteBundles()
  const siteById = new Map(
    fleet.bundles.map((bundle) => [bundle.site.id, bundle.site])
  )
  const restrictions = fleet.bundles
    .map((bundle) => ({
      bundle,
      alerts: bundle.alerts.filter(
        (alert) =>
          alert.status !== 'resolved' && alert.actionCode === 'STOP_WORK'
      ),
    }))
    .filter(({ alerts }) => alerts.length > 0)
  const restrictedSiteIds = new Set(
    restrictions.map(({ bundle }) => bundle.site.id)
  )
  const sites = briefing?.sites ?? []
  const prioritySites = sites.filter(
    (entry) =>
      (entry.recommendation !== null && entry.recommendation !== 'GO') ||
      restrictedSiteIds.has(entry.siteId) ||
      entry.reasons.length > 0 ||
      entry.actions.length > 0
  )
  const hasDemo = sites.some((entry) => entry.scoreKind === 'demo')
  const modelVersions = [
    ...new Set(
      sites
        .filter((entry) => entry.scoreKind === 'model')
        .map((entry) => entry.modelVersion)
        .filter(Boolean)
    ),
  ]

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading title='Briefing' />

        <Card className='mb-4 gap-3 py-4'>
          <PanelHeader
            icon={ShieldAlert}
            title='Current work restrictions'
            aside='Live conditions'
            className='flex-wrap'
          />
          <CardContent className='space-y-2'>
            {fleet.isError ? (
              <p role='alert' className='text-sm text-destructive'>
                Current alerts could not be loaded. Check Alerts before planning
                work.
              </p>
            ) : fleet.isLoading ? (
              <Skeleton className='h-20 w-full' />
            ) : restrictions.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                No current stop-work restrictions reported.
              </p>
            ) : (
              <ul className='divide-y'>
                {restrictions.map(({ bundle, alerts }) => (
                  <CurrentPriority
                    key={bundle.site.id}
                    bundle={bundle}
                    alerts={alerts}
                  />
                ))}
              </ul>
            )}
            <Link
              to='/alerts'
              className='inline-block text-xs font-medium underline underline-offset-4'
            >
              View alerts
            </Link>
          </CardContent>
        </Card>

        <div className='space-y-4'>
          {isError ? (
            <Card>
              <CardContent className='space-y-3'>
                <p role='alert'>Could not load saved briefings.</p>
                <Button variant='outline' onClick={() => void refresh()}>
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Card>
              <CardContent className='space-y-4'>
                <Skeleton className='h-6 w-2/3' />
                <Skeleton className='h-32 w-full' />
              </CardContent>
            </Card>
          ) : isEmpty || !briefing ? (
            <Card>
              <CardContent>
                <p className='font-medium'>No saved briefings for this shift</p>
                <p className='mt-2 text-sm text-muted-foreground'>
                  Briefings are scheduled after 18:00 at each site, for the
                  following local day.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className='gap-3 py-4'>
                <PanelHeader
                  icon={CalendarDays}
                  title={format(parseISO(briefing.shiftDate), 'EEEE, MMMM d')}
                  aside={
                    <div className='flex flex-wrap gap-2'>
                      <Badge variant='outline'>Next-day forecast</Badge>
                      {hasDemo ? (
                        <Badge variant='secondary'>Sample scenario</Badge>
                      ) : null}
                    </div>
                  }
                  className='flex-wrap'
                />
                <CardContent>
                  <div className='flex flex-wrap gap-x-6 gap-y-3'>
                    {CALLS.map((call) => (
                      <span
                        key={call}
                        className='inline-flex items-center gap-2'
                      >
                        <span className='text-xl font-semibold tabular-nums'>
                          {
                            sites.filter((site) => site.recommendation === call)
                              .length
                          }
                        </span>
                        <RecommendationStatus
                          recommendation={call}
                          className='text-sm'
                        />
                      </span>
                    ))}
                  </div>
                  {sites.every((entry) => entry.score === null) ? (
                    <p className='mt-3 text-sm text-muted-foreground'>
                      No dated risk forecast is available for this shift.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card className='gap-4'>
                <PanelHeader
                  icon={ClipboardList}
                  title='Site forecasts & actions'
                  aside='Highest risk first'
                  className='flex-wrap'
                />
                <CardContent>
                  {prioritySites.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      No priority-site forecasts are available in this briefing.
                    </p>
                  ) : (
                    <ol className='divide-y'>
                      {prioritySites.map((entry, index) => (
                        <SiteForecast
                          key={entry.siteId}
                          entry={entry}
                          index={index}
                          site={siteById.get(entry.siteId)}
                        />
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>

              <details className='group text-xs leading-5 text-muted-foreground'>
                <summary className='flex min-h-9 w-fit cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden'>
                  <ChevronDown className='size-3.5 transition-transform group-open:rotate-180' />
                  Data sources
                </summary>
                <div className='mt-2 space-y-2 rounded-lg border p-4'>
                  {hasDemo ? (
                    <p>
                      Sample scenario: illustrative scores for a hackathon
                      demonstration, not live weather or validated ML
                      predictions.
                    </p>
                  ) : null}
                  {sites.some((entry) => entry.scoreKind === 'model') ? (
                    <p>
                      ML source: as reported by the API. This label does not
                      verify model quality. Model versions:{' '}
                      {modelVersions.join(', ') || 'not supplied'}.
                    </p>
                  ) : null}
                  {sites.some((entry) => entry.scoreKind === 'unverified') ? (
                    <p>Some scores have an unspecified source.</p>
                  ) : null}
                  <p>
                    Only scores dated {briefing.shiftDate} are included. Sites
                    without a dated score are not counted as GO. Risk reasons
                    and actions appear only when supplied; work periods use site
                    local time. Stale or incomplete work periods are omitted.
                  </p>
                  <p>
                    Updated {formatDateTime(briefing.generatedAt)} (your time).
                  </p>
                  {restrictions.flatMap(({ bundle, alerts }) =>
                    alerts.map((alert) => (
                      <p key={alert.id} className='break-all'>
                        {bundle.site.name} alert source:{' '}
                        {alert.isDemo ? 'Sample scenario · ' : ''}
                        {alert.sourceReference || 'not supplied'}
                      </p>
                    ))
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      </Main>
    </>
  )
}

function CurrentPriority({
  bundle,
  alerts,
}: {
  bundle: SiteBundle
  alerts: Alert[]
}) {
  return (
    <li className='space-y-1 py-3 first:pt-0 last:pb-0'>
      <Link
        to='/sites/$siteId'
        params={{ siteId: bundle.site.id }}
        className='text-sm font-semibold hover:underline'
      >
        {bundle.site.name}
      </Link>
      <ul className='space-y-2 text-sm leading-6'>
        {alerts.map((alert) => (
          <li key={alert.id}>
            <div className='mb-1 flex flex-wrap items-center gap-2'>
              <Badge variant='destructive'>Stop work</Badge>
              {alert.status === 'all-clear' ? (
                <span className='text-xs text-muted-foreground'>
                  Status: all-clear eligible
                </span>
              ) : null}
              <span className='font-medium'>{alert.title}</span>
            </div>
            {alert.action ? (
              <p className='break-words'>{alert.action}</p>
            ) : null}
            <AlertControls alert={alert} />
          </li>
        ))}
      </ul>
    </li>
  )
}

function SiteForecast({
  entry,
  index,
  site,
}: {
  entry: BriefingSite
  index: number
  site?: Site
}) {
  const actions =
    entry.scoreKind === 'demo' || entry.riskStatus === 'stale'
      ? []
      : entry.actions.filter((action) => !action.includes('?'))
  return (
    <li className='space-y-3 py-4 first:pt-0 last:pb-0'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <Link
            to='/sites/$siteId'
            params={{ siteId: entry.siteId }}
            className='text-sm font-semibold hover:underline'
          >
            {String(index + 1).padStart(2, '0')} · {site?.name ?? entry.siteId}
          </Link>
          {site ? (
            <p className='mt-1 text-xs text-muted-foreground'>
              {site.county} County, {site.state}
            </p>
          ) : null}
        </div>
        {entry.score !== null ? (
          <div className='flex flex-wrap items-center gap-3'>
            <ScoreBar score={entry.score} className='w-24' />
            <RecommendationStatus recommendation={entry.recommendation} />
          </div>
        ) : null}
      </div>
      {entry.reasons.length > 0 ? (
        <div>
          <p className='mb-1 text-xs font-semibold text-muted-foreground'>
            Main hazards
          </p>
          <ul className='list-disc space-y-1 ps-4 text-sm leading-6'>
            {entry.reasons.slice(0, 3).map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {actions.length > 0 ? (
        <div className='rounded-lg bg-muted/40 p-3'>
          <p className='mb-1 text-xs font-semibold'>
            Actions & work windows · site local time
          </p>
          <ul className='list-disc space-y-1 ps-4 text-sm leading-6'>
            {actions.map((action, i) => (
              <li key={i}>{action}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  )
}
