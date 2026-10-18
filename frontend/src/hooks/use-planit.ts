import { useEffect, useMemo } from 'react'
import { format, subDays } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getHazardIndexHistory,
  getSite,
  getSiteRisk,
  listAlerts,
  listBriefingRows,
  listHazardReports,
  listSiteHazards,
  listSiteRisks,
  listSites,
  listStrikes,
} from '@/api'
import {
  buildBriefingHistory,
  buildDomains,
  buildFleetBriefing,
  buildTimeline,
  toSiteStrikes,
  trendFromHistory,
} from '@/api/mappers'
import { connectPlanitStream } from '@/api/stream'
import {
  type Alert,
  type AlertSeverity,
  type Site,
  type SiteRisk,
} from '@/api/types'
import { hasRole, useAuthStore } from '@/stores/auth-store'
import { useLiveStore } from '@/stores/live-store'

/**
 * Data hooks over the core API. Queries poll as a fallback; the SSE stream
 * started by `usePlanitLiveFeed` invalidates them as soon as anything changes.
 */

export const planitKeys = {
  rankings: ['rankings'] as const,
  sites: ['sites'] as const,
  alerts: ['alerts'] as const,
  strikes: ['strikes'] as const,
  briefings: ['briefings'] as const,
  reports: (siteId?: string) => ['hazard-reports', siteId ?? 'all'] as const,
  site: (siteId: string) => ['site', siteId] as const,
}

const REFETCH_MS = 60_000
/** Collapse bursts of stream events (e.g. the replay on connect) into one refetch. */
const INVALIDATE_DEBOUNCE_MS = 1500

export interface SiteConditions {
  lightningActive: boolean
}

export interface SiteBundle {
  site: Site
  risk: SiteRisk
  conditions: SiteConditions
  alerts: Alert[]
}

export interface RankedAlert extends Alert {
  site: Site
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
}

function compareScores(a: SiteRisk, b: SiteRisk): number {
  return (b.score ?? -1) - (a.score ?? -1)
}

function isLightningStop(alert: Alert): boolean {
  return alert.type === 'lightning' && alert.status === 'active'
}

/** Starts the 1 s clock and the SSE stream for the signed-in session. */
export function usePlanitLiveFeed(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const live = useLiveStore.getState()
    const clock = setInterval(() => live.tick(), 1000)

    const siteIds = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      timer = undefined
      for (const key of [
        planitKeys.alerts,
        planitKeys.rankings,
        planitKeys.strikes,
        planitKeys.briefings,
      ]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
      for (const siteId of siteIds) {
        void queryClient.invalidateQueries({
          queryKey: planitKeys.site(siteId),
        })
      }
      siteIds.clear()
    }

    const disconnect = connectPlanitStream({
      onStatus: live.setStreamStatus,
      onEvent: (event) => {
        live.markEvent()
        if (typeof event.data.site_id === 'string')
          siteIds.add(event.data.site_id)
        timer ??= setTimeout(flush, INVALIDATE_DEBOUNCE_MS)
      },
    })

    return () => {
      clearInterval(clock)
      if (timer) clearTimeout(timer)
      disconnect()
    }
  }, [queryClient])
}

export function useLiveNow(): number {
  return useLiveStore((state) => state.now)
}

/** Seconds remaining until the given time (lightning all-clear countdown). */
export function useCountdown(isoTime: string | undefined): number {
  const now = useLiveStore((state) => state.now)
  return useMemo(() => {
    if (!isoTime) return 0
    return Math.max(0, Math.floor((new Date(isoTime).getTime() - now) / 1000))
  }, [isoTime, now])
}

function useRankingsQuery() {
  return useQuery({
    queryKey: planitKeys.rankings,
    queryFn: listSiteRisks,
    staleTime: 30_000,
    refetchInterval: REFETCH_MS,
  })
}

function useAlertsQuery() {
  return useQuery({
    queryKey: planitKeys.alerts,
    queryFn: listAlerts,
    staleTime: 15_000,
    refetchInterval: REFETCH_MS,
  })
}

/** All monitored sites (shares the rankings request). */
export function useSites(): { sites: Site[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: planitKeys.sites,
    queryFn: listSites,
    staleTime: 5 * 60_000,
  })
  return { sites: query.data ?? [], isLoading: query.isLoading }
}

/** Every site with its latest risk and unresolved alerts, riskiest first. */
export function useSiteBundles(): {
  bundles: SiteBundle[]
  isLoading: boolean
  isError: boolean
} {
  const rankings = useRankingsQuery()
  const alerts = useAlertsQuery()

  const bundles = useMemo(() => {
    const bySite = new Map<string, Alert[]>()
    for (const alert of alerts.data ?? []) {
      const list = bySite.get(alert.siteId) ?? []
      list.push(alert)
      bySite.set(alert.siteId, list)
    }
    return (rankings.data ?? [])
      .map(({ site, risk }) => {
        const siteAlerts = bySite.get(site.id) ?? []
        return {
          site,
          risk,
          alerts: siteAlerts,
          conditions: { lightningActive: siteAlerts.some(isLightningStop) },
        }
      })
      .sort((a, b) => compareScores(a.risk, b.risk))
  }, [rankings.data, alerts.data])

  return {
    bundles,
    isLoading: rankings.isLoading || alerts.isLoading,
    isError: rankings.isError || alerts.isError,
  }
}

