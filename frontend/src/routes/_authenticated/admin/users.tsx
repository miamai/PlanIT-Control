import { createFileRoute, redirect } from '@tanstack/react-router'
import { hasRole, useAuthStore } from '@/stores/auth-store'
import { Users } from '@/features/admin/users'

export const Route = createFileRoute('/_authenticated/admin/users')({
  beforeLoad: () => {
    if (!hasRole(useAuthStore.getState().auth.user, 'admin')) {
      throw redirect({ to: '/errors/$error', params: { error: 'forbidden' } })
    }
  },
  component: Users,
})
