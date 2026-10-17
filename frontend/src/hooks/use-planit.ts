import { useEffect, useMemo } from 'react'
import {
  type SiteConditions,
  alertSeverityRank,
  computeSiteRiskBundle,
} from '@/api/mock/engine'
import { SITE_SEED } from '@/api/mock/sites-data'
import { type Alert, type Site, type SiteRisk } from '@/api/types'
import { useLiveStore } from '@/stores/live-store'

/**
 * Realtime hooks. They derive the fused risk picture from the live strike feed
 * and the current clock, exactly the way a websocket push would.
 */

export interface SiteBundle {
  site: Site
  risk: SiteRisk
  conditions: SiteConditions
  alerts: Alert[]
}

const RISK_BUCKET_MS = 20000

export function usePlanitLiveFeed(): void {
  useEffect(() => {
    const store = useLiveStore.getState()
    store.start()
    return () => store.stop()
  }, [])
}

export function useLiveNow(): number {
  return useLiveStore((state) => state.now)
}

export function useLiveStrikes() {
  return useLiveStore((state) => state.strikes)
}

export function useSimulateStrike() {
  return useLiveStore((state) => state.simulateStrike)
}

export function useSiteBundles(): SiteBundle[] {
  const now = useLiveStore((state) => state.now)
  const strikes = useLiveStore((state) => state.strikes)
  const bucket = Math.floor(now / RISK_BUCKET_MS) * RISK_BUCKET_MS

  return useMemo(
    () =>
      SITE_SEED.map((site) => {
        const bundle = computeSiteRiskBundle(site, { now: bucket, strikes })
        return { site, ...bundle }
      }),
    [bucket, strikes]
  )
}

export function useSiteBundle(
  siteId: string | undefined
): SiteBundle | undefined {
  const bundles = useSiteBundles()
  return useMemo(
    () => bundles.find((bundle) => bundle.site.id === siteId),
    [bundles, siteId]
  )
}

export interface RankedAlert extends Alert {
  site: Site
}

/** Active alerts across the fleet, most severe first, then most recent. */
export function useActiveAlerts(): RankedAlert[] {
  const bundles = useSiteBundles()
  return useMemo(
    () =>
      bundles
        .flatMap((bundle) =>
          bundle.alerts.map((alert) => ({ ...alert, site: bundle.site }))
        )
        .sort(
          (a, b) =>
            alertSeverityRank(b.severity) - alertSeverityRank(a.severity) ||
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
    [bundles]
  )
}

/** Seconds remaining until an alert clears (lightning all-clear countdown). */
export function useCountdown(isoTime: string | undefined): number {
  const now = useLiveStore((state) => state.now)
  return useMemo(() => {
    if (!isoTime) return 0
    return Math.max(0, Math.floor((new Date(isoTime).getTime() - now) / 1000))
  }, [isoTime, now])
}
