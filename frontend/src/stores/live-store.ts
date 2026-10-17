import { create } from 'zustand'
import {
  ALL_CLEAR_MINUTES,
  LIGHTNING_RADIUS_MI,
  computeConditions,
} from '@/api/mock/engine'
import { SITE_SEED } from '@/api/mock/sites-data'
import { type LightningStrike } from '@/api/types'

/**
 * Live feed simulation.
 *
 * Replaces the realtime websocket / Tiger Data subscription: it keeps a rolling
 * window of lightning strikes plus a clock so the UI can render live stop-work
 * countdowns. Person A can swap the interval bodies for a real GLM/NLDN stream.
 */

interface LiveState {
  started: boolean
  now: number
  strikes: LightningStrike[]
  /** Sites that are generating storms today — used to place new strikes. */
  stormSiteIds: string[]
  start: () => void
  stop: () => void
  tick: () => void
  simulateStrike: (siteId?: string) => void
}

let clockTimer: ReturnType<typeof setInterval> | undefined
let strikeTimer: ReturnType<typeof setInterval> | undefined
let rotation = 0

function offsetPoint(
  lat: number,
  lon: number,
  distanceMi: number,
  bearingRad: number
): { lat: number; lon: number } {
  const dLat = (distanceMi * Math.cos(bearingRad)) / 69
  const dLon =
    (distanceMi * Math.sin(bearingRad)) / (69 * Math.cos((lat * Math.PI) / 180))
  return { lat: lat + dLat, lon: lon + dLon }
}

function makeStrike(
  siteId: string,
  at = Date.now()
): LightningStrike | undefined {
  const site = SITE_SEED.find((s) => s.id === siteId)
  if (!site) return undefined
  const distanceMi = 0.4 + Math.random() * (LIGHTNING_RADIUS_MI - 1)
  const bearing = Math.random() * Math.PI * 2
  const { lat, lon } = offsetPoint(site.lat, site.lon, distanceMi, bearing)
  return {
    id: `STRIKE-${at.toString(36)}-${Math.floor(Math.random() * 1e5).toString(36)}`,
    siteId,
    lat,
    lon,
    distanceMi: Math.round(distanceMi * 10) / 10,
    intensity: Math.round((0.4 + Math.random() * 0.6) * 100) / 100,
    at: new Date(at).toISOString(),
  }
}

function pickStormSites(): string[] {
  return SITE_SEED.map((site) => {
    const conditions = computeConditions(site)
    const score =
      (conditions.scenario === 'gulf-storm'
        ? 3
        : conditions.scenario === 'thunderstorm'
          ? 2
          : 0) + conditions.profile.storm
    return { id: site.id, score }
  })
    .filter((s) => s.score > 0.75)
    .sort((a, b) => b.score - a.score)
    .slice(0, 7)
    .map((s) => s.id)
}

function seedStrikes(stormSiteIds: string[]): LightningStrike[] {
  const strikes: LightningStrike[] = []
  for (const siteId of stormSiteIds.slice(0, 5)) {
    const count = 1 + Math.floor(Math.random() * 2)
    for (let i = 0; i < count; i++) {
      const at = Date.now() - (1 + Math.random() * 18) * 60 * 1000
      const strike = makeStrike(siteId, at)
      if (strike) strikes.push(strike)
    }
  }
  return strikes
}

function prune(strikes: LightningStrike[], now: number): LightningStrike[] {
  const windowMs = (ALL_CLEAR_MINUTES + 2) * 60 * 1000
  return strikes.filter((s) => now - new Date(s.at).getTime() <= windowMs)
}

export const LIGHTNING_RULES = {
  radiusMi: LIGHTNING_RADIUS_MI,
  allClearMinutes: ALL_CLEAR_MINUTES,
}

export const useLiveStore = create<LiveState>()((set, get) => ({
  started: false,
  now: Date.now(),
  strikes: [],
  stormSiteIds: [],
  start: () => {
    if (get().started) return
    const stormSiteIds = pickStormSites()
    set({
      started: true,
      now: Date.now(),
      stormSiteIds,
      strikes: seedStrikes(stormSiteIds),
    })
    clockTimer = setInterval(() => get().tick(), 1000)
    strikeTimer = setInterval(() => {
      const state = get()
      const pool =
        state.stormSiteIds.length > 0
          ? state.stormSiteIds
          : SITE_SEED.slice(0, 6).map((s) => s.id)
      const siteId = pool[rotation % pool.length]
      rotation += 1
      const strike = makeStrike(siteId)
      if (!strike) return
      set((prev) => ({ strikes: prune([...prev.strikes, strike], Date.now()) }))
    }, 14000)
  },
  stop: () => {
    if (clockTimer) clearInterval(clockTimer)
    if (strikeTimer) clearInterval(strikeTimer)
    clockTimer = undefined
    strikeTimer = undefined
    set({ started: false })
  },
  tick: () =>
    set((prev) => ({
      now: Date.now(),
      strikes: prune(prev.strikes, Date.now()),
    })),
  simulateStrike: (siteId) => {
    const state = get()
    const target =
      siteId ??
      (state.stormSiteIds.length
        ? state.stormSiteIds[rotation % state.stormSiteIds.length]
        : SITE_SEED[Math.floor(Math.random() * SITE_SEED.length)].id)
    const strike = makeStrike(target)
    if (!strike) return
    set((prev) => ({ strikes: prune([...prev.strikes, strike], Date.now()) }))
  },
}))
