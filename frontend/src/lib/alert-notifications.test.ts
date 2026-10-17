import { describe, expect, it } from 'vitest'
import type { Alert } from '@/api/types'
import {
  getAlertNotifications,
  type AlertSnapshot,
} from './alert-notifications'

const alert: Alert = {
  id: 'heat-1',
  siteId: 'SITE-001',
  type: 'heat',
  severity: 'warning',
  status: 'active',
  title: 'Heat advisory',
  message: 'Heat index 102°F',
  action: 'Take rest breaks',
  createdAt: '2026-10-17T12:00:00Z',
}
const previous: AlertSnapshot = new Map([
  [alert.id, { severity: alert.severity }],
])

describe('alert banner events', () => {
  it('notifies for new alerts at the selected severity without changing the alert feed', () => {
    const notices = getAlertNotifications([alert], new Map(), 'warning')
    expect(notices).toEqual([alert])
    expect(getAlertNotifications([alert], new Map(), 'critical')).toEqual([])
    expect(alert.status).toBe('active')
  })

  it('does not repeat a notice on clock ticks or routine timestamp changes', () => {
    expect(
      getAlertNotifications(
        [{ ...alert, createdAt: '2026-10-17T12:00:20Z' }],
        previous,
        'info'
      )
    ).toEqual([])
  })

  it('notifies on escalation but not de-escalation', () => {
    expect(
      getAlertNotifications(
        [{ ...alert, severity: 'critical' }],
        previous,
        'critical'
      )
    ).toHaveLength(1)
    expect(
      getAlertNotifications([{ ...alert, severity: 'info' }], previous, 'info')
    ).toEqual([])
  })

  it('notifies once for a new lightning strike that resets the countdown', () => {
    const lightning: Alert = {
      ...alert,
      type: 'lightning',
      allClearAt: '2026-10-17T12:35:00Z',
    }
    const before: AlertSnapshot = new Map([
      [alert.id, { severity: 'warning', allClearAt: '2026-10-17T12:30:00Z' }],
    ])
    expect(getAlertNotifications([lightning], before, 'warning')).toHaveLength(
      1
    )
    const seen: AlertSnapshot = new Map([
      [alert.id, { severity: 'warning', allClearAt: lightning.allClearAt }],
    ])
    expect(getAlertNotifications([lightning], seen, 'warning')).toEqual([])
  })

  it('never treats resolved alerts as new active warnings', () => {
    expect(
      getAlertNotifications(
        [{ ...alert, status: 'resolved' }],
        new Map(),
        'info'
      )
    ).toEqual([])
  })
})
