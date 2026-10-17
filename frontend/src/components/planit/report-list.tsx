import { useState } from 'react'
import { confirmHazardReport } from '@/api'
import { BadgeCheck, Camera, MapPin } from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { type HazardReport } from '@/api/types'
import {
  REPORT_TYPE_LABEL,
  relativeTime,
  SEVERITY_BADGE,
  severityFromAlert,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function ReportList({
  reports,
  isLoading,
  emptyMessage = 'No crew reports yet for this site.',
  showSite = false,
  className,
}: {
  reports: HazardReport[] | undefined
  isLoading?: boolean
  emptyMessage?: string
  showSite?: boolean
  className?: string
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [confirmedIds, setConfirmedIds] = useState<string[]>([])

  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
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
    <div className={cn('space-y-3', className)}>
      {reports.map((report) => {
        const site = SITE_SEED.find((s) => s.id === report.siteId)
        return (
          <div key={report.id} className='rounded-lg border p-3'>
            <div className='flex flex-wrap items-center gap-1.5'>
              <Badge
                variant='outline'
                className={cn(
                  'text-[10px]',
                  SEVERITY_BADGE[severityFromAlert(report.severity)]
                )}
              >
                {REPORT_TYPE_LABEL[report.type]}
              </Badge>
              <Badge
                variant='outline'
                className='text-[10px] text-muted-foreground'
              >
                {report.status}
              </Badge>
              <span className='ms-auto text-[11px] text-muted-foreground'>
                {relativeTime(report.createdAt)}
              </span>
            </div>

            <div className='mt-2 flex gap-3'>
              {report.photoUrl ? (
                <img
                  src={report.photoUrl}
                  alt='Hazard photo'
                  className='size-16 shrink-0 rounded-md border object-cover'
                />
              ) : (
                <span className='flex size-16 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground'>
                  <Camera className='size-5' />
                </span>
              )}
              <div className='min-w-0 flex-1 space-y-1'>
                <p className='text-sm'>{report.note}</p>
                <p className='flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground'>
                  <span className='font-medium text-foreground'>
                    {report.reportedBy}
                  </span>
                  <span className='uppercase'>{report.reporterRole}</span>
                  {showSite && site ? (
                    <span className='flex items-center gap-1'>
                      <MapPin className='size-3' />
                      {site.name} ({site.state})
                    </span>
                  ) : (
                    <span>
                      {report.lat.toFixed(4)}, {report.lon.toFixed(4)}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className='mt-2 flex items-center justify-between'>
              <Button
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                disabled={
                  confirming === report.id || confirmedIds.includes(report.id)
                }
                onClick={() => handleConfirm(report)}
              >
                <BadgeCheck />{' '}
                {confirmedIds.includes(report.id) ? 'Confirmed' : 'Confirm'}
                <span className='ms-1 tabular-nums'>
                  {report.confirmations +
                    (confirmedIds.includes(report.id) ? 1 : 0)}
                </span>
              </Button>
              <span className='text-[11px] text-muted-foreground'>
                Shared with network owners
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
