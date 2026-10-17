import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { type CreateUser, type UpdateUser, getUser } from '@/api/admin-users'
import { ROLE_LABEL } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { UserForm } from './user-form'
import { userError } from './utils'

export type UserSelection =
  | { id: string; mode: 'view' | 'edit' }
  | { mode: 'create' }

export function UserDialog({
  selection,
  currentUserId,
  onClose,
  onEdit,
  onSave,
}: {
  selection: UserSelection
  currentUserId?: string
  onClose: () => void
  onEdit: (id: string) => void
  onSave: (body: CreateUser | UpdateUser) => Promise<void>
}) {
  const id = selection.mode === 'create' ? '' : selection.id
  const [pending, setPending] = useState(false)
  const query = useQuery({
    queryKey: ['admin-users', 'detail', id],
    queryFn: () => getUser(id),
    enabled: !!id,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const user = query.data
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        className='max-h-[90svh] overflow-y-auto'
      >
        <DialogHeader>
          <DialogTitle>
            {selection.mode === 'create'
              ? 'Create user'
              : selection.mode === 'edit'
                ? 'Edit user'
                : 'User details'}
          </DialogTitle>
          <DialogDescription>
            {selection.mode === 'create'
              ? 'Create a User or Admin account.'
              : 'Account details and permissions from the server.'}
          </DialogDescription>
        </DialogHeader>
        {selection.mode !== 'create' && query.isFetching ? (
          <p role='status' className='py-6 text-sm text-muted-foreground'>
            Loading user…
          </p>
        ) : null}
        {selection.mode !== 'create' && query.isError ? (
          <div role='alert' className='space-y-3 text-sm'>
            <p>{userError(query.error)}</p>
            <Button variant='outline' onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}
        {selection.mode === 'create' ||
        (user && !query.isError && !query.isFetching) ? (
          selection.mode === 'view' && user ? (
            <>
              <dl className='divide-y text-sm'>
                {[
                  ['Username', user.username],
                  ['Display name', user.display_name || 'Not set'],
                  ['Role', ROLE_LABEL[user.role]],
                  [
                    'Status',
                    user.deleted_at
                      ? 'Deleted'
                      : user.status === 'active'
                        ? 'Active'
                        : 'Disabled',
                  ],
                  ['User ID', user.id],
                  ['Created', new Date(user.created_at).toLocaleString()],
                  ['Updated', new Date(user.updated_at).toLocaleString()],
                  ...(user.deleted_at
                    ? [['Deleted', new Date(user.deleted_at).toLocaleString()]]
                    : []),
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className='grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)]'
                  >
                    <dt className='text-muted-foreground'>{label}</dt>
                    <dd className='break-words'>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className='flex justify-end gap-2'>
                <Button variant='outline' onClick={onClose}>
                  Close
                </Button>
                {!user.deleted_at && (
                  <Button onClick={() => onEdit(user.id)}>Edit user</Button>
                )}
              </div>
            </>
          ) : (
            <UserForm
              user={user}
              isSelf={user?.id === currentUserId}
              onSave={onSave}
              onCancel={onClose}
              onPendingChange={setPending}
            />
          )
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
