import { Link } from '@tanstack/react-router'
import { ChevronRight, Zap } from 'lucide-react'
import { SEVERITY_TEXT, severityFromScore } from '@/lib/planit'
import { cn } from '@/lib/utils'
import type { SiteBundle } from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RecommendationBadge } from '@/components/planit/risk-badge'

export function RiskRankedTable({
  items,
  limit,
  compact = false,
}: {
  items: SiteBundle[]
  limit?: number
  compact?: boolean
}) {
  const rows = items.slice(0, limit ?? items.length)

  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-10 text-center'>#</TableHead>
            <TableHead>Site</TableHead>
            <TableHead className='w-[190px]'>Hazard index</TableHead>
            <TableHead className='w-[110px]'>Call</TableHead>
            {!compact ? (
              <TableHead className='hidden md:table-cell'>Top driver</TableHead>
            ) : null}
            <TableHead className='w-10' />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((bundle, index) => {
            const severity = severityFromScore(bundle.risk.score)
            const driver = bundle.risk.reasons[0]
            return (
              <TableRow
                key={bundle.site.id}
                className='cursor-pointer'
                data-state={
                  bundle.risk.recommendation === 'NO-GO'
                    ? 'selected'
                    : undefined
                }
              >
                <TableCell className='text-center text-sm text-muted-foreground tabular-nums'>
                  {index + 1}
                </TableCell>
                <TableCell>
                  <Link
                    to='/sites/$siteId'
                    params={{ siteId: bundle.site.id }}
                    className='group block min-w-0'
                  >
                    <span className='flex items-center gap-1.5 font-medium group-hover:text-primary'>
                      {bundle.site.name}
                      {bundle.conditions.lightningActive ? (
                        <Zap className='size-3.5 fill-violet-500 text-violet-500' />
                      ) : null}
                    </span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {bundle.site.county} County, {bundle.site.state} ·{' '}
                      {bundle.site.plantType}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <div className='flex items-center gap-2'>
                    <span
                      className={cn(
                        'w-8 text-sm font-semibold tabular-nums',
                        SEVERITY_TEXT[severity]
                      )}
                    >
                      {bundle.risk.score.toFixed(1)}
                    </span>
                    <span className='h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-muted'>
                      <span
                        className={cn(
                          'block h-full rounded-full',
                          bundle.risk.score >= 6.5
                            ? 'bg-red-600'
                            : bundle.risk.score >= 3.5
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                        )}
                        style={{ width: `${bundle.risk.score * 10}%` }}
                      />
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <RecommendationBadge
                    recommendation={bundle.risk.recommendation}
                  />
                </TableCell>
                {!compact ? (
                  <TableCell className='hidden max-w-64 md:table-cell'>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {driver?.label ?? '—'} ·{' '}
                      {Math.round((driver?.contribution ?? 0) * 100)}% of score
                    </span>
                  </TableCell>
                ) : null}
                <TableCell>
                  <Button
                    asChild
                    variant='ghost'
                    size='icon'
                    className='size-7'
                  >
                    <Link
                      to='/sites/$siteId'
                      params={{ siteId: bundle.site.id }}
                      aria-label={`Open ${bundle.site.name}`}
                    >
                      <ChevronRight className='size-4' />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {rows.length === 0 ? (
        <div className='p-6 text-center text-sm text-muted-foreground'>
          No sites match this filter.
        </div>
      ) : null}
    </div>
  )
}
