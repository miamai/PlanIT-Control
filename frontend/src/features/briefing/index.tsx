import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getBriefing, listBriefings } from '@/api'
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Clock3,
  Eye,
  Flame,
  History,
  MessageSquareText,
  PawPrint,
  Radar,
  Sparkles,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Waves,
  Zap,
} from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { useLiveStore } from '@/stores/live-store'
import {
  formatCountdownTo,
  RECOMMENDATION_HEX,
  RISK_BANDS,
  recommendationFromScore,
} from '@/lib/planit'
import { useSiteBundles } from '@/hooks/use-planit'
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

const WATCH_ICON: Record<string, typeof Zap> = {
  Lightning: Zap,
  'Flood & river': Waves,
  'Extreme heat': Thermometer,
  'Wildfire smoke': Flame,
  Wildlife: PawPrint,
}

/** Leading site count from a watchlist line such as "3 site(s) inside ...". */
function siteCount(detail: string): number | undefined {
  const match = /^(\d+)\s+site/.exec(detail)
  return match ? Number(match[1]) : undefined
}

/** Today (hollow) and tomorrow (filled) on one 0-10 track with the risk bands. */
function ScoreShift({ today, tomorrow }: { today: number; tomorrow: number }) {
  const left = Math.min(today, tomorrow) * 10
  const right = Math.max(today, tomorrow) * 10
  return (
    <div className='relative h-4'>
      <div className='absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 overflow-hidden rounded-full'>
        {RISK_BANDS.map((band) => (
          <span
            key={band.recommendation}
            className='h-full'
            style={{
              width: `${(band.to - band.from) * 10}%`,
              background: RECOMMENDATION_HEX[band.recommendation],
              opacity: 0.2,
            }}
          />
        ))}
      </div>
      <span
        className='absolute top-1/2 h-0.5 -translate-y-1/2 bg-foreground/40'
        style={{ left: `${left}%`, width: `${right - left}%` }}
      />
      <span
        className='absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background'
        style={{
          left: `${today * 10}%`,
          borderColor: RECOMMENDATION_HEX[recommendationFromScore(today)],
        }}
        title={`Today ${today.toFixed(1)}`}
      />
      <span
        className='absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background'
        style={{
          left: `${tomorrow * 10}%`,
          background: RECOMMENDATION_HEX[recommendationFromScore(tomorrow)],
        }}
        title={`Tomorrow ${tomorrow.toFixed(1)}`}
      />
    </div>
  )
}

