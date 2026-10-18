import { useCallback, useEffect, useRef, useState } from 'react'

export interface Position {
  lat: number
  lon: number
}

/** Continuous GPS while the capture page is open, so each photo carries where it was taken. */
export function useWatchedPosition() {
  const [position, setPosition] = useState<Position>()

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setPosition({
          lat: Number(p.coords.latitude.toFixed(5)),
          lon: Number(p.coords.longitude.toFixed(5)),
        }),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return position
}

type OrientationEventWithCompass = DeviceOrientationEvent & {
  webkitCompassHeading?: number
}

type OrientationPermission = {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/**
 * The compass direction the phone faces, in degrees from north. It lets the
 * photo checks turn "left to right in the frame" into "flowing east".
 * `enable` must run from a tap: iOS only grants motion sensors to a gesture.
 */
export function useCompassHeading() {
  const [heading, setHeading] = useState<number>()
  const listening = useRef(false)
  const cleanup = useRef<() => void>(undefined)

  const enable = useCallback(async () => {
    if (listening.current || typeof DeviceOrientationEvent === 'undefined') {
      return
    }
    const permission =
      DeviceOrientationEvent as unknown as OrientationPermission
    if (typeof permission.requestPermission === 'function') {
      try {
        if ((await permission.requestPermission()) !== 'granted') return
      } catch {
        return
      }
    }
    listening.current = true
    const onOrientation = (event: Event) => {
      const e = event as OrientationEventWithCompass
      if (typeof e.webkitCompassHeading === 'number') {
        setHeading(e.webkitCompassHeading)
      } else if (e.absolute && e.alpha !== null) {
        setHeading((360 - e.alpha) % 360)
      }
    }
    // Android reports true north only on the "absolute" event.
    const type =
      'ondeviceorientationabsolute' in window
        ? 'deviceorientationabsolute'
        : 'deviceorientation'
    window.addEventListener(type, onOrientation)
    cleanup.current = () => window.removeEventListener(type, onOrientation)
  }, [])

  useEffect(() => () => cleanup.current?.(), [])

  return { heading, enable }
}

/** Reads instructions aloud so a crew member in gloves can keep both hands on the job. */
export function useSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [enabled, setEnabled] = useState(
    () => supported && window.matchMedia('(pointer: coarse)').matches
  )

  const say = useCallback(
    (text: string, force = false) => {
      if (!supported || (!enabled && !force)) return
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
    },
    [enabled, supported]
  )

  useEffect(() => {
    if (!enabled && supported) window.speechSynthesis.cancel()
  }, [enabled, supported])

  return { supported, enabled, setEnabled, say }
}
