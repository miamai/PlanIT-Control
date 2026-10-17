import { useState } from 'react'
import { z } from 'zod'
import {
  type CreateUser,
  type ManagedUser,
  type UpdateUser,
} from '@/api/admin-users'
import { ROLE_LABEL } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { buildUserUpdate, userError } from './utils'

const formSchema = z.object({
  username: z
    .string()
    .min(1, 'Enter a username.')
    .max(64)
    .regex(
      /^[A-Za-z0-9_.-]+$/,
      'Use letters, numbers, periods, underscores, or hyphens.'
    ),
  display_name: z.string().trim().max(120),
  role: z.enum(['user', 'admin']),
  status: z.enum(['active', 'disabled']),
  password: z.string().max(256),
})

type Values = z.infer<typeof formSchema>

export function UserForm({
  user,
  isSelf,
  onSave,
  onCancel,
  onPendingChange,
}: {
  user?: ManagedUser
  isSelf: boolean
  onSave: (body: CreateUser | UpdateUser) => Promise<void>
  onCancel: () => void
  onPendingChange?: (pending: boolean) => void
}) {
  const [values, setValues] = useState<Values>({
    username: user?.username ?? '',
    display_name: user?.display_name ?? '',
    role: user?.role ?? 'user',
    status: user?.status ?? 'active',
    password: '',
  })
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>(
    {}
  )
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const securityChange =
    !!user &&
    (values.role !== user.role ||
      (values.status === 'disabled' && user.status !== 'disabled') ||
      !!values.password)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = formSchema.safeParse(values)
    const nextErrors: typeof errors = {}
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        nextErrors[issue.path[0] as keyof Values] ??= issue.message
    if ((!user || values.password) && values.password.length < 8)
      nextErrors.password = 'Use at least 8 characters.'
    setErrors(nextErrors)
    setError('')
    if (!parsed.success || Object.keys(nextErrors).length) return
    const body = user
      ? buildUserUpdate(user, parsed.data)
      : {
          username: parsed.data.username,
          display_name: parsed.data.display_name || null,
          password: parsed.data.password,
          role: parsed.data.role,
        }
    if (user && Object.keys(body).length === 0) {
      onCancel()
      return
    }
    setPending(true)
    onPendingChange?.(true)
    try {
      await onSave(body)
    } catch (failure) {
      setError(userError(failure))
    } finally {
      setPending(false)
      onPendingChange?.(false)
    }
  }

  function field(
    name: keyof Values,
    label: string,
    props: React.ComponentProps<typeof Input> = {}
  ) {
    return (
      <div className='space-y-2'>
        <Label htmlFor={`user-${name}`}>{label}</Label>
        <Input
          id={`user-${name}`}
          value={values[name]}
          onChange={(event) =>
            setValues({ ...values, [name]: event.target.value })
          }
          aria-invalid={!!errors[name]}
          aria-describedby={errors[name] ? `user-${name}-error` : undefined}
          {...props}
        />
        {errors[name] && (
          <p id={`user-${name}-error`} className='text-sm text-destructive'>
            {errors[name]}
          </p>
        )}
      </div>
    )
  }

  return (
    <form noValidate onSubmit={submit} className='space-y-5'>
      <fieldset disabled={pending} className='space-y-5 disabled:opacity-70'>
        {field('username', 'Username', {
          disabled: !!user,
          autoComplete: 'off',
          maxLength: 64,
        })}
        {user && (
          <p className='-mt-3 text-xs text-muted-foreground'>
            Usernames cannot be changed.
          </p>
        )}
        {field('display_name', 'Display name (optional)', {
          maxLength: 120,
          autoComplete: 'off',
        })}
        <div className='grid grid-cols-2 gap-4'>
          <div className='space-y-2'>
            <Label htmlFor='user-role'>Role</Label>
            <select
              id='user-role'
              className='h-10 w-full rounded-md border bg-background px-3 text-sm'
              value={values.role}
              onChange={(event) =>
                setValues({
                  ...values,
                  role: event.target.value as Values['role'],
                })
              }
            >
              {Object.entries(ROLE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {user && (
            <div className='space-y-2'>
              <Label htmlFor='user-status'>Status</Label>
              <select
                id='user-status'
                className='h-10 w-full rounded-md border bg-background px-3 text-sm'
                value={values.status}
                onChange={(event) =>
                  setValues({
                    ...values,
                    status: event.target.value as Values['status'],
                  })
                }
              >
                <option value='active'>Active</option>
                <option value='disabled'>Disabled</option>
              </select>
            </div>
          )}
        </div>
        {field(
          'password',
          user ? 'New password (optional)' : 'Initial password',
          { type: 'password', autoComplete: 'new-password', maxLength: 256 }
        )}
        <p className='-mt-3 text-xs leading-relaxed text-muted-foreground'>
          {user ? 'Leave blank to keep the current password. ' : ''}Passwords
          must contain at least 8 characters.
        </p>
        {securityChange && (
          <p className='rounded-md border border-amber-500/40 p-3 text-sm leading-relaxed'>
            {isSelf
              ? 'This change will end your session. You will need to sign in again.'
              : 'Changing the role or password, or disabling this account, revokes its refresh sessions. The user will need to sign in again.'}
          </p>
        )}
      </fieldset>
      {error && (
        <p
          role='alert'
          className='rounded-md border border-destructive/30 p-3 text-sm text-destructive'
        >
          {error}
        </p>
      )}
      <div className='flex justify-end gap-2 border-t pt-4'>
        <Button
          type='button'
          variant='outline'
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type='submit' disabled={pending}>
          {pending ? 'Saving…' : user ? 'Save changes' : 'Create user'}
        </Button>
      </div>
    </form>
  )
}
