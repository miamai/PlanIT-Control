import { useMemo } from 'react'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { getBriefing, listRecentHazardReports } from '@/api'
import {
  ListOrdered,
  MapPinned,
  RadioTower,
  Siren,
  TriangleAlert,
} from 'lucide-react'
import { type Recommendation } from '@/api/types'
import { useLiveStore } from '@/stores/live-store'
import {
  useActiveAlerts,
  useLiveStrikes,
  useSiteBundles,
  useSimulateStrike,
} from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { AlertsFeed } from '@/components/planit/alerts-feed'
import { CardActions } from '@/components/planit/card-actions'
import { PageHeading } from '@/components/planit/page-heading'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'
import { RiskLegend } from '@/components/planit/risk-status'
import { SiteMap } from '@/components/planit/site-map'
import { BriefingPreview } from './components/briefing-preview'
import { PrioritySites } from './components/priority-sites'
import { RecentReports } from './components/recent-reports'
import { SummaryCards, type Summary } from './components/summary-cards'

const TOP_N = 10

export function Dashboard() {
  const bundles = useSiteBundles()
  const alerts = useActiveAlerts()
  const simulateStrike = useSimulateStrike()
  const strikes = useLiveStrikes()
  const now = useLiveStore((state) => state.now)
  const navigate = useNavigate()

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
    const calls: Record<Recommendation, number> = {
      GO: 0,
      CAUTION: 0,
      'NO-GO': 0,
    }
    for (const bundle of bundles) calls[bundle.risk.recommendation] += 1
    const lightning = alerts.filter((a) => a.type === 'lightning')
    return {
      sites: bundles.length,
      calls,
      activeAlerts: alerts.length,
      critical: alerts.filter((a) => a.severity === 'critical').length,
      warning: alerts.filter((a) => a.severity === 'warning').length,
      advisory: alerts.filter((a) => a.severity === 'info').length,
      lightningSites: new Set(lightning.map((a) => a.siteId)).size,
      avgScore:
        Math.round(
          (bundles.reduce((sum, b) => sum + b.risk.score, 0) /
            (bundles.length || 1)) *
            10
        ) / 10,
    }
  }, [bundles, alerts])

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading
          title='Dashboard'
          description={format(now, 'EEEE, MMMM d')}
          actions={
            <>
              <Button
                variant='outline'
                size='sm'
                onClick={() => simulateStrike()}
              >
                <RadioTower /> Simulate strike
              </Button>
              <Button asChild size='sm'>
                <Link to='/hazards/new'>
                  <TriangleAlert /> Report hazard
                </Link>
              </Button>
            </>
          }
        />

        <SummaryCards summary={summary} />

        <div className='mt-4 grid gap-4 lg:grid-cols-5'>
          <Card className='min-w-0 gap-4 lg:col-span-3'>
            <PanelHeader
              icon={MapPinned}
              title='Risk map'
              aside={<CardActions to='/sites' label='All sites' />}
            />
            <CardContent className='flex-1'>
              <SiteMap
                markers={bundles.map((bundle) => ({
                  site: bundle.site,
                  score: bundle.risk.score,
                  activeLightning: bundle.conditions.lightningActive,
                  hasReports: reportSiteIds.has(bundle.site.id),
                }))}
                strikes={strikes}
                rankLabels={TOP_N}
                onSelect={(siteId) =>
                  navigate({ to: '/sites/$siteId', params: { siteId } })
                }
                height='h-[380px] lg:h-full lg:min-h-[440px]'
              />
            </CardContent>
          </Card>

          <Card className='min-w-0 gap-4 lg:col-span-2'>
            <PanelHeader
              icon={ListOrdered}
              title={`Top ${TOP_N} by hazard index`}
              aside={<CardActions to='/sites' />}
            />
            <CardContent className='space-y-3'>
              <RiskLegend desktopOnly className='border-b pb-3' />
              <PrioritySites items={ranked.slice(0, TOP_N)} />
            </CardContent>
          </Card>
        </div>

        <div className='mt-4 grid gap-4 lg:grid-cols-3'>
          <Card className='gap-4'>
            <PanelHeader
              icon={Siren}
              title='Active alerts'
              aside={<CardActions to='/alerts' />}
            />
            <CardContent>
              <AlertsFeed alerts={alerts} limit={4} />
            </CardContent>
          </Card>

          <BriefingPreview
            briefing={briefingQuery.data}
            isLoading={briefingQuery.isLoading}
          />

          <RecentReports
            reports={reportsQuery.data}
            isLoading={reportsQuery.isLoading}
            limit={3}
          />
        </div>
      </Main>
    </>
  )
}
