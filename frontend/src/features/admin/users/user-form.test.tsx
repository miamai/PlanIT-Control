import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { type ManagedUser } from '@/api/admin-users'
import { ApiError } from '@/api/client'
import { UserForm } from './user-form'
import { buildUserUpdate, revokesSession } from './utils'

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

describe('user management form', () => {
  it('rejects invalid usernames and short passwords without an API call', async () => {
    const save = vi.fn()
    const screen = await render(
      <UserForm isSelf={false} onSave={save} onCancel={() => {}} />
    )
    await userEvent.fill(screen.getByLabelText('Username'), 'invalid user')
    await userEvent.fill(screen.getByLabelText('Initial password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))
    await expect
      .element(screen.getByText('Use at least 8 characters.'))
      .toBeVisible()
    expect(save).not.toHaveBeenCalled()
  })
  it('submits a new account with the selected admin role', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const screen = await render(
      <UserForm isSelf={false} onSave={save} onCancel={() => {}} />
    )
    await userEvent.fill(screen.getByLabelText('Username'), 'test.admin')
    await userEvent.fill(
      screen.getByLabelText('Initial password'),
      'Test-only-password'
    )
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'admin')
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))
    expect(save).toHaveBeenCalledWith({
      username: 'test.admin',
      display_name: null,
      password: 'Test-only-password',
      role: 'admin',
    })
  })
  it('does not resend role, status, or password for a display-name edit', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const screen = await render(
      <UserForm user={admin} isSelf onSave={save} onCancel={() => {}} />
    )
    await userEvent.fill(
      screen.getByLabelText('Display name (optional)'),
      'New name'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(save).toHaveBeenCalledWith({ display_name: 'New name' })
  })
  it('keeps a failed edit open and displays the server protection', async () => {
    const save = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'Conflict', 'The last active admin cannot be changed')
      )
    const screen = await render(
      <UserForm user={admin} isSelf onSave={save} onCancel={() => {}} />
    )
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'user')
    await expect
      .element(
        screen.getByText(
          'This change will end your session. You will need to sign in again.'
        )
      )
      .toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('The last active admin cannot be changed')
    await expect
      .element(screen.getByRole('button', { name: 'Save changes' }))
      .toBeEnabled()
  })
  it('clears an optional name and sends an intentional password reset', () => {
    expect(
      buildUserUpdate(admin, {
        display_name: '',
        role: 'admin',
        status: 'active',
        password: 'new-test-password',
      })
    ).toEqual({ display_name: null, password: 'new-test-password' })
    expect(revokesSession({ display_name: 'New name' })).toBe(false)
    expect(revokesSession({ role: 'user' })).toBe(true)
    expect(revokesSession({ status: 'disabled' })).toBe(true)
    expect(revokesSession({ status: 'active' })).toBe(false)
  })
})
