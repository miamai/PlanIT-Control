import { useMemo } from 'react'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getBriefing, listRecentHazardReports } from '@/api'
import { MapPinned, RadioTower, Sparkles, TriangleAlert } from 'lucide-react'
import { useLiveStore } from '@/stores/live-store'
import {
  useActiveAlerts,
  useLiveStrikes,
  useSiteBundles,
  useSimulateStrike,
} from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { AlertsFeed } from '@/components/planit/alerts-feed'
import { CardActions } from '@/components/planit/card-actions'
import { PlanitHeader } from '@/components/planit/planit-header'
import { SiteMap } from '@/components/planit/site-map'
import { BriefingPreview } from './components/briefing-preview'
import { RecentReports } from './components/recent-reports'
import { RiskRankedTable } from './components/risk-ranked-table'
import { SummaryCards, type Summary } from './components/summary-cards'

export function Dashboard() {
  const bundles = useSiteBundles()
  const alerts = useActiveAlerts()
  const simulateStrike = useSimulateStrike()
  const strikes = useLiveStrikes()
  const now = useLiveStore((state) => state.now)

  const briefingQuery = useQuery({
    queryKey: ['briefing', format(now, 'yyyy-MM-dd-HH')],
    queryFn: () => getBriefing(),
    staleTime: 60_000,
  })
  const reportsQuery = useQuery({
    queryKey: ['hazard-reports', 'recent'],
    queryFn: () => listRecentHazardReports(6),
    staleTime: 30_000,
  })

  const ranked = useMemo(
    () => [...bundles].sort((a, b) => b.risk.score - a.risk.score),
    [bundles]
  )

  const reportSiteIds = useMemo(
    () => new Set((reportsQuery.data ?? []).map((r) => r.siteId)),
    [reportsQuery.data]
  )

  const summary: Summary = useMemo(() => {
    const reports = reportsQuery.data ?? []
    const dayAgo = now - 24 * 60 * 60 * 1000
    return {
      sites: bundles.length,
      noGo: bundles.filter((b) => b.risk.recommendation === 'NO-GO').length,
      caution: bundles.filter((b) => b.risk.recommendation === 'CAUTION')
        .length,
      go: bundles.filter((b) => b.risk.recommendation === 'GO').length,
      activeAlerts: alerts.length,
      lightningAlerts: alerts.filter((a) => a.type === 'lightning').length,
      crewReports24h: reports.filter(
        (r) => new Date(r.createdAt).getTime() >= dayAgo
      ).length,
      avgScore:
        Math.round(
          (bundles.reduce((sum, b) => sum + b.risk.score, 0) /
            (bundles.length || 1)) *
            10
        ) / 10,
    }
  }, [bundles, alerts, reportsQuery.data, now])

  return (
    <>
      <PlanitHeader
        active='dashboard'
        actions={
          <Button asChild size='sm' className='hidden sm:inline-flex'>
            <Link to='/hazards/new'>
              <TriangleAlert /> Report hazard
            </Link>
          </Button>
        }
      />
      <Main>
        <div className='mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <div className='space-y-1'>
            <h1 className='text-2xl font-bold tracking-tight'>
              Supervisor PlanIT Dashboard
            </h1>
            <p className='text-sm text-muted-foreground'>
              {format(now, 'EEEE, MMMM d, yyyy')} · fused environmental risk for{' '}
              {summary.sites} live job sites · hazard index refreshed every 20s
            </p>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => simulateStrike()}
            >
              <RadioTower /> Simulate lightning
            </Button>
            <Button asChild size='sm' variant='outline'>
              <Link to='/briefing'>
                <Sparkles /> Tonight's briefing
              </Link>
            </Button>
            <Button asChild size='sm' className='sm:hidden'>
              <Link to='/hazards/new'>
                <TriangleAlert /> Report hazard
              </Link>
            </Button>
          </div>
        </div>

        <SummaryCards summary={summary} />

        <div className='mt-4 grid gap-4 lg:grid-cols-3'>
          <Card className='lg:col-span-2'>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <MapPinned className='size-4 text-muted-foreground' />
                Sites ranked by hazard index
              </CardTitle>
              <CardActions to='/sites' label='All sites' />
            </CardHeader>
            <CardContent>
              <SiteMap
                markers={bundles.map((bundle) => ({
                  site: bundle.site,
                  score: bundle.risk.score,
                  activeLightning: bundle.conditions.lightningActive,
                  hasReports: reportSiteIds.has(bundle.site.id),
                }))}
                strikes={strikes}
                height='h-[440px]'
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <TriangleAlert className='size-4 text-muted-foreground' />
                Active alerts
              </CardTitle>
              <CardActions to='/alerts' />
            </CardHeader>
            <CardContent>
              <AlertsFeed
                alerts={alerts}
                limit={5}
                scrollable
                onSimulate={simulateStrike}
              />
            </CardContent>
          </Card>
        </div>

        <div className='mt-4 grid gap-4 lg:grid-cols-3'>
          <Card className='lg:col-span-2'>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
              <CardTitle className='text-base'>
                Top 10 exposure — where to focus first
              </CardTitle>
              <CardActions to='/sites' label='Full ranking' />
            </CardHeader>
            <CardContent>
              <RiskRankedTable items={ranked} limit={10} />
            </CardContent>
          </Card>

          <div className='space-y-4'>
            <BriefingPreview
              briefing={briefingQuery.data}
              isLoading={briefingQuery.isLoading}
            />
            <RecentReports
              reports={reportsQuery.data}
              isLoading={reportsQuery.isLoading}
            />
          </div>
        </div>
      </Main>
    </>
  )
}
