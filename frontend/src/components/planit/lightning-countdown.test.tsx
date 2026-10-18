import '@/styles/index.css'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { LightningCountdown } from './lightning-countdown'

const countdown = vi.hoisted(() => ({ remaining: 0 }))
vi.mock('@/hooks/use-planit', () => ({
  useCountdown: () => countdown.remaining,
}))

describe('LightningCountdown responsive layout', () => {
  it.each(['inline', 'ring'] as const)(
    'wraps the full sign-off message in a narrow %s layout',
    async (variant) => {
      countdown.remaining = 0
      const screen = await render(
        <div data-testid='viewport' style={{ width: 180 }}>
          <LightningCountdown
            allClearAt='2026-10-17T12:00:00Z'
            variant={variant}
          />
        </div>
      )

      await expect
        .element(
          screen.getByText('All-clear eligible · admin sign-off required')
        )
        .toBeVisible()
      const viewport = document.querySelector<HTMLElement>(
        '[data-testid="viewport"]'
      )!
      expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
    }
  )

  it('keeps the active countdown and progress bar within a narrow alert', async () => {
    countdown.remaining = 300
    const screen = await render(
      <div data-testid='viewport' style={{ width: 180 }}>
        <LightningCountdown
          allClearAt='2026-10-17T12:00:00Z'
          variant='inline'
        />
      </div>
    )

    await expect.element(screen.getByText(/All-clear in/)).toBeVisible()
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="viewport"]'
    )!
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  })
})
