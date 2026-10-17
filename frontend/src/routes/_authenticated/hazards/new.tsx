import { createFileRoute } from '@tanstack/react-router'
import { HazardReportForm } from '@/features/hazards/report-form'

export const Route = createFileRoute('/_authenticated/hazards/new')({
  validateSearch: (search: Record<string, unknown>): { site?: string } => ({
    site: typeof search.site === 'string' ? search.site : undefined,
  }),
  component: HazardNewRoute,
})

// eslint-disable-next-line react-refresh/only-export-components
function HazardNewRoute() {
  const { site } = Route.useSearch()
  return <HazardReportForm defaultSiteId={site} />
}
