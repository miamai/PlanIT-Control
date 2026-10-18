import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import {
  type CreateUser,
  type ManagedUser,
  type UpdateUser,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from '@/api/admin-users'
import { hasRole, ROLE_LABEL, useAuthStore } from '@/stores/auth-store'
import { toastSuccess } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Main } from '@/components/layout/main'
import { PageHeading } from '@/components/planit/page-heading'
import { PlanitHeader } from '@/components/planit/planit-header'
import { UserDialog, type UserSelection } from './user-dialog'
import { revokesSession, userError } from './utils'

const PAGE_SIZE = 25

export function Users() {
  const currentUser = useAuthStore((state) => state.auth.user)
  const authorized = hasRole(currentUser, 'admin')
  const [role, setRole] = useState<ManagedUser['role'] | 'all'>('all')
  const [status, setStatus] = useState<ManagedUser['status'] | 'all'>('all')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [offset, setOffset] = useState(0)
  const [selection, setSelection] = useState<UserSelection | null>(null)
  const [deleting, setDeleting] = useState<ManagedUser | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deletePending, setDeletePending] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['admin-users', 'list', role, status, includeDeleted, offset],
    queryFn: () =>
      listUsers({
        role: role === 'all' ? undefined : role,
        status: status === 'all' ? undefined : status,
        include_deleted: includeDeleted,
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: authorized,
  })
  const users = query.data?.users ?? []
  const total = query.data?.total

  async function save(body: CreateUser | UpdateUser) {
    if (!selection) return
    const result =
      selection.mode === 'create'
        ? await createUser(body as CreateUser)
        : await updateUser(selection.id, body)
    const self = result.id === currentUser?.id
    setSelection(null)
    toastSuccess(selection.mode === 'create' ? 'User created' : 'User updated')
    if (self && revokesSession(body)) {
      useAuthStore.getState().auth.reset()
      queryClient.clear()
      await navigate({
        to: '/sign-in',
        search: { redirect: '/admin/users' },
        replace: true,
      })
      return
    }
    if (self) {
      useAuthStore.setState((state) => ({
        auth: { ...state.auth, user: result },
      }))
    }
    await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
  }

  async function remove() {
    if (!deleting) return
    setDeletePending(true)
    setDeleteError('')
    try {
      await deleteUser(deleting.id)
      setDeleting(null)
      toastSuccess(
        'User deleted',
        'The account has been disabled and its refresh sessions revoked.'
      )
      if (users.length === 1 && offset > 0)
        setOffset(Math.max(0, offset - PAGE_SIZE))
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (error) {
      setDeleteError(userError(error))
    } finally {
      setDeletePending(false)
    }
  }

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading
          title='Users'
          description='Manage account access across Precognition.'
          actions={
            authorized && (
              <Button onClick={() => setSelection({ mode: 'create' })}>
                <Plus />
                Create user
              </Button>
            )
          }
        />
        {!authorized ? (
          <p role='alert'>Only administrators can manage users.</p>
        ) : (
          <>
            <div className='mb-4 flex flex-wrap items-end gap-4'>
              <div className='space-y-2'>
                <Label htmlFor='filter-role'>Role</Label>
                <select
                  id='filter-role'
                  className='h-9 rounded-md border bg-background px-3 text-sm'
                  value={role}
                  onChange={(event) => {
                    setRole(event.target.value as typeof role)
                    setOffset(0)
                  }}
                >
                  <option value='all'>All roles</option>
                  {Object.entries(ROLE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='filter-status'>Status</Label>
                <select
                  id='filter-status'
                  className='h-9 rounded-md border bg-background px-3 text-sm'
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as typeof status)
                    setOffset(0)
                  }}
                >
                  <option value='all'>All statuses</option>
                  <option value='active'>Active</option>
                  <option value='disabled'>Disabled</option>
                </select>
              </div>
              <div className='flex min-h-9 items-center gap-2'>
                <Checkbox
                  id='include-deleted'
                  checked={includeDeleted}
                  onCheckedChange={(checked) => {
                    setIncludeDeleted(checked === true)
                    setOffset(0)
                  }}
                />
                <Label htmlFor='include-deleted'>Include deleted</Label>
              </div>
              <Button
                variant='outline'
                className='ms-auto'
                disabled={query.isFetching}
                onClick={() => query.refetch()}
              >
                <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
                Refresh
              </Button>
            </div>
            <div
              className='overflow-hidden rounded-lg border'
              aria-busy={query.isFetching}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-[38%] px-4'>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='hidden lg:table-cell'>
                      Created
                    </TableHead>
                    <TableHead className='px-4 text-right'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.isPending ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className='py-12 text-center text-muted-foreground'
                        role='status'
                      >
                        Loading users…
                      </TableCell>
                    </TableRow>
                  ) : query.isError ? (
                    <TableRow>
                      <TableCell colSpan={5} className='p-6'>
                        <div
                          role='alert'
                          className='flex flex-wrap items-center justify-between gap-3 text-sm'
                        >
                          <span>{userError(query.error)}</span>
                          <Button
                            variant='outline'
                            onClick={() => query.refetch()}
                          >
                            Retry
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : users.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className='py-12 text-center text-muted-foreground'
                      >
                        No users match these filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className='px-4 py-4'>
                          <button
                            className='text-left font-medium break-all underline-offset-4 hover:underline'
                            onClick={() =>
                              setSelection({ id: user.id, mode: 'view' })
                            }
                          >
                            {user.display_name || user.username}
                            <span className='sr-only'>
                              {' '}
                              — view user details
                            </span>
                          </button>
                          <div className='mt-0.5 text-xs break-all text-muted-foreground'>
                            {user.username}
                            {user.id === currentUser?.id && ' · You'}
                          </div>
                        </TableCell>
                        <TableCell>{ROLE_LABEL[user.role]}</TableCell>
                        <TableCell>
                          <span className='inline-flex items-center gap-2 text-sm whitespace-nowrap'>
                            <span
                              aria-hidden
                              className={`size-1.5 rounded-full ${user.deleted_at || user.status === 'disabled' ? 'bg-muted-foreground/60' : 'bg-emerald-600'}`}
                            />
                            {user.deleted_at
                              ? 'Deleted'
                              : user.status === 'active'
                                ? 'Active'
                                : 'Disabled'}
                          </span>
                        </TableCell>
                        <TableCell className='hidden text-muted-foreground lg:table-cell'>
                          {new Date(user.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className='px-4'>
                          <div className='hidden justify-end gap-1 sm:flex'>
                            {user.deleted_at ? (
                              <Button
                                size='sm'
                                variant='ghost'
                                onClick={() =>
                                  setSelection({ id: user.id, mode: 'view' })
                                }
                                aria-label={`View ${user.username}`}
                              >
                                View
                              </Button>
                            ) : (
                              <>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  onClick={() =>
                                    setSelection({ id: user.id, mode: 'edit' })
                                  }
                                  aria-label={`Edit ${user.username}`}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  disabled={user.id === currentUser?.id}
                                  title={
                                    user.id === currentUser?.id
                                      ? 'You cannot delete your own account.'
                                      : undefined
                                  }
                                  onClick={() => {
                                    setDeleting(user)
                                    setDeleteError('')
                                  }}
                                  aria-label={`Delete ${user.username}`}
                                >
                                  Delete
                                </Button>
                              </>
                            )}
                          </div>
                          <div className='flex justify-end sm:hidden'>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  aria-label={`Actions for ${user.username}`}
                                >
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align='end'>
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setSelection({ id: user.id, mode: 'view' })
                                  }
                                >
                                  View details
                                </DropdownMenuItem>
                                {!user.deleted_at && (
                                  <>
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        setSelection({
                                          id: user.id,
                                          mode: 'edit',
                                        })
                                      }
                                    >
                                      Edit user
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={user.id === currentUser?.id}
                                      onSelect={() => {
                                        setDeleting(user)
                                        setDeleteError('')
                                      }}
                                    >
                                      Delete user
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className='mt-4 flex flex-wrap items-center justify-between gap-3 text-sm'>
              <p className='text-muted-foreground' role='status'>
                {query.isError
                  ? 'User list unavailable'
                  : query.isPending
                    ? 'Loading…'
                    : users.length
                      ? `${offset + 1}–${offset + users.length}${total != null ? ` of ${total}` : ''} users`
                      : '0 users'}
              </p>
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={offset === 0 || query.isFetching}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={
                    query.isFetching ||
                    query.isError ||
                    (total != null
                      ? offset + PAGE_SIZE >= total
                      : users.length < PAGE_SIZE)
                  }
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
            <p className='mt-4 text-xs leading-relaxed text-muted-foreground'>
              The last active Admin cannot be disabled, demoted, or deleted.
              Your own account cannot be deleted. Deleted accounts remain
              available for review with “Include deleted”.
            </p>
            {selection && (
              <UserDialog
                key={
                  selection.mode === 'create'
                    ? 'create'
                    : `${selection.id}-${selection.mode}`
                }
                selection={selection}
                currentUserId={currentUser?.id}
                onClose={() => setSelection(null)}
                onEdit={(id) => setSelection({ id, mode: 'edit' })}
                onSave={save}
              />
            )}
            <ConfirmDialog
              open={!!deleting}
              onOpenChange={(open) => {
                if (!open && !deletePending) setDeleting(null)
              }}
              title={`Delete ${deleting?.username ?? 'user'}?`}
              desc='This soft-deletes the account, disables access, and revokes refresh sessions. Its record remains in the database. There is no restore action in the current API.'
              confirmText={deletePending ? 'Deleting…' : 'Delete user'}
              destructive
              isLoading={deletePending}
              handleConfirm={remove}
            >
              {deleteError && (
                <p role='alert' className='text-sm text-destructive'>
                  {deleteError}
                </p>
              )}
            </ConfirmDialog>
          </>
        )}
      </Main>
    </>
  )
}
