import { type ReactNode, useEffect } from 'react'
import '@/styles/index.css'
import { type Map } from 'leaflet'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { type Site } from '@/api/types'
import { LocationPicker } from './location-picker'
import { SiteMap } from './site-map'

const state = vi.hoisted(() => ({ map: undefined as Map | undefined }))

vi.mock('react-leaflet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-leaflet')>()
  function CaptureMap() {
    const map = actual.useMap()
    useEffect(() => {
      state.map = map
      return () => {
        state.map = undefined
      }
    }, [map])
    return null
  }
  return {
    ...actual,
    // Avoid external tile requests; exercise the real Leaflet viewport.
    TileLayer: () => null,
    MapContainer: ({ children, ...props }: { children: ReactNode }) => (
      <actual.MapContainer {...props}>
        <CaptureMap />
        {children}
      </actual.MapContainer>
    ),
  }
})

const sites = [
  { id: 'one', lat: 40, lon: -74, name: 'One', county: 'A', state: 'NY' },
  { id: 'two', lat: 35, lon: -118, name: 'Two', county: 'B', state: 'CA' },
] as Site[]

function markers() {
  return sites.map((site) => ({ site: { ...site }, score: 2 }))
}

describe('SiteMap viewport', () => {
  it('preserves a user view across data refreshes and container resizes', async () => {
    const screen = await render(<SiteMap markers={markers()} />)
    const map = state.map!
    map.setView([41, -90], 7, { animate: false })
    const center = map.getCenter()
    const fitBounds = vi.spyOn(map, 'fitBounds')

    await screen.rerender(<SiteMap markers={markers()} />)
    expect(map.getCenter()).toEqual(center)
    expect(map.getZoom()).toBe(7)

    await screen.rerender(<SiteMap markers={markers()} height='h-[320px]' />)

    await vi.waitFor(() => expect(map.getSize().y).toBe(318))
    expect(fitBounds).not.toHaveBeenCalled()
    // Leaflet rounds projected coordinates to pixels when resizing.
    expect(
      map.project(map.getCenter()).distanceTo(map.project(center))
    ).toBeLessThan(1)
    expect(map.getZoom()).toBe(7)
  })

  it('does not refocus a selected site when refreshed objects arrive', async () => {
    const screen = await render(
      <SiteMap markers={markers()} selectedSiteId='one' />
    )
    const map = state.map!
    map.stop()
    map.setView([42, -80], 6, { animate: false })
    const center = map.getCenter()
    const flyTo = vi.spyOn(map, 'flyTo')

    await screen.rerender(<SiteMap markers={markers()} selectedSiteId='one' />)

    expect(flyTo).not.toHaveBeenCalled()
    expect(map.getCenter()).toEqual(center)
    expect(map.getZoom()).toBe(6)

    await screen.rerender(<SiteMap markers={markers()} selectedSiteId='two' />)
    expect(flyTo).toHaveBeenCalledOnce()
    expect(flyTo).toHaveBeenCalledWith([35, -118], 10, { duration: 0.8 })
  })

  it('fits sites that arrive after the initial empty render only once', async () => {
    const screen = await render(<SiteMap markers={[]} />)
    const fitBounds = vi.spyOn(state.map!, 'fitBounds')

    await screen.rerender(<SiteMap markers={markers()} />)
    expect(fitBounds).toHaveBeenCalledOnce()

    await screen.rerender(<SiteMap markers={markers()} />)
    expect(fitBounds).toHaveBeenCalledOnce()
  })

  it('preserves the location picker view when the pin coordinates are unchanged', async () => {
    const screen = await render(
      <LocationPicker value={{ lat: 40, lon: -74 }} onChange={vi.fn()} />
    )
    const map = state.map!
    map.setView([41, -90], 7, { animate: false })
    const center = map.getCenter()
    const setView = vi.spyOn(map, 'setView')

    await screen.rerender(
      <LocationPicker value={{ lat: 40, lon: -74 }} onChange={vi.fn()} />
    )

    expect(setView).not.toHaveBeenCalled()
    expect(map.getCenter()).toEqual(center)
    expect(map.getZoom()).toBe(7)
  })
})
