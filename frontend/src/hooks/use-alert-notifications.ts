import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { usePreferencesStore } from '@/stores/preferences-store'
import {
  getAlertNotifications,
  type AlertSnapshot,
} from '@/lib/alert-notifications'
import { useActiveAlerts } from './use-planit'

export function useAlertNotifications() {
  const { alerts, isLoading } = useActiveAlerts()
  // The first loaded snapshot is the baseline; only later changes notify.
  const ready = !isLoading
  const preferences = usePreferencesStore((state) => state.notifications)
  const previous = useRef<AlertSnapshot | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!ready) {
      previous.current = null
      return
    }
    const notices = previous.current
      ? getAlertNotifications(
          alerts,
          previous.current,
          preferences.minimumSeverity
        )
      : []
    previous.current = new Map(
      alerts.map((alert) => [
        alert.id,
        { severity: alert.severity, allClearAt: alert.allClearAt },
      ])
    )
    if (!preferences.enabled || notices.length === 0) return
    const first = notices[0]
    const title =
      notices.length === 1
        ? `${first.site.name}: ${first.title}`
        : `${notices.length} new or updated safety alerts`
    const description =
      notices.length === 1
        ? first.action
        : 'Review the affected sites and required actions in Alerts.'
    const notify = notices.some((alert) => alert.severity === 'critical')
      ? toast.error
      : toast.warning
    notify(title, {
      description,
      duration: 8000,
      action: {
        label: 'View alerts',
        onClick: () => navigate({ to: '/alerts' }),
      },
    })
  }, [
    alerts,
    ready,
    preferences.enabled,
    preferences.minimumSeverity,
    navigate,
  ])
}
