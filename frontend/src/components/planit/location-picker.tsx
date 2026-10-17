import { useEffect } from 'react'
import { divIcon } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { type Site } from '@/api/types'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'

const TILE_URL = {
  light:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
}

const PIN_ICON = divIcon({
  className: '',
  iconSize: [28, 36],
  iconAnchor: [14, 34],
  html: `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 2px rgb(0 0 0 / .4))"><path d="M14 1C7 1 1.5 6.4 1.5 13.2 1.5 22.4 14 35 14 35s12.5-12.6 12.5-21.8C26.5 6.4 21 1 14 1z" fill="#dc2626" stroke="#fff" stroke-width="2"/><circle cx="14" cy="13" r="4.5" fill="#fff"/></svg>`,
})

function Recenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap()
  useEffect(() => {
    // Only move the view when the pin jumps off screen (GPS fix, new site).
    if (!map.getBounds().contains([lat, lon])) {
      map.setView([lat, lon], Math.max(map.getZoom(), 12))
    }
  }, [map, lat, lon])
  return null
}

function ClickToPin({
  onChange,
}: {
  onChange: (point: { lat: number; lon: number }) => void
}) {
  useMapEvents({
    click: (event) =>
      onChange({
        lat: Number(event.latlng.lat.toFixed(5)),
        lon: Number(event.latlng.lng.toFixed(5)),
      }),
  })
  return null
}

/** Small map for dropping the hazard pin: tap to move it, drag to fine-tune. */
export function LocationPicker({
  value,
  site,
  onChange,
  className,
}: {
  value: { lat: number; lon: number }
  site?: Site
  onChange: (point: { lat: number; lon: number }) => void
  className?: string
}) {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light'

  return (
    <div
      className={cn(
        'relative isolate h-56 overflow-hidden rounded-lg border sm:h-64',
        className
      )}
    >
      <MapContainer
        center={[value.lat, value.lon]}
        zoom={12}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
        className='z-0'
      >
        <TileLayer
          key={theme}
          url={TILE_URL[theme]}
          attribution='Tiles &copy; Esri'
          maxNativeZoom={16}
        />
        {site ? (
          <CircleMarker
            center={[site.lat, site.lon]}
            radius={7}
            pathOptions={{
              color: '#ffffff',
              fillColor: '#475569',
              fillOpacity: 1,
              weight: 2,
            }}
          >
            <Tooltip direction='top' offset={[0, -6]}>
              {site.name}
            </Tooltip>
          </CircleMarker>
        ) : null}
        <Marker
          position={[value.lat, value.lon]}
          icon={PIN_ICON}
          draggable
          eventHandlers={{
            dragend: (event) => {
              const point = event.target.getLatLng()
              onChange({
                lat: Number(point.lat.toFixed(5)),
                lon: Number(point.lng.toFixed(5)),
              })
            },
          }}
        />
        <ClickToPin onChange={onChange} />
        <Recenter lat={value.lat} lon={value.lon} />
      </MapContainer>
    </div>
  )
}
