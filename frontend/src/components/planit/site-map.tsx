import { useEffect } from 'react'
import 'leaflet/dist/leaflet.css'
import {
  Circle,
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import { type HazardReport, type LightningStrike, type Site } from '@/api/types'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'

export interface SiteMarker {
  site: Site
  score: number
  activeLightning?: boolean
  hasReports?: boolean
}

const US_CENTER: [number, number] = [39.6, -98.4]
const RECOMMENDATION_COLOR: Record<string, string> = {
  GO: '#10b981',
  CAUTION: '#f59e0b',
  'NO-GO': '#dc2626',
}

function colorForScore(score: number): string {
  if (score >= 6.5) return RECOMMENDATION_COLOR['NO-GO']
  if (score >= 3.5) return RECOMMENDATION_COLOR.CAUTION
  return RECOMMENDATION_COLOR.GO
}

function MapFocus({
  site,
}: {
  site?: { lat: number; lon: number } | undefined
}) {
  const map = useMap()
  useEffect(() => {
    if (!site) return
    map.flyTo([site.lat, site.lon], Math.max(map.getZoom(), 9), {
      duration: 0.8,
    })
  }, [map, site])
  return null
}

export function SiteMap({
  markers,
  strikes = [],
  reports = [],
  selectedSiteId,
  onSelect,
  height = 'h-[520px]',
  className,
  interactive = true,
}: {
  markers: SiteMarker[]
  strikes?: LightningStrike[]
  reports?: HazardReport[]
  selectedSiteId?: string
  onSelect?: (siteId: string) => void
  height?: string
  className?: string
  interactive?: boolean
}) {
  const { resolvedTheme } = useTheme()
  const selected = markers.find((m) => m.site.id === selectedSiteId)?.site

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-lg border',
        height,
        className
      )}
    >
      <MapContainer
        center={US_CENTER}
        zoom={4}
        minZoom={3}
        scrollWheelZoom={false}
        dragging={interactive}
        zoomControl={interactive}
        style={{ height: '100%', width: '100%', background: 'transparent' }}
        className='z-0'
      >
        <TileLayer
          key={resolvedTheme}
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          url={
            resolvedTheme === 'dark'
              ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
              : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
          }
        />

        {strikes.map((strike) => (
          <CircleMarker
            key={strike.id}
            center={[strike.lat, strike.lon]}
            radius={2.5 + strike.intensity * 2}
            pathOptions={{
              color: '#a855f7',
              fillColor: '#a855f7',
              fillOpacity: 0.5,
              weight: 1,
            }}
          >
            <Tooltip>
              Lightning strike · {strike.distanceMi} mi from site
            </Tooltip>
          </CircleMarker>
        ))}

        {markers.map(({ site, score, activeLightning, hasReports }) => {
          const isSelected = site.id === selectedSiteId
          return (
            <CircleMarker
              key={site.id}
              center={[site.lat, site.lon]}
              radius={isSelected ? 11 : 6 + score * 0.7}
              pathOptions={{
                color: colorForScore(score),
                fillColor: colorForScore(score),
                fillOpacity: isSelected ? 0.95 : 0.7,
                weight: isSelected ? 3 : 1.5,
              }}
              eventHandlers={
                onSelect ? { click: () => onSelect(site.id) } : undefined
              }
            >
              <Tooltip direction='top'>
                <span className='font-medium'>{site.name}</span>
                <br />
                {site.county} County, {site.state} · {score.toFixed(1)}/10
                {activeLightning ? ' · lightning active' : ''}
                {hasReports ? ' · crew reports' : ''}
              </Tooltip>
            </CircleMarker>
          )
        })}

        {strikes.map((strike) => (
          <Circle
            key={`radius-${strike.id}`}
            center={[strike.lat, strike.lon]}
            radius={1609}
            pathOptions={{
              color: '#a855f7',
              fill: false,
              weight: 0.5,
              opacity: 0.35,
            }}
          />
        ))}

        {reports.map((report) => (
          <CircleMarker
            key={report.id}
            center={[report.lat, report.lon]}
            radius={5}
            pathOptions={{
              color: '#0ea5e9',
              fillColor: '#0ea5e9',
              fillOpacity: 0.8,
              weight: 2,
            }}
          >
            <Tooltip direction='top'>
              <span className='font-medium'>{report.note.slice(0, 60)}</span>
              <br />
              {report.reportedBy} · {report.confirmations} confirmations
            </Tooltip>
          </CircleMarker>
        ))}

        <MapFocus site={selected} />
      </MapContainer>

      <div className='pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border bg-background/90 px-3 py-2 text-[11px] shadow-sm backdrop-blur'>
        <p className='mb-1 font-medium'>Hazard index</p>
        <ul className='space-y-0.5'>
          {(['GO', 'CAUTION', 'NO-GO'] as const).map((label) => (
            <li key={label} className='flex items-center gap-1.5'>
              <span
                className={cn(
                  'size-2 rounded-full',
                  label === 'GO'
                    ? 'bg-emerald-500'
                    : label === 'CAUTION'
                      ? 'bg-amber-500'
                      : 'bg-red-600'
                )}
              />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
