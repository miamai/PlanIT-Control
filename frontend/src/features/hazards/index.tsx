import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { listHazardReports } from '@/api'
import { Plus, Share2, Users } from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { REPORT_TYPE_LABEL, relativeTime } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useLiveStrikes } from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
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
  const strikes = useLiveStrikes()
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

  const contributors = new Set(reports.map((r) => r.reportedBy)).size

  return (
    <>
      <PlanitHeader
        active='hazards'
        actions={
          <Button asChild size='sm' className='hidden sm:inline-flex'>
            <Link to='/hazards/new' search={{ site: undefined }}>
              <Plus /> New report
            </Link>
          </Button>
        }
      />
      <Main>
        <div className='mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <div className='space-y-1'>
            <h1 className='text-2xl font-bold tracking-tight'>
              Shared hazard database
            </h1>
            <p className='text-sm text-muted-foreground'>
              Every hazard a crew pins is instantly visible to the whole network
              — no more tribal knowledge stuck on one truck.
            </p>
          </div>
          <Button asChild size='sm' variant='outline' className='sm:hidden'>
            <Link to='/hazards/new' search={{ site: undefined }}>
              <Plus /> New report
            </Link>
          </Button>
        </div>

        <div className='mb-4 grid gap-4 sm:grid-cols-3'>
          <StatCard
            label='Reports on file'
            value={reports.length}
            icon={Share2}
            hint='Shared across the network'
          />
          <StatCard
            label='Contributors'
            value={contributors}
            icon={Users}
            hint='Crews and supervisors reporting'
          />
          <StatCard
            label='Latest report'
            value={
              reports.length
                ? relativeTime(reports[0].createdAt).replace(' ago', '')
                : '—'
            }
            icon={Share2}
            hint={
              reports.length ? REPORT_TYPE_LABEL[reports[0].type] : undefined
            }
          />
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          <div className='space-y-4 lg:col-span-2'>
            <Tabs value={type} onValueChange={setType}>
              <div className='overflow-x-auto pb-2'>
                <TabsList>
                  <TabsTrigger value={ALL}>
                    All
                    <span className='ms-1 text-muted-foreground tabular-nums'>
                      {counts[ALL]}
                    </span>
                  </TabsTrigger>
                  {TYPES.map((reportType) => (
                    <TabsTrigger key={reportType} value={reportType}>
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
              emptyMessage='No reports of this type yet.'
            />
          </div>

          <div className='space-y-4'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>Report map</CardTitle>
              </CardHeader>
              <CardContent>
                <SiteMap
                  markers={SITE_SEED.map((site) => ({ site, score: 0 }))}
                  strikes={strikes}
                  reports={reports}
                  height='h-[300px]'
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>Top reporters</CardTitle>
              </CardHeader>
              <CardContent className='space-y-2'>
                {Object.entries(
                  reports.reduce<Record<string, number>>((acc, report) => {
                    acc[report.reportedBy] = (acc[report.reportedBy] ?? 0) + 1
                    return acc
                  }, {})
                )
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([name, count]) => (
                    <div
                      key={name}
                      className='flex items-center justify-between text-sm'
                    >
                      <span className='truncate'>{name}</span>
                      <span
                        className={cn(
                          'rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums'
                        )}
                      >
                        {count}
                      </span>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
