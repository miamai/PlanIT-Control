import { api, unwrap, unwrapData, unwrapEmpty } from './client'
import { type components } from './schema'

export type ManagedUser = components['schemas']['UserRead']
export type CreateUser = components['schemas']['UserCreate']
export type UpdateUser = components['schemas']['UserUpdate']
export type UserFilters = {
  role?: ManagedUser['role']
  status?: ManagedUser['status']
  include_deleted: boolean
  limit: number
  offset: number
}

export async function listUsers(filters: UserFilters) {
  const result = await unwrap(
    api.GET('/api/admin/users', { params: { query: filters } })
  )
  const total =
    result.meta && 'total' in result.meta ? result.meta.total : undefined
  return { users: result.data, total: typeof total === 'number' ? total : null }
}

export function getUser(id: string): Promise<ManagedUser> {
  return unwrapData(
    api.GET('/api/admin/users/{user_id}', { params: { path: { user_id: id } } })
  )
}

export function createUser(body: CreateUser): Promise<ManagedUser> {
  return unwrapData(api.POST('/api/admin/users', { body }))
}

export function updateUser(id: string, body: UpdateUser): Promise<ManagedUser> {
  return unwrapData(
    api.PATCH('/api/admin/users/{user_id}', {
      params: { path: { user_id: id } },
      body,
    })
  )
}

export function deleteUser(id: string): Promise<void> {
  return unwrapEmpty(
    api.DELETE('/api/admin/users/{user_id}', {
      params: { path: { user_id: id } },
    })
  )
}
