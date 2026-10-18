import { createFileRoute } from '@tanstack/react-router'
import { type HazardReportType } from '@/api/types'
import { REPORT_TYPE_LABEL } from '@/lib/planit'
import { HazardReportForm } from '@/features/hazards/report-form'

export const Route = createFileRoute('/_authenticated/hazards/new')({
  validateSearch: (
    search: Record<string, unknown>
  ): { site?: string; type?: HazardReportType } => ({
    site: typeof search.site === 'string' ? search.site : undefined,
    type:
      typeof search.type === 'string' && search.type in REPORT_TYPE_LABEL
        ? (search.type as HazardReportType)
        : undefined,
  }),
  component: HazardNewRoute,
})

// eslint-disable-next-line react-refresh/only-export-components
function HazardNewRoute() {
  const { site, type } = Route.useSearch()
  return <HazardReportForm defaultSiteId={site} defaultType={type} />
}
