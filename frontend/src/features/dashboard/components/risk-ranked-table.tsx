import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Zap } from 'lucide-react'
import { DOMAIN_ICON } from '@/lib/planit'
import type { SiteBundle } from '@/hooks/use-planit'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RecommendationStatus } from '@/components/planit/risk-status'
import { ScoreBar } from '@/components/planit/score-bar'

export function RiskRankedTable({ items }: { items: SiteBundle[] }) {
  const navigate = useNavigate()

  return (
    <div className='overflow-x-auto'>
      <Table className='max-sm:table-fixed'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-10 text-center sm:w-12'>Rank</TableHead>
            <TableHead>Site</TableHead>
            <TableHead className='w-28 whitespace-normal sm:w-[170px]'>
              Hazard index
            </TableHead>
            <TableHead className='hidden lg:table-cell'>Top driver</TableHead>
            <TableHead className='hidden w-10 sm:table-cell' />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((bundle, index) => {
            const driver = bundle.risk.reasons[0]
            const DriverIcon = driver ? DOMAIN_ICON[driver.domain] : undefined
            return (
              <TableRow
                key={bundle.site.id}
                className='cursor-pointer'
                onClick={() =>
                  navigate({
                    to: '/sites/$siteId',
                    params: { siteId: bundle.site.id },
                  })
                }
              >
                <TableCell className='text-center text-sm text-muted-foreground tabular-nums'>
                  {index + 1}
                </TableCell>
                <TableCell className='max-w-72'>
                  <Link
                    to='/sites/$siteId'
                    params={{ siteId: bundle.site.id }}
                    className='flex items-center gap-1.5 font-medium hover:underline'
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className='truncate'>{bundle.site.name}</span>
                    {bundle.conditions.lightningActive ? (
                      <Zap
                        className='size-3.5 shrink-0 text-red-600 dark:text-red-400'
                        aria-label='Lightning stop-work active'
                      />
                    ) : null}
                  </Link>
                  <span className='block truncate text-xs text-muted-foreground'>
                    {bundle.site.county} County, {bundle.site.state} ·{' '}
                    {bundle.site.plantType}
                  </span>
                </TableCell>
                <TableCell>
                  <ScoreBar score={bundle.risk.score} className='max-sm:w-24' />
                  <RecommendationStatus
                    withDesktopLegend
                    recommendation={bundle.risk.recommendation}
                    status={bundle.risk.status}
                    className='mt-1'
                  />
                </TableCell>
                <TableCell className='hidden lg:table-cell'>
                  {driver && DriverIcon ? (
                    <span className='flex items-center gap-2 text-xs text-muted-foreground'>
                      <DriverIcon className='size-3.5 shrink-0' />
                      <span className='truncate'>
                        <span className='text-foreground'>{driver.label}</span>{' '}
                        · {Math.round(driver.contribution * 100)}% of score
                      </span>
                    </span>
                  ) : (
                    <span className='text-xs text-muted-foreground'>—</span>
                  )}
                </TableCell>
                <TableCell className='hidden sm:table-cell'>
                  <ChevronRight className='size-4 text-muted-foreground' />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {items.length === 0 ? (
        <div className='p-6 text-center text-sm text-muted-foreground'>
          No sites match this filter.
        </div>
      ) : null}
    </div>
  )
}
