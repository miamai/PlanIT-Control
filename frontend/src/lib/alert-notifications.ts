import type { Alert, AlertSeverity } from '@/api/types'

const severityRank: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
}
export type AlertSnapshot = Map<string, Pick<Alert, 'severity' | 'allClearAt'>>

/**
 * Notify on arrival, escalation, or a new lightning strike, not ordinary clock
 * ticks. The core API moves a lightning alert's all-clear time forward on every
 * newer qualifying strike, so a changed `allClearAt` means a new strike.
 */
export function getAlertNotifications<T extends Alert>(
  alerts: T[],
  previous: AlertSnapshot,
  minimumSeverity: AlertSeverity
): T[] {
  return alerts.filter((alert) => {
    const before = previous.get(alert.id)
    const changed =
      !before ||
      severityRank[alert.severity] > severityRank[before.severity] ||
      (alert.type === 'lightning' && alert.allClearAt !== before.allClearAt)
    return (
      alert.status === 'active' &&
      severityRank[alert.severity] >= severityRank[minimumSeverity] &&
      changed
    )
  })
}
