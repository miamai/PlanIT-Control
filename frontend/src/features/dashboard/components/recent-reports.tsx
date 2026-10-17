import { Pin } from 'lucide-react'
import { type HazardReport } from '@/api/types'
import { Card, CardContent } from '@/components/ui/card'
import { CardActions } from '@/components/planit/card-actions'
import { PanelHeader } from '@/components/planit/panel-header'
import { ReportList } from '@/components/planit/report-list'

export function RecentReports({
  reports,
  isLoading,
  limit = 4,
}: {
  reports: HazardReport[] | undefined
  isLoading: boolean
  limit?: number
}) {
  return (
    <Card className='gap-4'>
      <PanelHeader
        icon={Pin}
        title='Crew reports'
        aside={<CardActions to='/hazards' />}
      />
      <CardContent>
        <ReportList
          reports={reports?.slice(0, limit)}
          isLoading={isLoading}
          showSite
          compact
          emptyMessage='No reports'
        />
      </CardContent>
    </Card>
  )
}
