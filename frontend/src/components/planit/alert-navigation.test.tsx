import { type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { type Alert } from '@/api/types'
import { AlertItem } from './alert-item'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    hash,
  }: {
    children: ReactNode
    params: { siteId: string }
    hash?: string
  }) => (
    <a href={`/sites/${params.siteId}${hash ? `#${hash}` : ''}`}>{children}</a>
  ),
}))
vi.mock('./alert-controls', () => ({
  AlertControls: () => <button>Resolve alert</button>,
}))
const alert: Alert = {
  id: 'a',
  siteId: 's',
  type: 'heat',
  severity: 'warning',
  status: 'active',
  title: 'High heat warning',
  message: 'Site warning',
  action: 'Follow heat plan',
  createdAt: '2026-10-18T00:00:00Z',
}
describe('Alert detail navigation', () => {
  it('makes the title a specific link without nesting action buttons', async () => {
    const screen = await render(<AlertItem alert={alert} />)
    await expect
      .element(screen.getByRole('link', { name: /High heat warning/ }))
      .toHaveAttribute('href', '/sites/s#alerts')
    const button = screen.getByRole('button', { name: 'Resolve alert' })
    await expect.element(button).toBeVisible()
    expect(document.querySelector('button')?.closest('a')).toBeNull()
  })
})
