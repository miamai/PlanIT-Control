import { useMemo } from 'react'
import { format } from 'date-fns'
import { Link, useNavigate } from '@tanstack/react-router'
import { ListOrdered, MapPinned, Siren, TriangleAlert } from 'lucide-react'
import { type Recommendation } from '@/api/types'
import { useLiveStore } from '@/stores/live-store'
import {
  useActiveAlerts,
  useFleetBriefing,
  useHazardReports,
  useLiveStrikes,
  useSiteBundles,
} from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function Dashboard() {
  const { bundles, isLoading } = useSiteBundles()
  const { alerts } = useActiveAlerts()
  const strikes = useLiveStrikes()
  const now = useLiveStore((state) => state.now)
  const navigate = useNavigate()

  const briefingQuery = useFleetBriefing()
  const reportsQuery = useHazardReports()
  const { reports, fetchedAt } = reportsQuery
  const recentReports = useMemo(
    () =>
      reports
        ?.filter((r) => fetchedAt - new Date(r.createdAt).getTime() < WEEK_MS)
        .slice(0, 6),
    [reports, fetchedAt]
  )

  // Bundles arrive riskiest first; unscored sites are last.
  const ranked = bundles

  const reportSiteIds = useMemo(
    () => new Set((recentReports ?? []).map((r) => r.siteId)),
    [recentReports]
  )

  const summary: Summary = useMemo(() => {
    const calls: Record<Recommendation, number> = {
      GO: 0,
      CAUTION: 0,
      'NO-GO': 0,
      'REVIEW REQUIRED': 0,
    }
    for (const bundle of bundles) {
      if (bundle.risk.recommendation) calls[bundle.risk.recommendation] += 1
    }
    const scored = bundles.flatMap((b) =>
      b.risk.score === null ? [] : [b.risk.score]
    )
    const lightning = alerts.filter(
      (a) => a.type === 'lightning' && a.status === 'active'
    )
    return {
      sites: bundles.length,
      calls,
      activeAlerts: alerts.length,
      critical: alerts.filter((a) => a.severity === 'critical').length,
      warning: alerts.filter((a) => a.severity === 'warning').length,
      advisory: alerts.filter((a) => a.severity === 'info').length,
      lightningSites: new Set(lightning.map((a) => a.siteId)).size,
      scoredSites: scored.length,
      avgScore:
        scored.length === 0
          ? null
          : Math.round(
              (scored.reduce((sum, score) => sum + score, 0) / scored.length) *
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
            <Button asChild size='sm'>
              <Link to='/hazards/new'>
                <TriangleAlert /> Report hazard
              </Link>
            </Button>
          }
        />

        {isLoading ? (
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className='h-[120px] w-full' />
            ))}
          </div>
        ) : (
          <SummaryCards summary={summary} />
        )}

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
            briefing={briefingQuery.briefing}
            isLoading={briefingQuery.isLoading}
          />

          <RecentReports
            reports={recentReports}
            isLoading={reportsQuery.isLoading}
            canView={reportsQuery.canView}
            limit={3}
          />
        </div>
      </Main>
    </>
  )
}
