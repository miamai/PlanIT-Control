import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { listHazardReports } from '@/api'
import {
  BadgeCheck,
  Clock,
  Database,
  ListFilter,
  MapPinned,
  Plus,
} from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { REPORT_TYPE_LABEL } from '@/lib/planit'
import { useLiveNow } from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { PageHeading } from '@/components/planit/page-heading'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'
import { ReportList } from '@/components/planit/report-list'
import { SiteMap } from '@/components/planit/site-map'
import { StatCard } from '@/components/planit/stat-card'

const ALL = '__all__'
const TYPES = [
  'soil',
  'flood',
  'lightning',
  'heat',
  'wildfire',
  'storm',
  'wildlife',
] as const

export function Hazards() {
  const reportsQuery = useQuery({
    queryKey: ['hazard-reports'],
    queryFn: () => listHazardReports(),
    staleTime: 15_000,
  })
  const [type, setType] = useState<string>(ALL)

  const now = useLiveNow()
  const reports = useMemo(() => reportsQuery.data ?? [], [reportsQuery.data])

  const filtered = useMemo(
    () => (type === ALL ? reports : reports.filter((r) => r.type === type)),
    [reports, type]
  )

  const counts = useMemo(() => {
    const map: Record<string, number> = { [ALL]: reports.length }
    for (const report of reports) map[report.type] = (map[report.type] ?? 0) + 1
    return map
  }, [reports])

  const verified = reports.filter((r) => r.status === 'verified').length
  const recent = reports.filter(
    (r) => now - new Date(r.createdAt).getTime() < 24 * 60 * 60 * 1000
  ).length
  const bySeverity = { critical: 0, warning: 0, info: 0 }
  for (const report of reports) bySeverity[report.severity] += 1

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading
          title='Hazard reports'
          actions={
            <Button asChild size='sm'>
              <Link to='/hazards/new' search={{ site: undefined }}>
                <Plus /> New report
              </Link>
            </Button>
          }
        />

        <div className='mb-4 grid gap-4 sm:grid-cols-3'>
          <StatCard
            label='Reports'
            value={reports.length}
            icon={Database}
            segments={[
              {
                value: bySeverity.critical,
                label: 'critical',
                color: 'bg-red-600',
              },
              {
                value: bySeverity.warning,
                label: 'warning',
                color: 'bg-amber-500',
              },
              {
                value: bySeverity.info,
                label: 'advisory',
                color: 'bg-sky-500',
              },
            ]}
          />
          <StatCard
            label='Verified'
            value={verified}
            icon={BadgeCheck}
            max={reports.length}
            segments={[
              {
                value: verified,
                label: `of ${reports.length} verified`,
                color: 'bg-emerald-500',
              },
            ]}
          />
          <StatCard
            label='Last 24 hours'
            value={recent}
            icon={Clock}
            max={reports.length}
            segments={[
              {
                value: recent,
                label: `of ${reports.length} in the last 24 h`,
                color: 'bg-foreground/60',
              },
            ]}
          />
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          <Card className='min-w-0 gap-4 py-4 shadow-none lg:col-span-2'>
            <PanelHeader
              icon={ListFilter}
              title='All reports'
              className='px-4'
            />
            <CardContent className='space-y-4 px-4'>
              <Tabs value={type} onValueChange={setType}>
                <div className='-mx-1 overflow-x-auto px-1 pb-1'>
                  <TabsList>
                    <TabsTrigger value={ALL}>
                      All
                      <span className='ms-1 text-muted-foreground tabular-nums'>
                        {counts[ALL]}
                      </span>
                    </TabsTrigger>
                    {TYPES.map((reportType) => (
                      <TabsTrigger
                        key={reportType}
                        value={reportType}
                        disabled={!counts[reportType]}
                      >
                        {REPORT_TYPE_LABEL[reportType]}
                        <span className='ms-1 text-muted-foreground tabular-nums'>
                          {counts[reportType] ?? 0}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              </Tabs>

              <ReportList
                reports={filtered}
                isLoading={reportsQuery.isLoading}
                showSite
                emptyMessage='No reports'
              />
            </CardContent>
          </Card>

          <div>
            <Card className='gap-4 lg:sticky lg:top-4'>
              <PanelHeader icon={MapPinned} title='Map' />
              <CardContent>
                <SiteMap
                  markers={SITE_SEED.map((site) => ({ site, score: 0 }))}
                  reports={filtered}
                  siteStyle='context'
                  height='h-[420px]'
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
