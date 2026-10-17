import { clearCookies } from '@/test-utils/cookies'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { getCookie } from '@/lib/cookies'
import { ThemeProvider, useTheme } from './theme-provider'

function ThemeProbe() {
  const { theme, resolvedTheme, setTheme, resetTheme } = useTheme()
  return (
    <>
      <output data-testid='theme'>
        {theme}:{resolvedTheme}
      </output>
      <button onClick={() => setTheme('light')}>Light theme</button>
      <button onClick={resetTheme}>Reset theme</button>
    </>
  )
}

beforeEach(() => clearCookies())
afterEach(() => {
  vi.unstubAllGlobals()
  clearCookies()
})

describe('theme provider', () => {
  it('keeps resolved theme in sync with system changes', async () => {
    let dark = false
    const media = new EventTarget()
    Object.defineProperty(media, 'matches', { get: () => dark })
    vi.stubGlobal('matchMedia', () => media)
    const screen = await render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    )
    await expect
      .element(screen.getByTestId('theme'))
      .toHaveTextContent('system:light')
    dark = true
    media.dispatchEvent(new Event('change'))
    await expect
      .element(screen.getByTestId('theme'))
      .toHaveTextContent('system:dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('resets to the configured default rather than always choosing system', async () => {
    const screen = await render(
      <ThemeProvider defaultTheme='dark'>
        <ThemeProbe />
      </ThemeProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Light theme' }))
    expect(getCookie('vite-ui-theme')).toBe('light')
    await userEvent.click(screen.getByRole('button', { name: 'Reset theme' }))
    await expect
      .element(screen.getByTestId('theme'))
      .toHaveTextContent('dark:dark')
    expect(getCookie('vite-ui-theme')).toBeUndefined()
  })
})
