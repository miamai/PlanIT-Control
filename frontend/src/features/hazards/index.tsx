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
import { REPORT_TYPE_LABEL, relativeTime } from '@/lib/planit'
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
            label='Reports on file'
            value={reports.length}
            icon={Database}
          />
          <StatCard label='Verified' value={verified} icon={BadgeCheck} />
          <StatCard
            label='Latest report'
            value={
              reports.length
                ? relativeTime(reports[0].createdAt).replace(' ago', '')
                : '—'
            }
            icon={Clock}
            hint={
              reports.length
                ? `${REPORT_TYPE_LABEL[reports[0].type]} · ${SITE_SEED.find((s) => s.id === reports[0].siteId)?.name ?? ''}`
                : undefined
            }
          />
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          <Card className='min-w-0 gap-4 lg:col-span-2'>
            <PanelHeader icon={ListFilter} title='All reports' />
            <CardContent className='space-y-4'>
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
