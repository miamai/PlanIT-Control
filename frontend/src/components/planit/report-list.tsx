import { useState } from 'react'
import { confirmHazardReport } from '@/api'
import { BadgeCheck, MapPin } from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { type HazardReport } from '@/api/types'
import { REPORT_TYPE_ICON, REPORT_TYPE_LABEL, relativeTime } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertSeverityBadge } from './risk-badge'

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
  /** Hide the confirm action and photo, for narrow side panels. */
  compact?: boolean
  className?: string
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [confirmedIds, setConfirmedIds] = useState<string[]>([])

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

  async function handleConfirm(report: HazardReport) {
    setConfirming(report.id)
    await confirmHazardReport(report.id)
    setConfirmedIds((prev) =>
      prev.includes(report.id) ? prev : [...prev, report.id]
    )
    setConfirming(null)
  }

  return (
    <ul className={cn('divide-y', className)}>
      {reports.map((report) => {
        const site = SITE_SEED.find((s) => s.id === report.siteId)
        const Icon = REPORT_TYPE_ICON[report.type]
        const confirmed = confirmedIds.includes(report.id)
        return (
          <li key={report.id} className='flex gap-3 py-3 first:pt-0 last:pb-0'>
            <span className='flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'>
              <Icon className='size-4' />
            </span>
            <div className='min-w-0 flex-1 space-y-1'>
              <div className='flex items-start justify-between gap-2'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <span className='text-sm font-medium'>
                    {REPORT_TYPE_LABEL[report.type]}
                  </span>
                  <AlertSeverityBadge
                    severity={report.severity}
                    className='px-1.5 py-0 text-[10px]'
                  />
                  {report.status === 'verified' ? (
                    <Badge
                      variant='outline'
                      className='gap-1 px-1.5 py-0 text-[10px] text-muted-foreground'
                    >
                      <BadgeCheck className='size-3' /> Verified
                    </Badge>
                  ) : null}
                </div>
                <span className='shrink-0 text-[11px] whitespace-nowrap text-muted-foreground'>
                  {relativeTime(report.createdAt)}
                </span>
              </div>
              <div className='flex gap-3'>
                <p
                  className={cn(
                    'min-w-0 flex-1 text-sm text-muted-foreground',
                    compact && 'line-clamp-2'
                  )}
                >
                  {report.note}
                </p>
                {report.photoUrl && !compact ? (
                  <img
                    src={report.photoUrl}
                    alt='Hazard photo'
                    className='size-14 shrink-0 rounded-md border object-cover'
                  />
                ) : null}
              </div>
              <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground'>
                <span className='font-medium text-foreground'>
                  {report.reportedBy}
                </span>
                {!compact ? (
                  <span className='capitalize'>{report.reporterRole}</span>
                ) : null}
                {showSite && site ? (
                  <span className='inline-flex items-center gap-1'>
                    <MapPin className='size-3' />
                    {site.name} ({site.state})
                  </span>
                ) : null}
                {compact ? (
                  <span>· {report.confirmations} confirmed</span>
                ) : null}
              </div>
              {!compact ? (
                <Button
                  variant='outline'
                  size='sm'
                  className='mt-1 h-7 text-xs'
                  disabled={confirming === report.id || confirmed}
                  onClick={() => handleConfirm(report)}
                >
                  <BadgeCheck /> {confirmed ? 'Confirmed' : 'Still there'}
                  <span className='ms-1 text-muted-foreground tabular-nums'>
                    {report.confirmations + (confirmed ? 1 : 0)}
                  </span>
                </Button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
