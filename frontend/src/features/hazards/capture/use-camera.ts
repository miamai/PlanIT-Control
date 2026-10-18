import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraState =
  | 'idle'
  | 'starting'
  | 'live'
  | 'denied'
  | 'unsupported'

/** Longest side of a photo sent for checking; keeps uploads around 100–200 kB. */
const MAX_SIDE = 1024
const JPEG_QUALITY = 0.75

/**
 * The rear camera in a `<video>` element, plus a JPEG grab of the current frame.
 * `start` must run from a tap: browsers only grant the camera to a user gesture.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<CameraState>('idle')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported')
      return false
    }
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      streamRef.current = stream
      setState('live')
      return true
    } catch {
      setState('denied')
      return false
    }
  }, [])

  // Attach once the <video> is mounted, which may be after `start` resolves.
  useEffect(() => {
    const video = videoRef.current
    if (state !== 'live' || !video || !streamRef.current) return
    if (video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current
      void video.play().catch(() => undefined)
    }
  })

  useEffect(() => stop, [stop])

  /** The current frame as base64 JPEG (no data-URL prefix), or undefined before video plays. */
  const grab = useCallback((): string | undefined => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0) return undefined
    const scale = Math.min(
      1,
      MAX_SIDE / Math.max(video.videoWidth, video.videoHeight)
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',', 2)[1]
  }, [])

  return { videoRef, state, start, stop, grab }
}

const SAMPLE_MS = 150
const SAMPLE_W = 32
const SAMPLE_H = 24
/** Mean per-pixel brightness change (0–255) below which the view counts as still. */
const STILL_DIFF = 4
/** Above this the camera has clearly been moved to a new view. */
const MOVED_DIFF = 14
const STILL_FOR_MS = 1000

/**
 * Watches the video for camera movement by comparing tiny greyscale samples,
 * and calls `onSteady` once the camera has moved since the last `rearm()` and
 * then held still for a second: the moment to take the next photo hands-free.
 */
export function useSteadyShot(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onSteady: () => void
) {
  const moved = useRef(true)
  const callback = useRef(onSteady)
  useEffect(() => {
    callback.current = onSteady
  })

  const rearm = useCallback(() => {
    moved.current = false
  }, [])

  useEffect(() => {
    if (!enabled) return
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_W
    canvas.height = SAMPLE_H
    const context = canvas.getContext('2d', { willReadFrequently: true })
    let previous: Uint8ClampedArray | undefined
    let stillSince: number | undefined

    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!context || !video || video.videoWidth === 0) return
      context.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H)
      const pixels = context.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data
      if (previous) {
        let total = 0
        for (let i = 0; i < pixels.length; i += 4) {
          const luma =
            pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11
          const before =
            previous[i] * 0.3 + previous[i + 1] * 0.59 + previous[i + 2] * 0.11
          total += Math.abs(luma - before)
        }
        const diff = total / (SAMPLE_W * SAMPLE_H)
        if (diff > MOVED_DIFF) moved.current = true
        const now = performance.now()
        if (diff < STILL_DIFF) stillSince ??= now
        else stillSince = undefined
        if (
          moved.current &&
          stillSince !== undefined &&
          now - stillSince >= STILL_FOR_MS
        ) {
          moved.current = false
          callback.current()
        }
      }
      previous = new Uint8ClampedArray(pixels)
    }, SAMPLE_MS)
    return () => window.clearInterval(timer)
  }, [enabled, videoRef])

  return { rearm }
}
