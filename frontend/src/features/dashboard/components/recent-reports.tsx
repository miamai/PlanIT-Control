import { Link } from '@tanstack/react-router'
import { Camera, ChevronRight, Pin } from 'lucide-react'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CardActions } from '@/components/planit/card-actions'

export function RecentReports({
  reports,
  isLoading,
  limit = 4,
}: {
  reports: HazardReport[] | undefined
  isLoading: boolean
  limit?: number
}) {
  const rows = reports?.slice(0, limit) ?? []

  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Pin className='size-4 text-muted-foreground' />
          Crew hazard reports
        </CardTitle>
        <CardActions to='/hazards' />
      </CardHeader>
      <CardContent className='space-y-3'>
        {isLoading ? (
          <>
            <Skeleton className='h-14 w-full' />
            <Skeleton className='h-14 w-full' />
            <Skeleton className='h-14 w-full' />
          </>
        ) : rows.length === 0 ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            No crew reports in the last 7 days.
          </p>
        ) : (
          rows.map((report) => {
            const site = SITE_SEED.find((s) => s.id === report.siteId)
            return (
              <Link
                key={report.id}
                to='/hazards'
                className='flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent'
              >
                <span className='flex size-9 shrink-0 items-center justify-center rounded-md bg-muted'>
                  {report.photoUrl ? (
                    <img
                      src={report.photoUrl}
                      alt=''
                      className='size-9 rounded-md object-cover'
                    />
                  ) : (
                    <Camera className='size-4 text-muted-foreground' />
                  )}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='flex flex-wrap items-center gap-1.5'>
                    <Badge
                      variant='outline'
                      className={cn(
                        'text-[10px]',
                        SEVERITY_BADGE[severityFromAlert(report.severity)]
                      )}
                    >
                      {REPORT_TYPE_LABEL[report.type]}
                    </Badge>
                    <span className='text-[11px] text-muted-foreground'>
                      {site?.name ?? report.siteId}
                    </span>
                  </span>
                  <span className='mt-1 block truncate text-xs text-muted-foreground'>
                    {report.note}
                  </span>
                  <span className='mt-0.5 block text-[11px] text-muted-foreground'>
                    {report.reportedBy} · {relativeTime(report.createdAt)} ·{' '}
                    {report.confirmations} confirmed
                  </span>
                </span>
                <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
              </Link>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
