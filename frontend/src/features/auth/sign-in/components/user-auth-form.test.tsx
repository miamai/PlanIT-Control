import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { ApiError } from '@/api/client'
import { UserAuthForm } from './user-auth-form'

const FORM_MESSAGES = {
  usernameEmpty: 'Please enter your username.',
  passwordEmpty: 'Please enter your password.',
  invalid: 'Invalid username or password.',
} as const

const navigate = vi.fn()
const login = vi.fn()

vi.mock('@/api/auth', () => ({
  login: (...args: unknown[]) => login(...args),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => navigate,
  }
})

const session = {
  access_token: 'token',
  token_type: 'bearer',
  expires_in: 900,
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'admin',
    display_name: null,
    role: 'admin',
    status: 'active',
    created_at: '2026-10-17T00:00:00Z',
    updated_at: '2026-10-17T00:00:00Z',
    deleted_at: null,
  },
}

describe('UserAuthForm', () => {
  describe('Rendering without redirectTo', () => {
    let screen: RenderResult
    let usernameInput: Locator
    let passwordInput: Locator
    let signInButton: Locator

    beforeEach(async () => {
      vi.clearAllMocks()
      screen = await render(<UserAuthForm />)
      usernameInput = screen.getByRole('textbox', { name: /^Username$/i })
      passwordInput = screen.getByLabelText(/^Password$/i)
      signInButton = screen.getByRole('button', { name: /^Sign in$/i })
    })

    it('renders fields and submit button', async () => {
      await expect.element(usernameInput).toBeInTheDocument()
      await expect.element(passwordInput).toBeInTheDocument()
      await expect.element(signInButton).toBeInTheDocument()
    })

    it('shows validation messages when submitting empty form', async () => {
      await userEvent.click(signInButton)

      await expect
        .element(screen.getByText(FORM_MESSAGES.usernameEmpty))
        .toBeInTheDocument()
      await expect
        .element(screen.getByText(FORM_MESSAGES.passwordEmpty))
        .toBeInTheDocument()
      expect(login).not.toHaveBeenCalled()
    })

    it('logs in with the API and navigates to the default route', async () => {
      login.mockResolvedValueOnce(session)
      await userEvent.fill(usernameInput, 'admin')
      await userEvent.fill(passwordInput, 'secret-pass')

      await userEvent.click(signInButton)

      await vi.waitFor(() =>
        expect(login).toHaveBeenCalledWith('admin', 'secret-pass')
      )
      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
      )
    })

    it('shows an inline error when the API rejects the credentials', async () => {
      login.mockRejectedValueOnce(
        new ApiError(401, 'Invalid username or password')
      )
      await userEvent.fill(usernameInput, 'admin')
      await userEvent.fill(passwordInput, 'wrong-pass')

      await userEvent.click(signInButton)

      await expect
        .element(screen.getByText(FORM_MESSAGES.invalid))
        .toBeInTheDocument()
      expect(navigate).not.toHaveBeenCalled()
    })
  })

  it('navigates to redirectTo when provided', async () => {
    vi.clearAllMocks()
    login.mockResolvedValueOnce(session)

    const { getByRole, getByLabelText } = await render(
      <UserAuthForm redirectTo='/settings' />
    )

    await userEvent.fill(getByRole('textbox', { name: /Username/i }), 'admin')
    await userEvent.fill(getByLabelText('Password'), 'secret-pass')

    await userEvent.click(getByRole('button', { name: /Sign in/i }))

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/settings',
        replace: true,
      })
    )
  })
})
