import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { MapPinned, Search, Table2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSiteBundles } from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { PageHeading } from '@/components/planit/page-heading'
import { PlanitHeader } from '@/components/planit/planit-header'
import {
  RecommendationStatus,
  RiskLegend,
} from '@/components/planit/risk-status'
import { SiteMap } from '@/components/planit/site-map'
import { RiskRankedTable } from '@/features/dashboard/components/risk-ranked-table'

const ALL = '__all__'
const UNSCORED = '__unscored__'

export function Sites() {
  const { bundles, isLoading } = useSiteBundles()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [recommendation, setRecommendation] = useState(ALL)
  const [plantType, setPlantType] = useState(ALL)

  const counts = useMemo(() => {
    const base = { GO: 0, CAUTION: 0, 'NO-GO': 0, [UNSCORED]: 0 }
    for (const bundle of bundles)
      base[bundle.risk.recommendation ?? UNSCORED] += 1
    return base
  }, [bundles])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return bundles.filter((bundle) => {
      const site = bundle.site
      if (
        q &&
        !`${site.name} ${site.utility} ${site.county} ${site.state}`
          .toLowerCase()
          .includes(q)
      ) {
        return false
      }
      if (
        recommendation !== ALL &&
        (bundle.risk.recommendation ?? UNSCORED) !== recommendation
      ) {
        return false
      }
      if (plantType !== ALL && site.plantType !== plantType) return false
      return true
    })
  }, [bundles, query, recommendation, plantType])

  const plantTypes = useMemo(
    () => [...new Set(bundles.map((bundle) => bundle.site.plantType))].sort(),
    [bundles]
  )

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading
          title='Sites'
          actions={
            <Button asChild size='sm'>
              <Link to='/hazards/new'>
                <TriangleAlert /> Report hazard
              </Link>
            </Button>
          }
        />

        <div className='mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
          <div className='flex flex-wrap gap-2'>
            {(['NO-GO', 'CAUTION', 'GO'] as const).map((call) => (
              <button
                key={call}
                type='button'
                aria-pressed={recommendation === call}
                onClick={() =>
                  setRecommendation(recommendation === call ? ALL : call)
                }
                className={cn(
                  'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                  recommendation === call
                    ? 'border-foreground/40 bg-accent'
                    : 'hover:bg-accent'
                )}
              >
                <RecommendationStatus recommendation={call} />
                <span className='font-medium tabular-nums'>{counts[call]}</span>
              </button>
            ))}
            <button
              type='button'
              aria-pressed={recommendation === UNSCORED}
              onClick={() =>
                setRecommendation(recommendation === UNSCORED ? ALL : UNSCORED)
              }
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                recommendation === UNSCORED
                  ? 'border-foreground/40 bg-accent'
                  : 'hover:bg-accent'
              )}
            >
              <RecommendationStatus recommendation={null} />
              <span className='font-medium tabular-nums'>
                {counts[UNSCORED]}
              </span>
            </button>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative flex-1 sm:flex-none'>
              <Search className='absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search site, utility, county...'
                className='h-9 w-full ps-8 sm:w-64'
              />
            </div>
            <Select value={plantType} onValueChange={setPlantType}>
              <SelectTrigger className='w-40'>
                <SelectValue placeholder='Plant type' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All plant types</SelectItem>
                {plantTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs defaultValue='list'>
          <TabsList className='mb-4'>
            <TabsTrigger value='list'>
              <Table2 /> Ranked list
            </TabsTrigger>
            <TabsTrigger value='map'>
              <MapPinned /> Map
            </TabsTrigger>
          </TabsList>
          <TabsContent value='list'>
            <Card className='py-2'>
              <CardContent className='px-2'>
                <RiskLegend desktopOnly className='px-3 pt-2 pb-4' />
                {isLoading ? (
                  <div className='space-y-2 p-3'>
                    <Skeleton className='h-10 w-full' />
                    <Skeleton className='h-10 w-full' />
                    <Skeleton className='h-10 w-full' />
                  </div>
                ) : (
                  <RiskRankedTable items={filtered} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value='map'>
            <Card className='p-2'>
              <SiteMap
                markers={filtered.map((bundle) => ({
                  site: bundle.site,
                  score: bundle.risk.score,
                  activeLightning: bundle.conditions.lightningActive,
                }))}
                rankLabels={10}
                onSelect={(siteId) =>
                  navigate({ to: '/sites/$siteId', params: { siteId } })
                }
                height='h-[600px]'
                className='border-0'
              />
            </Card>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
