import { Link, useNavigate } from '@tanstack/react-router'
import type { SiteBundle } from '@/hooks/use-planit'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RiskDriverIcon } from '@/components/planit/risk-driver-icon'
import { RecommendationStatus } from '@/components/planit/risk-status'
import { ScoreBar } from '@/components/planit/score-bar'

export function RiskRankedTable({ items }: { items: SiteBundle[] }) {
  const navigate = useNavigate()

  return (
    <div className='overflow-x-auto'>
      <Table className='table-fixed'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-10 text-center text-xs sm:w-14'>
              Rank
            </TableHead>
            <TableHead className='sm:px-4'>Site</TableHead>
            <TableHead className='w-28 whitespace-normal sm:w-[180px] sm:px-4 sm:text-center lg:w-auto'>
              Hazard index
            </TableHead>
            <TableHead className='hidden px-4 lg:table-cell'>
              <span className='ms-auto block w-[180px] max-w-full'>
                Top drivers
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((bundle, index) => {
            const drivers = bundle.risk.reasons.slice(0, 3)
            const driver = drivers[0]
            return (
              <TableRow
                key={bundle.site.id}
                className='group cursor-pointer'
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
                <TableCell className='sm:px-4'>
                  <Link
                    to='/sites/$siteId'
                    params={{ siteId: bundle.site.id }}
                    className='flex min-w-0 items-center gap-1.5 rounded-sm leading-5 font-medium group-hover:underline focus-visible:outline-2 focus-visible:outline-ring'
                    title={bundle.site.name}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className='truncate'>{bundle.site.name}</span>
                    <RiskDriverIcon driver={driver} />
                  </Link>
                  <span className='block truncate text-xs leading-5 text-muted-foreground'>
                    {bundle.site.county} County, {bundle.site.state} ·{' '}
                    {bundle.site.plantType}
                  </span>
                </TableCell>
                <TableCell className='sm:px-4'>
                  <ScoreBar
                    score={bundle.risk.score}
                    className='max-sm:w-24 sm:mx-auto sm:w-[148px]'
                  />
                  <RecommendationStatus
                    withDesktopLegend
                    recommendation={bundle.risk.recommendation}
                    status={bundle.risk.status}
                    className='mt-1'
                  />
                </TableCell>
                <TableCell className='hidden px-4 lg:table-cell'>
                  {drivers.length > 0 ? (
                    <ul className='ms-auto w-[180px] max-w-full space-y-1.5'>
                      {drivers.map((item) => (
                        <li key={`${item.domain}:${item.label}`}>
                          <span className='block truncate text-sm leading-5'>
                            {item.label}
                          </span>
                          <span className='block text-xs leading-4 text-muted-foreground capitalize'>
                            {item.domain} · {item.severity} · +
                            {item.impact.toFixed(1)} sub-score
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className='ms-auto block w-[180px] max-w-full text-xs text-muted-foreground'>
                      Insufficient data
                    </span>
                  )}
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
