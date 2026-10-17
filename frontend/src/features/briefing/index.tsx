import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getBriefing, listBriefings } from '@/api'
import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
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
  RECOMMENDATION_BG,
  RECOMMENDATION_HEX,
  RISK_BANDS,
  recommendationFromScore,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useSiteBundles } from '@/hooks/use-planit'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { PageHeading } from '@/components/planit/page-heading'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'
import { RecommendationBadge } from '@/components/planit/risk-badge'
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

                <Card className='gap-4'>
                  <PanelHeader icon={Radar} title='Flagged sites' />
                  <CardContent>
                    <ol className='divide-y'>
                      {briefing.sites.map((entry, index) => {
                        const site = SITE_SEED.find(
                          (s) => s.id === entry.siteId
                        )
                        return (
                          <li
                            key={entry.siteId}
                            className='flex gap-3 py-4 first:pt-0 last:pb-0'
                          >
                            <span
                              className={cn(
                                'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white',
                                RECOMMENDATION_BG[entry.recommendation]
                              )}
                            >
                              {index + 1}
                            </span>
                            <div className='min-w-0 flex-1 space-y-2'>
                              <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
                                <div className='min-w-0'>
                                  <Link
                                    to='/sites/$siteId'
                                    params={{ siteId: entry.siteId }}
                                    className='font-medium hover:underline'
                                  >
                                    {site?.name ?? entry.siteId}
                                  </Link>
                                  {site ? (
                                    <span className='text-sm text-muted-foreground'>
                                      {' '}
                                      · {site.county} County, {site.state}
                                    </span>
                                  ) : null}
                                  <p className='text-xs text-muted-foreground'>
                                    {entry.headline}
                                  </p>
                                </div>
                                <div className='flex items-center gap-2'>
                                  <ScoreBar
                                    score={entry.score}
                                    className='w-28'
                                  />
                                  <RecommendationBadge
                                    recommendation={entry.recommendation}
                                    className='w-[76px] justify-center'
                                  />
                                </div>
                              </div>
                              <ul className='space-y-1'>
                                {entry.actions.map((action) => (
                                  <li
                                    key={action}
                                    className='flex items-start gap-2 text-sm'
                                  >
                                    <CircleCheck className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
                                    {action}
                                  </li>
                                ))}
                              </ul>
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
                            <DeltaIcon
                              className={cn(
                                'size-3.5',
                                delta > 0 ? 'text-red-600' : 'text-emerald-600'
                              )}
                            />
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
                            <span className='font-medium text-red-600 dark:text-red-400'>
                              {noGo} NO-GO
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