export function BriefingPage() {
  const bundles = useSiteBundles()
  const now = useLiveStore((state) => state.now)

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

  const todayBySite = useMemo(() => {
    const map = new Map<string, number>()
    for (const bundle of bundles) map.set(bundle.site.id, bundle.risk.score)
    return map
  }, [bundles])

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading title='Briefing' />

        <div className='grid gap-4 lg:grid-cols-3'>
          <div className='min-w-0 space-y-4 lg:col-span-2'>
            {currentQuery.isLoading || !briefing ? (
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
                    title={format(parseISO(briefing.shiftDate), 'EEEE, MMMM d')}
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
                          Sends 18:00 ·{' '}
                          {formatCountdownTo(briefing.sendAt, now)}
                        </span>
                      </>
                    }
                  />
                  <CardContent className='space-y-2'>
                    <p className='text-lg font-semibold'>{briefing.headline}</p>
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
                      <span>Forecast risk · {briefing.sites.length} sites</span>
                    }
                    className='flex-wrap gap-y-2 px-4'
                  />
                  <CardContent className='space-y-4 px-4'>
                    <RiskLegend desktopOnly className='border-b pb-3' />
                    <ol className='divide-y'>
                      {[...briefing.sites]
                        .sort((a, b) => b.score - a.score)
                        .map((entry, index) => {
                          const site = SITE_SEED.find(
                            (s) => s.id === entry.siteId
                          )
                          const [primaryAction, ...otherActions] = entry.actions
                          return (
                            <li
                              key={entry.siteId}
                              className='space-y-3 py-5 first:pt-0 last:pb-0'
                            >
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
                                      {site?.name ?? entry.siteId}
                                    </Link>
                                  </h3>
                                  {site ? (
                                    <p className='text-xs leading-5 text-muted-foreground'>
                                      {site.county} County, {site.state}
                                    </p>
                                  ) : null}
                                </div>
                                <div className='col-start-2 flex items-center gap-3 sm:col-start-3 sm:row-start-1'>
                                  <ScoreBar
                                    score={entry.score}
                                    className='w-24 shrink-0'
                                  />
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
                                      <span className='sr-only'>
                                        Primary safety action:{' '}
                                      </span>
                                      {primaryAction}
                                    </p>
                                  </div>
                                ) : null}
                                {otherActions.length > 0 ? (
                                  <details className='group ps-6'>
                                    <summary className='flex min-h-9 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11 [&::-webkit-details-marker]:hidden'>
                                      <ChevronDown
                                        className='size-3.5 transition-transform group-open:rotate-180'
                                        aria-hidden
                                      />
                                      <span className='group-open:hidden'>
                                        {otherActions.length} more safety{' '}
                                        {otherActions.length === 1
                                          ? 'action'
                                          : 'actions'}
                                      </span>
                                      <span className='hidden group-open:inline'>
                                        Hide additional actions
                                      </span>
                                      <span className='sr-only'>
                                        {' '}
                                        for {site?.name ?? entry.siteId}
                                      </span>
                                    </summary>
                                    <ul className='list-disc space-y-2 ps-4 pt-1 pb-1 text-sm leading-relaxed marker:text-muted-foreground'>
                                      {otherActions.map((action) => (
                                        <li
                                          key={action}
                                          className='ps-1 break-words'
                                        >
                                          {action}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                ) : null}
                              </div>
                            </li>
                          )
                        })}
                    </ol>
                  </CardContent>
                </Card>

                <Card className='gap-4'>
                  <PanelHeader icon={Eye} title='Watchlist' />
                  <CardContent>
                    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5'>
                      {briefing.watchlist.map((item) => {
                        const Icon = WATCH_ICON[item.label] ?? Eye
                        const count = siteCount(item.detail)
                        return (
                          <div
                            key={item.label}
                            className='rounded-lg border p-3'
                          >
                            <div className='min-w-0'>
                              <p className='flex items-center gap-1.5 truncate text-xs text-muted-foreground'>
                                <Icon className='size-3.5 shrink-0' />
                                {item.label}
                              </p>
                              <p
                                className='text-lg leading-tight font-semibold tabular-nums'
                                title={item.detail}
                              >
                                {count ?? '—'}
                                <span className='ms-1 text-xs font-normal text-muted-foreground'>
                                  site{count === 1 ? '' : 's'}
                                </span>
                              </p>
                            </div>
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
            <Card className='gap-4'>
              <PanelHeader title='Today → tomorrow' />
              <CardContent className='space-y-4'>
                {briefing?.sites.map((entry) => {
                  const today = todayBySite.get(entry.siteId) ?? entry.score
                  const delta = entry.score - today
                  const DeltaIcon = delta >= 0 ? TrendingUp : TrendingDown
                  return (
                    <Link
                      key={entry.siteId}
                      to='/sites/$siteId'
                      params={{ siteId: entry.siteId }}
                      className='-mx-2 block space-y-1.5 rounded-md px-2 py-1 hover:bg-accent'
                    >
                      <div className='flex items-center justify-between gap-2 text-sm'>
                        <span className='truncate font-medium'>
                          {SITE_SEED.find((s) => s.id === entry.siteId)?.name ??
                            entry.siteId}
                        </span>
                        <span className='flex shrink-0 items-center gap-1 text-xs tabular-nums'>
                          <span className='text-muted-foreground'>
                            {today.toFixed(1)}
                          </span>
                          <ArrowRight className='size-3 text-muted-foreground' />
                          <span className='font-semibold'>
                            {entry.score.toFixed(1)}
                          </span>
                          {Math.abs(delta) >= 0.05 ? (
                            <DeltaIcon className='size-3.5 text-muted-foreground' />
                          ) : null}
                        </span>
                      </div>
                      <ScoreShift today={today} tomorrow={entry.score} />
                    </Link>
                  )
                })}
                <div className='flex items-center gap-4 border-t pt-3 text-[11px] text-muted-foreground'>
                  <span className='flex items-center gap-1.5'>
                    <span className='size-2.5 rounded-full border-2 border-foreground/50' />
                    Today
                  </span>
                  <span className='flex items-center gap-1.5'>
                    <span className='size-2.5 rounded-full bg-foreground/60' />
                    Tomorrow
                  </span>
                </div>
              </CardContent>
            </Card>

            {briefing ? (
              <Card className='gap-4'>
                <PanelHeader icon={MessageSquareText} title='SMS' />
                <CardContent>
                  <div className='rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed'>
                    {briefing.smsPreview}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card className='gap-4'>
              <PanelHeader icon={History} title='Previous' />
              <CardContent>
                <ul className='divide-y'>
                  {history.map((entry) => {
                    const noGo = entry.sites.filter(
                      (s) => s.recommendation === 'NO-GO'
                    ).length
                    return (
                      <li
                        key={entry.id}
                        className='flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0'
                      >
                        <span>
                          {format(parseISO(entry.shiftDate), 'EEE, MMM d')}
                        </span>
                        <span className='text-xs text-muted-foreground'>
                          {noGo > 0 ? (
                            <span className='inline-flex items-baseline gap-1'>
                              {noGo}{' '}
                              <RecommendationStatus recommendation='NO-GO' />
                            </span>
                          ) : (
                            'No stand-downs'
                          )}{' '}
                          · {entry.sites.length} flagged
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
