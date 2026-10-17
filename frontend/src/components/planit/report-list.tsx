import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { BadgeCheck, MapPin } from 'lucide-react'
import { type HazardReport } from '@/api/types'
import { REPORT_TYPE_ICON, REPORT_TYPE_LABEL, relativeTime } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useSites } from '@/hooks/use-planit'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export function ReportList({
  reports,
  isLoading,
  emptyMessage = 'No reports',
  showSite = false,
  compact = false,
  className,
}: {
  reports: HazardReport[] | undefined
  isLoading?: boolean
  emptyMessage?: string
  showSite?: boolean
  /** Clamp the note, for narrow side panels. */
  compact?: boolean
  className?: string
}) {
  const { sites } = useSites()
  const siteById = useMemo(
    () => new Map(sites.map((site) => [site.id, site])),
    [sites]
  )

  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-16 w-full' />
      </div>
    )
  }

  if (!reports?.length) {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground',
          className
        )}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <ul className={cn('divide-y', className)}>
      {reports.map((report) => {
        const site = siteById.get(report.siteId)
        const Icon = REPORT_TYPE_ICON[report.type]
        return (
          <li key={report.id} className='flex gap-3 py-4 first:pt-0 last:pb-0'>
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
                compact && 'size-8'
              )}
            >
              <Icon className='size-4' aria-hidden />
            </span>
            <div className='min-w-0 flex-1 space-y-2'>
              <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 max-sm:flex-col max-sm:items-start'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm font-semibold'>
                    {REPORT_TYPE_LABEL[report.type]}
                  </span>
                  {report.status === 'verified' ? (
                    <Badge
                      variant='outline'
                      className='gap-1 px-1.5 py-0.5 text-xs leading-4 text-muted-foreground'
                    >
                      <BadgeCheck className='size-3' /> Verified
                    </Badge>
                  ) : null}
                  {report.status === 'dismissed' ? (
                    <Badge
                      variant='outline'
                      className='text-xs text-muted-foreground'
                    >
                      Dismissed
                    </Badge>
                  ) : null}
                </div>
                <time
                  dateTime={report.createdAt}
                  title={new Date(report.createdAt).toLocaleString('en-US')}
                  className='shrink-0 text-xs whitespace-nowrap text-muted-foreground'
                >
                  {relativeTime(report.createdAt)}
                </time>
              </div>
              <p
                className={cn(
                  'text-sm leading-relaxed break-words text-foreground',
                  compact && 'line-clamp-2'
                )}
              >
                {report.note}
              </p>
              <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground'>
                <span className='font-medium text-foreground'>
                  {report.reportedBy}
                </span>
                {showSite && site ? (
                  <Link
                    to='/sites/$siteId'
                    params={{ siteId: site.id }}
                    className='inline-flex min-w-0 items-center gap-1 rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring'
                  >
                    <MapPin className='size-3 shrink-0' aria-hidden />
                    {site.name} ({site.state})
                  </Link>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
