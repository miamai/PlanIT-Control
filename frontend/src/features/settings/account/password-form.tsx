import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { changePassword } from '@/api/auth'
import { ApiError } from '@/api/client'
import { toastSuccess } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/password-input'

export function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [validation, setValidation] = useState('')
  const mutation = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      setValidation('')
      toastSuccess(
        'Password changed',
        'This session has been renewed. Other sessions must sign in again.'
      )
    },
  })
  function submit(event: React.FormEvent) {
    event.preventDefault()
    mutation.reset()
    if (!current) return setValidation('Enter your current password.')
    if (next.length < 8 || next.length > 256)
      return setValidation('Use 8–256 characters for the new password.')
    if (next === current)
      return setValidation(
        'Choose a password different from your current password.'
      )
    if (next !== confirm) return setValidation('New passwords do not match.')
    setValidation('')
    mutation.mutate()
  }
  return (
    <form
      onSubmit={submit}
      className='max-w-lg space-y-4 rounded-lg border p-4'
    >
      <div>
        <h3 className='font-semibold'>Change password</h3>
        <p className='mt-1 text-sm text-muted-foreground'>
          Changing your password signs out other sessions and renews this one.
        </p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='current-password'>Current password</Label>
        <PasswordInput
          id='current-password'
          autoComplete='current-password'
          maxLength={256}
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          disabled={mutation.isPending}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='new-password'>New password</Label>
        <PasswordInput
          id='new-password'
          autoComplete='new-password'
          maxLength={256}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          disabled={mutation.isPending}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='confirm-password'>Confirm new password</Label>
        <PasswordInput
          id='confirm-password'
          autoComplete='new-password'
          maxLength={256}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={mutation.isPending}
        />
      </div>
      {validation || mutation.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          {validation ||
            (mutation.error instanceof ApiError
              ? mutation.error.detail || mutation.error.message
              : 'Could not change your password. Please try again.')}
        </p>
      ) : null}
      <Button type='submit' disabled={mutation.isPending}>
        {mutation.isPending ? 'Updating password…' : 'Change password'}
      </Button>
    </form>
  )
}
