import { createFileRoute } from '@tanstack/react-router'
import { GuidedCapture } from '@/features/hazards/capture'

export const Route = createFileRoute('/_authenticated/hazards/capture')({
  validateSearch: (search: Record<string, unknown>): { site?: string } => ({
    site: typeof search.site === 'string' ? search.site : undefined,
  }),
  component: HazardCaptureRoute,
})

// eslint-disable-next-line react-refresh/only-export-components
function HazardCaptureRoute() {
  const { site } = Route.useSearch()
  return <GuidedCapture defaultSiteId={site} />
}
