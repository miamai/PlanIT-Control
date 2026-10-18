import { type ManagedUser, type UpdateUser } from '@/api/admin-users'
import { ApiError } from '@/api/client'

export function userError(error: unknown): string {
  if (error instanceof ApiError) return error.detail || error.message
  return 'Could not complete the request. Check your connection and try again.'
}

export function revokesSession(patch: UpdateUser): boolean {
  return (
    patch.role != null || patch.password != null || patch.status === 'disabled'
  )
}

export function buildUserUpdate(
  user: ManagedUser,
  values: {
    display_name: string
    role: ManagedUser['role']
    status: ManagedUser['status']
    password: string
  }
): UpdateUser {
  const patch: UpdateUser = {}
  if (values.display_name !== (user.display_name ?? ''))
    patch.display_name = values.display_name || null
  if (values.role !== user.role) patch.role = values.role
  if (values.status !== user.status) patch.status = values.status
  if (values.password) patch.password = values.password
  return patch
}
