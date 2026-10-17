import { createFileRoute, redirect } from '@tanstack/react-router'
import { ensureSession } from '@/api/auth'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  // The access token lives in memory, so after a reload this restores the
  // session from the HttpOnly refresh cookie before any data loads.
  beforeLoad: async ({ location }) => {
    if (!(await ensureSession())) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
  },
  component: AuthenticatedLayout,
})