/** Unresolved alerts across the fleet, most severe first, then most recent. */
export function useActiveAlerts(): {
  alerts: RankedAlert[]
  isLoading: boolean
} {
  const { sites: siteList, isLoading: sitesLoading } = useSites()
  const alerts = useAlertsQuery()

  const ranked = useMemo(() => {
    const sites = new Map(siteList.map((site) => [site.id, site]))
    return (alerts.data ?? [])
      .flatMap((alert) => {
        const site = sites.get(alert.siteId)
        return site ? [{ ...alert, site }] : []
      })
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          b.createdAt.localeCompare(a.createdAt)
      )
  }, [siteList, alerts.data])

  return { alerts: ranked, isLoading: sitesLoading || alerts.isLoading }
}

/** Strikes recorded within the all-clear window, one marker per strike. */
export function useLiveStrikes() {
  const query = useQuery({
    queryKey: planitKeys.strikes,
    queryFn: listStrikes,
    staleTime: 15_000,
    refetchInterval: REFETCH_MS,
  })
  return query.data ?? []
}

/** Everything the site detail page needs for one site. */
export function useSiteDetail(siteId: string) {
  // Every key starts with planitKeys.site(siteId) so stream events refresh them all.
  const siteQuery = useQuery({
    queryKey: ['site', siteId, 'info'],
    queryFn: () => getSite(siteId),
    staleTime: 5 * 60_000,
  })
  const riskQuery = useQuery({
    queryKey: ['site', siteId, 'risk'],
    queryFn: () => getSiteRisk(siteId),
    refetchInterval: REFETCH_MS,
  })
  const hazardsQuery = useQuery({
    queryKey: ['site', siteId, 'hazards'],
    queryFn: () => listSiteHazards(siteId, 72),
    refetchInterval: REFETCH_MS,
  })
  const historyQuery = useQuery({
    queryKey: ['site', siteId, 'history'],
    queryFn: () => getHazardIndexHistory(siteId, 14),
    staleTime: 5 * 60_000,
  })
  const alertsQuery = useAlertsQuery()

  const alerts = useMemo(
    () => (alertsQuery.data ?? []).filter((alert) => alert.siteId === siteId),
    [alertsQuery.data, siteId]
  )
  const risk = useMemo(() => {
    if (!riskQuery.data) return undefined
    const trend = trendFromHistory(historyQuery.data ?? [])
    return trend ? { ...riskQuery.data, trend } : riskQuery.data
  }, [riskQuery.data, historyQuery.data])
  const domains = useMemo(
    () => buildDomains(hazardsQuery.data ?? [], risk?.subScores ?? {}, alerts),
    [hazardsQuery.data, risk?.subScores, alerts]
  )
  const hazardsFetchedAt = hazardsQuery.dataUpdatedAt
  const timeline = useMemo(() => {
    const dayAgo = hazardsFetchedAt - 24 * 60 * 60 * 1000
    return hazardsQuery.data
      ? buildTimeline(
          hazardsQuery.data.filter(
            (row) => new Date(row.observed_at).getTime() >= dayAgo
          )
        )
      : undefined
  }, [hazardsQuery.data, hazardsFetchedAt])
  const strikes = useMemo(
    () => toSiteStrikes(hazardsQuery.data ?? []),
    [hazardsQuery.data]
  )

  return {
    site: siteQuery.data,
    risk,
    alerts,
    domains,
    timeline,
    strikes,
    history: historyQuery.data,
    historyError: historyQuery.isError,
    lightningActive: alerts.some(isLightningStop),
    isLoading: siteQuery.isLoading || riskQuery.isLoading,
    notFound: siteQuery.isSuccess && !siteQuery.data,
  }
}

/** Field reports. The backend restricts reading them to admins. */
export function useHazardReports(siteId?: string) {
  const user = useAuthStore((state) => state.auth.user)
  const canView = hasRole(user, 'admin')
  const query = useQuery({
    queryKey: planitKeys.reports(siteId),
    queryFn: () => listHazardReports(siteId),
    enabled: canView,
    staleTime: 15_000,
    refetchInterval: REFETCH_MS,
  })
  return {
    reports: query.data,
    /** Epoch ms of the last successful fetch, for time-window filters. */
    fetchedAt: query.dataUpdatedAt,
    isLoading: canView && query.isLoading,
    canView,
  }
}

/** The latest fleet briefing plus earlier shift dates from the last two weeks. */
export function useFleetBriefing() {
  const rowsQuery = useQuery({
    queryKey: planitKeys.briefings,
    queryFn: () =>
      listBriefingRows(format(subDays(new Date(), 14), 'yyyy-MM-dd')),
    staleTime: 60_000,
    refetchInterval: REFETCH_MS,
  })
  const rankings = useRankingsQuery()
  const alerts = useAlertsQuery()

  const briefing = useMemo(() => {
    if (!rowsQuery.data) return undefined
    const risks = new Map(
      (rankings.data ?? []).map((row) => [row.site.id, row.risk])
    )
    return buildFleetBriefing(rowsQuery.data, risks, alerts.data ?? [])
  }, [rowsQuery.data, rankings.data, alerts.data])

  const history = useMemo(
    () =>
      buildBriefingHistory(
        (rowsQuery.data ?? []).filter(
          (row) => row.briefing_date !== briefing?.shiftDate
        )
      ),
    [rowsQuery.data, briefing?.shiftDate]
  )

  return {
    briefing,
    history,
    isLoading: rowsQuery.isLoading || rankings.isLoading,
    isEmpty: rowsQuery.isSuccess && !briefing,
    isError: rowsQuery.isError || rankings.isError,
    refresh: () => Promise.all([rowsQuery.refetch(), rankings.refetch()]),
  }
}
