import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ApiError } from '@/api/client'
import { PasswordForm } from './password-form'

const mocks = vi.hoisted(() => ({ change: vi.fn() }))
vi.mock('@/api/auth', () => ({ changePassword: mocks.change }))
vi.mock('@/lib/toast', () => ({ toastSuccess: vi.fn() }))
beforeEach(() => {
  mocks.change.mockReset()
})
async function setup() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <PasswordForm />
    </QueryClientProvider>
  )
}
async function fill(
  screen: Awaited<ReturnType<typeof setup>>,
  next = 'New-valid-password',
  confirm = next
) {
  await userEvent.fill(
    screen.getByLabelText('Current password', { exact: true }),
    'Current-test-password'
  )
  await userEvent.fill(
    screen.getByLabelText('New password', { exact: true }),
    next
  )
  await userEvent.fill(
    screen.getByLabelText('Confirm new password', { exact: true }),
    confirm
  )
}
describe('Password form', () => {
  it.each([
    ['short', 'short', 'Use 8–256'],
    ['New-valid-password', 'different-password', 'do not match'],
    ['Current-test-password', 'Current-test-password', 'different from'],
  ])(
    'validates %s without sending a request',
    async (next, confirm, message) => {
      const screen = await setup()
      await fill(screen, next, confirm)
      await userEvent.click(
        screen.getByRole('button', { name: 'Change password', exact: true })
      )
      await expect.element(screen.getByRole('alert')).toHaveTextContent(message)
      expect(mocks.change).not.toHaveBeenCalled()
    }
  )
  it('shows a wrong-current-password error and retains the session form', async () => {
    mocks.change.mockRejectedValue(
      new ApiError(401, 'Incorrect password', 'Current password is incorrect')
    )
    const screen = await setup()
    await fill(screen)
    await userEvent.click(
      screen.getByRole('button', { name: 'Change password', exact: true })
    )
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Current password is incorrect')
    await expect
      .element(screen.getByLabelText('New password', { exact: true }))
      .toBeVisible()
  })
  it('submits exactly the current and new passwords and clears secrets after success', async () => {
    mocks.change.mockResolvedValue({})
    const screen = await setup()
    await fill(screen)
    await userEvent.click(
      screen.getByRole('button', { name: 'Change password', exact: true })
    )
    await vi.waitFor(() =>
      expect(mocks.change).toHaveBeenCalledWith(
        'Current-test-password',
        'New-valid-password'
      )
    )
    await expect
      .element(screen.getByLabelText('Current password', { exact: true }))
      .toHaveValue('')
    await expect
      .element(screen.getByLabelText('New password', { exact: true }))
      .toHaveValue('')
  })
})
