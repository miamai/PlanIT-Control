import { useAuthStore } from '@/stores/auth-store'
import { API_BASE_URL, refreshSession } from './client'

interface StreamEvent {
  id: string
  event: string
  data: Record<string, unknown>
}

class StreamUnauthorized extends Error {}

/** Read one authenticated SSE connection until it ends or is aborted. */
async function readStream(
  lastEventId: string | undefined,
  signal: AbortSignal,
  onOpen: () => void,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const token = useAuthStore.getState().auth.accessToken
  const response = await fetch(`${API_BASE_URL}/api/stream`, {
    headers: {
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
    },
    signal,
  })
  if (response.status === 401) throw new StreamUnauthorized()
  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed: ${response.status}`)
  }
  onOpen()

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const fields: Record<string, string> = {}
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue
        const separator = line.indexOf(':')
        if (separator < 0) continue
        fields[line.slice(0, separator)] = line.slice(separator + 1).trim()
      }
      if (fields.data) {
        try {
          onEvent({
            id: fields.id ?? '',
            event: fields.event ?? 'message',
            data: JSON.parse(fields.data) as Record<string, unknown>,
          })
        } catch {
          // Ignore a malformed event; REST stays the source of truth.
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}

/**
 * Keep an authenticated SSE connection to `/api/stream` open, reconnecting
 * with `Last-Event-ID` and exponential backoff. Native `EventSource` cannot
 * send the Authorization header, so this reads the stream with `fetch`.
 * The stream only signals change; callers refetch REST state on each event.
 */
export function connectPlanitStream(options: {
  onEvent: (event: StreamEvent) => void
  onStatus?: (status: 'connecting' | 'live' | 'offline') => void
}): () => void {
  const controller = new AbortController()
  let lastEventId: string | undefined

  void (async () => {
    let delay = 1000
    while (!controller.signal.aborted) {
      options.onStatus?.('connecting')
      try {
        await readStream(
          lastEventId,
          controller.signal,
          () => {
            delay = 1000
            options.onStatus?.('live')
          },
          (event) => {
            if (event.id) lastEventId = event.id
            options.onEvent(event)
          }
        )
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof StreamUnauthorized) {
          try {
            if (!(await refreshSession())) {
              options.onStatus?.('offline')
              return
            }
          } catch {
            // A refresh outage does not invalidate the cookie. Keep backing off
            // and reconnect when the service returns.
          }
        }
      }
      if (controller.signal.aborted) return
      options.onStatus?.('offline')
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, 30_000)
    }
  })()

  return () => controller.abort()
}
