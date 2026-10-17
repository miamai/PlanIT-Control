import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MapPinned, Search, Table2 } from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { RECOMMENDATION_TEXT } from '@/lib/planit'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { PlanitHeader } from '@/components/planit/planit-header'
import { SiteMap } from '@/components/planit/site-map'
import { RiskRankedTable } from '@/features/dashboard/components/risk-ranked-table'

const ALL = '__all__'

export function Sites() {
  const bundles = useSiteBundles()
  const [query, setQuery] = useState('')
  const [recommendation, setRecommendation] = useState(ALL)
  const [plantType, setPlantType] = useState(ALL)

  const counts = useMemo(() => {
    const base = { GO: 0, CAUTION: 0, 'NO-GO': 0 }
    for (const bundle of bundles) base[bundle.risk.recommendation] += 1
    return base
  }, [bundles])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return bundles
      .filter((bundle) => {
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
          bundle.risk.recommendation !== recommendation
        ) {
          return false
        }
        if (plantType !== ALL && site.plantType !== plantType) return false
        return true
      })
      .sort((a, b) => b.risk.score - a.risk.score)
  }, [bundles, query, recommendation, plantType])

  const plantTypes = useMemo(
    () => [...new Set(SITE_SEED.map((site) => site.plantType))].sort(),
    []
  )

  return (
    <>
      <PlanitHeader
        active='sites'
        actions={
          <Button asChild size='sm' className='hidden sm:inline-flex'>
            <Link to='/hazards/new'>Report hazard</Link>
          </Button>
        }
      />
      <Main>
        <div className='mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <div className='space-y-1'>
            <h1 className='text-2xl font-bold tracking-tight'>Job sites</h1>
            <p className='text-sm text-muted-foreground'>
              {filtered.length} of {bundles.length} sites · ranked by hazard
              index
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative'>
              <Search className='absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search site, utility, county...'
                className='w-full min-w-56 ps-8 sm:w-72'
              />
            </div>
            <Select value={recommendation} onValueChange={setRecommendation}>
              <SelectTrigger className='w-36'>
                <SelectValue placeholder='Risk' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All risk calls</SelectItem>
                <SelectItem value='NO-GO'>NO-GO ({counts['NO-GO']})</SelectItem>
                <SelectItem value='CAUTION'>
                  CAUTION ({counts.CAUTION})
                </SelectItem>
                <SelectItem value='GO'>GO ({counts.GO})</SelectItem>
              </SelectContent>
            </Select>
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

        <div className='mb-4 flex flex-wrap gap-2'>
          {(['NO-GO', 'CAUTION', 'GO'] as const).map((call) => (
            <button
              key={call}
              type='button'
              onClick={() =>
                setRecommendation(recommendation === call ? ALL : call)
              }
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                recommendation === call
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-accent'
              )}
            >
              <span
                className={cn(
                  'text-xs font-semibold tracking-wide uppercase',
                  RECOMMENDATION_TEXT[call]
                )}
              >
                {call}
              </span>
              <span className='ms-2 tabular-nums'>{counts[call]}</span>
            </button>
          ))}
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
            <Card>
              <CardContent className='p-0'>
                <RiskRankedTable items={filtered} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value='map'>
            <SiteMap
              markers={filtered.map((bundle) => ({
                site: bundle.site,
                score: bundle.risk.score,
                activeLightning: bundle.conditions.lightningActive,
              }))}
              height='h-[600px]'
            />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
