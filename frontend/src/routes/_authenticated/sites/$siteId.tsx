import { createFileRoute } from '@tanstack/react-router'
import { SiteDetail } from '@/features/sites/site-detail'

export const Route = createFileRoute('/_authenticated/sites/$siteId')({
  component: SiteDetailRoute,
})

// eslint-disable-next-line react-refresh/only-export-components
function SiteDetailRoute() {
  const { siteId } = Route.useParams()
  return <SiteDetail siteId={siteId} />
}
