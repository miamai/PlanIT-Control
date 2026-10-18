import { create } from 'zustand'

/**
 * Live state: a one-second clock for countdowns plus the status of the
 * server-sent event stream (`/api/stream`) that tells the UI to refetch.
 */

type StreamStatus = 'connecting' | 'live' | 'offline'

interface LiveState {
  now: number
  streamStatus: StreamStatus
  lastEventAt: number | null
  tick: () => void
  setStreamStatus: (status: StreamStatus) => void
  markEvent: () => void
}

export const useLiveStore = create<LiveState>()((set) => ({
  now: Date.now(),
  streamStatus: 'connecting',
  lastEventAt: null,
  tick: () => set({ now: Date.now() }),
  setStreamStatus: (streamStatus) => set({ streamStatus }),
  markEvent: () => set({ lastEventAt: Date.now() }),
}))
