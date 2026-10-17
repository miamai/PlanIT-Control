import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ProfileForm } from './profile-form'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/hooks/use-profile', () => ({
  useProfile: () => ({
    name: 'Dana Reyes',
    bio: '',
    username: 'dana',
  }),
}))
vi.mock('@/stores/preferences-store', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/stores/preferences-store')>()
  return {
    ...actual,
    usePreferencesStore: (
      selector: (value: { saveProfile: typeof mocks.save }) => unknown
    ) => selector({ saveProfile: mocks.save }),
  }
})
vi.mock('@/lib/toast', () => ({
  toastSuccess: mocks.success,
  toastError: mocks.error,
}))
beforeEach(() => {
  vi.resetAllMocks()
})

describe('profile saving', () => {
  it('saves a valid display name with the current identity', async () => {
    const screen = await render(<ProfileForm />)
    await userEvent.fill(
      screen.getByLabelText('Display name'),
      'Field Supervisor'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(mocks.save).toHaveBeenCalledWith('dana', {
      name: 'Field Supervisor',
      bio: '',
    })
    expect(mocks.success).toHaveBeenCalledWith('Profile saved on this browser')
  })

  it('shows a storage failure without claiming the profile was saved', async () => {
    mocks.save.mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    const screen = await render(<ProfileForm />)
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(mocks.error).toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('rejects a blank display name before saving', async () => {
    const screen = await render(<ProfileForm />)
    await userEvent.fill(screen.getByLabelText('Display name'), ' ')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await expect
      .element(screen.getByText('Name must contain at least 2 characters.'))
      .toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
