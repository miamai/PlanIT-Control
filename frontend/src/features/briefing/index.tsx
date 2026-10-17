import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { Link } from '@tanstack/react-router'
import {
  CalendarDays,
  ChevronDown,
  Clock3,
  Eye,
  History,
  Info,
  Radar,
  Sparkles,
} from 'lucide-react'
import { type BriefingSite } from '@/api/types'
import { ALERT_TYPE_ICON, formatDateTime } from '@/lib/planit'
import { useFleetBriefing, useSiteBundles } from '@/hooks/use-planit'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { PageHeading } from '@/components/planit/page-heading'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'
import {
  RecommendationStatus,
  RiskLegend,
} from '@/components/planit/risk-status'
import { ScoreBar } from '@/components/planit/score-bar'

const MAX_FLAGGED = 20
const FALLBACK_FLAGGED = 10

export function BriefingPage() {
  const { briefing, history, isLoading, isEmpty } = useFleetBriefing()
  const { bundles } = useSiteBundles()

  const siteById = useMemo(
    () => new Map(bundles.map((bundle) => [bundle.site.id, bundle])),
    [bundles]
  )

  /** Sites that need attention: a CAUTION/NO-GO call or an active alert. */
  const flagged = useMemo(() => {
    if (!briefing) return []
    const attention = briefing.sites.filter(
      (entry) =>
        (entry.recommendation !== null && entry.recommendation !== 'GO') ||
        (siteById.get(entry.siteId)?.alerts.length ?? 0) > 0
    )
    return (
      attention.length > 0
        ? attention
        : briefing.sites.slice(0, FALLBACK_FLAGGED)
    ).slice(0, MAX_FLAGGED)
  }, [briefing, siteById])

  const scored = briefing?.sites.filter((s) => s.score !== null).length ?? 0
  const gemini =
    briefing?.sites.filter((s) => s.generator === 'gemini').length ?? 0

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading title='Briefing' />

        {isEmpty ? (
          <Card>
            <CardContent className='p-10 text-center'>
              <p className='text-lg font-medium'>No briefings yet</p>
              <p className='text-sm text-muted-foreground'>
                The worker stores next-day briefings after 18:00 in each
                site&apos;s local time.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className='grid gap-4 lg:grid-cols-3'>
            <div className='min-w-0 space-y-4 lg:col-span-2'>
              {isLoading || !briefing ? (
                <Card>
                  <CardContent className='space-y-3'>
                    <Skeleton className='h-6 w-2/3' />
                    <Skeleton className='h-4 w-full' />
                    <Skeleton className='h-4 w-5/6' />
                    <Skeleton className='h-40 w-full' />
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Card className='gap-4'>
                    <PanelHeader
                      icon={CalendarDays}
                      title={format(
                        parseISO(briefing.shiftDate),
                        'EEEE, MMMM d'
                      )}
                      className='flex-col items-start gap-3 sm:flex-row sm:items-center'
                      aside={
                        <>
                          <Badge variant='outline' className='gap-1'>
                            <Sparkles className='size-3 text-violet-500' />
                            {briefing.generator === 'gemini'
                              ? 'Gemini'
                              : 'Template'}
                          </Badge>
                          <span className='tabular-nums'>
                            Generated {formatDateTime(briefing.generatedAt)}
                          </span>
                        </>
                      }
                    />
                    <CardContent className='space-y-2'>
                      <p className='text-lg font-semibold'>
                        {briefing.headline}
                      </p>
                      <p className='text-sm leading-relaxed text-muted-foreground'>
                        {briefing.summary}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className='gap-4 py-4 shadow-none'>
                    <PanelHeader
                      icon={Radar}
                      title='Flagged sites'
                      aside={
                        <span>
                          {flagged.length} of {briefing.sites.length} sites
                        </span>
                      }
                      className='flex-wrap gap-y-2 px-4'
                    />
                    <CardContent className='space-y-4 px-4'>
                      <RiskLegend desktopOnly className='border-b pb-3' />
                      <ol className='divide-y'>
                        {flagged.map((entry, index) => {
                          const site = siteById.get(entry.siteId)?.site
                          return (
                            <FlaggedSite
                              key={entry.siteId}
                              entry={entry}
                              index={index}
                              name={site?.name}
                              location={
                                site
                                  ? `${site.county} County, ${site.state}`
                                  : undefined
                              }
                            />
                          )
                        })}
                      </ol>
                    </CardContent>
                  </Card>

                  <Card className='gap-4'>
                    <PanelHeader
                      icon={Eye}
                      title='Watchlist'
                      aside='Active alerts'
                    />
                    <CardContent>
                      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5'>
                        {briefing.watchlist.map((item) => {
                          const Icon = ALERT_TYPE_ICON[item.type]
                          return (
                            <div
                              key={item.type}
                              className='rounded-lg border p-3'
                              title={item.detail}
                            >
                              <p className='flex items-center gap-1.5 truncate text-xs text-muted-foreground'>
                                <Icon className='size-3.5 shrink-0' />
                                {item.label}
                              </p>
                              <p className='text-lg leading-tight font-semibold tabular-nums'>
                                {item.count}
                                <span className='ms-1 text-xs font-normal text-muted-foreground'>
                                  site{item.count === 1 ? '' : 's'}
                                </span>
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>

            <div className='space-y-4'>
              {briefing ? (
                <Card className='gap-4'>
                  <PanelHeader icon={Info} title='Coverage' />
                  <CardContent>
                    <dl className='divide-y text-sm'>
                      {[
                        ['Site briefings', briefing.sites.length],
                        ['With a model hazard index', scored],
                        [
                          'Deterministic template only',
                          briefing.sites.length - scored,
                        ],
                        ['Gemini narratives', gemini],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className='flex items-center justify-between py-2 first:pt-0 last:pb-0'
                        >
                          <dt className='text-muted-foreground'>{label}</dt>
                          <dd className='font-medium tabular-nums'>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </CardContent>
                </Card>
              ) : null}

              <Card className='gap-4'>
                <PanelHeader icon={History} title='Previous' />
                <CardContent>
                  {history.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      No earlier briefings in the last 14 days.
                    </p>
                  ) : (
                    <ul className='divide-y'>
                      {history.map((entry) => (
                        <li
                          key={entry.shiftDate}
                          className='flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0'
                        >
                          <span>
                            {format(parseISO(entry.shiftDate), 'EEE, MMM d')}
                          </span>
                          <span className='text-xs text-muted-foreground'>
                            {entry.sites} site{entry.sites === 1 ? '' : 's'}
                            {entry.withAlerts > 0
                              ? ` · ${entry.withAlerts} with alerts`
                              : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </Main>
    </>
  )
}

function FlaggedSite({
  entry,
  index,
  name,
  location,
}: {
  entry: BriefingSite
  index: number
  name?: string
  location?: string
}) {
  const [primaryAction, ...otherActions] = entry.actions
  const extraSummary =
    entry.summary.length > entry.headline.length
      ? entry.summary.slice(entry.headline.length).trim()
      : ''
  const hasMore = otherActions.length > 0 || extraSummary.length > 0

  return (
    <li className='space-y-3 py-5 first:pt-0 last:pb-0'>
      <div className='grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[2rem_minmax(0,1fr)_auto]'>
        <span className='flex size-8 shrink-0 items-center justify-center self-start rounded-lg bg-muted text-xs font-medium text-muted-foreground tabular-nums'>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className='min-w-0 space-y-0.5'>
          <h3 className='text-sm leading-5 font-semibold'>
            <Link
              to='/sites/$siteId'
              params={{ siteId: entry.siteId }}
              className='rounded-sm break-words hover:underline focus-visible:outline-2 focus-visible:outline-ring'
            >
              {name ?? entry.siteId}
            </Link>
          </h3>
          {location ? (
            <p className='text-xs leading-5 text-muted-foreground'>
              {location}
            </p>
          ) : null}
        </div>
        <div className='col-start-2 flex items-center gap-3 sm:col-start-3 sm:row-start-1'>
          <ScoreBar score={entry.score} className='w-24 shrink-0' />
          <RecommendationStatus
            withDesktopLegend
            recommendation={entry.recommendation}
            className='w-[72px] justify-end'
          />
        </div>
      </div>
      <div className='space-y-2 sm:ps-11'>
        <div className='flex items-start gap-2'>
          <Radar
            className='mt-0.5 size-4 shrink-0 text-muted-foreground'
            aria-hidden
          />
          <p className='text-sm leading-relaxed break-words text-muted-foreground'>
            {entry.headline}
          </p>
        </div>
        {primaryAction ? (
          <div className='flex items-start gap-2'>
            <Clock3
              className='mt-0.5 size-4 shrink-0 text-muted-foreground'
              aria-hidden
            />
            <p className='text-sm leading-relaxed break-words'>
              <span className='sr-only'>Primary safety action: </span>
              {primaryAction}
            </p>
          </div>
        ) : null}
        {hasMore ? (
          <details className='group ps-6'>
            <summary className='flex min-h-9 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11 [&::-webkit-details-marker]:hidden'>
              <ChevronDown
                className='size-3.5 transition-transform group-open:rotate-180'
                aria-hidden
              />
              <span className='group-open:hidden'>Full briefing</span>
              <span className='hidden group-open:inline'>Hide briefing</span>
              <span className='sr-only'> for {name ?? entry.siteId}</span>
            </summary>
            {extraSummary ? (
              <p className='pt-1 text-sm leading-relaxed break-words'>
                {extraSummary}
              </p>
            ) : null}
            {otherActions.length > 0 ? (
              <ul className='list-disc space-y-2 ps-4 pt-1 pb-1 text-sm leading-relaxed marker:text-muted-foreground'>
                {otherActions.map((action) => (
                  <li key={action} className='ps-1 break-words'>
                    {action}
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        ) : null}
      </div>
    </li>
  )
}
