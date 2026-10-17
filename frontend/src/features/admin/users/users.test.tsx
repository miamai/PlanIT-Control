import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { type ManagedUser } from '@/api/admin-users'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth-store'
import { getNavGroups } from '@/components/layout/data/sidebar-data'
import { Users } from './index'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@/api/admin-users', () => ({
  listUsers: mocks.list,
  getUser: mocks.get,
  createUser: mocks.create,
  updateUser: mocks.update,
  deleteUser: mocks.remove,
}))
vi.mock('@/components/planit/planit-header', () => ({
  PlanitHeader: () => null,
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mocks.navigate,
}))
vi.mock('@/lib/toast', () => ({ toastSuccess: vi.fn() }))

const admin: ManagedUser = {
  id: 'admin-id',
  username: 'admin.test',
  display_name: 'Admin Test',
  role: 'admin',
  status: 'active',
  created_at: '2026-10-17T00:00:00Z',
  updated_at: '2026-10-17T00:00:00Z',
  deleted_at: null,
}
const other: ManagedUser = {
  ...admin,
  id: 'other-id',
  username: 'other.admin',
  display_name: 'Other Admin',
}
beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.getState().auth.setSession('test-token', 900, admin)
  mocks.list.mockResolvedValue({ users: [admin, other], total: 2 })
  mocks.get.mockImplementation(async (id) => (id === admin.id ? admin : other))
})
async function renderUsers() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Users />
    </QueryClientProvider>
  )
}

describe('user management workflows', () => {
  it('hides admin navigation and makes no account requests for users', async () => {
    for (const role of ['user'] as const)
      expect(
        getNavGroups({ ...admin, role }).some(
          (group) => group.title === 'Administration'
        )
      ).toBe(false)
    expect(
      getNavGroups(admin).some((group) => group.title === 'Administration')
    ).toBe(true)
    useAuthStore
      .getState()
      .auth.setSession('test-token', 900, { ...admin, role: 'user' })
    const screen = await renderUsers()
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Only administrators can manage users.')
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('allows peer-admin editing and disables self-deletion', async () => {
    const screen = await renderUsers()
    await expect
      .element(screen.getByRole('button', { name: 'Delete admin.test' }))
      .toBeDisabled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit other.admin' })
    )
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    await userEvent.fill(
      screen.getByLabelText('Display name (optional)'),
      'Updated Admin'
    )
    mocks.update.mockResolvedValue({ ...other, display_name: 'Updated Admin' })
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(other.id, {
        display_name: 'Updated Admin',
      })
    )
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })
  it('fetches current details and offers editing', async () => {
    const screen = await renderUsers()
    await userEvent.click(
      screen.getByRole('button', { name: 'Other Admin — view user details' })
    )
    await expect
      .element(screen.getByRole('dialog'))
      .toHaveTextContent('other-id')
    expect(mocks.get).toHaveBeenCalledWith(other.id)
    await expect
      .element(screen.getByRole('button', { name: 'Edit user', exact: true }))
      .toBeVisible()
  })
  it('requires confirmation before deletion and retains server errors', async () => {
    mocks.remove.mockRejectedValue(
      new ApiError(409, 'Conflict', 'The last active admin cannot be changed')
    )
    const screen = await renderUsers()
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete other.admin' })
    )
    expect(mocks.remove).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete user', exact: true })
    )
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('The last active admin cannot be changed')
    mocks.remove.mockResolvedValue(undefined)
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete user', exact: true })
    )
    await expect
      .element(screen.getByRole('alertdialog'))
      .not.toBeInTheDocument()
    expect(mocks.remove).toHaveBeenCalledWith(other.id)
  })
  it('requests server pagination and resets it when a filter changes', async () => {
    mocks.list.mockResolvedValue({ users: [other], total: 26 })
    const screen = await renderUsers()
    await userEvent.click(
      screen.getByRole('button', { name: 'Next', exact: true })
    )
    await vi.waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 25 })
      )
    )
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'admin')
    await vi.waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'admin', offset: 0 })
      )
    )
    await userEvent.click(screen.getByLabelText('Include deleted'))
    await vi.waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ include_deleted: true })
      )
    )
  })
  it('returns to sign-in after a successful self-role change', async () => {
    mocks.update.mockResolvedValue({ ...admin, role: 'user' })
    const screen = await renderUsers()
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit admin.test' })
    )
    await userEvent.selectOptions(
      screen.getByRole('dialog').getByLabelText('Role'),
      'user'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/sign-in',
        search: { redirect: '/admin/users' },
        replace: true,
      })
    )
    expect(useAuthStore.getState().auth.user).toBeNull()
  })
})
