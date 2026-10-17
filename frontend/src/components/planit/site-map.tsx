import { useEffect, useMemo } from 'react'
import { type LatLngBounds, divIcon, latLngBounds } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import { LIGHTNING_RADIUS_MI } from '@/api/mock/engine'
import {
  type AlertSeverity,
  type HazardReport,
  type LightningStrike,
  type Site,
} from '@/api/types'
import {
  ALERT_SEVERITY_LABEL,
  CAUTION_BELOW,
  GO_BELOW,
  RECOMMENDATION_HEX,
  REPORT_TYPE_LABEL,
  recommendationFromScore,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'

export interface SiteMarker {
  site: Site
  score: number
  activeLightning?: boolean
  hasReports?: boolean
}

const US_CENTER: [number, number] = [39.6, -98.4]
const METERS_PER_MILE = 1609.34
const STRIKE_COLOR = '#8b5cf6'
const CONTEXT_SITE_COLOR = '#94a3b8'
const REPORT_COLOR: Record<AlertSeverity, string> = {
  info: '#0ea5e9',
  warning: '#f59e0b',
  critical: '#dc2626',
}

// Esri canvas basemaps: neutral gray so the risk colors carry the meaning.
const TILE_URL = {
  light:
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
}
const LABEL_URL = {
  light:
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
}
const ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'

function rankIcon(rank: number, color: string) {
  return divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;background:${color};color:#fff;font:600 11px/1 Inter,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgb(0 0 0 / .35)">${rank}</span>`,
  })
}

function MapFocus({ site }: { site?: { lat: number; lon: number } }) {
  const map = useMap()
  useEffect(() => {
    if (!site) return
    map.flyTo([site.lat, site.lon], Math.max(map.getZoom(), 10), {
      duration: 0.8,
    })
  }, [map, site])
  return null
}

/** Keep the whole fleet in view as the card resizes (sidebar toggle, breakpoints). */
function FitBounds({ bounds }: { bounds?: LatLngBounds }) {
  const map = useMap()
  useEffect(() => {
    if (!bounds) return
    const fit = () => {
      map.invalidateSize()
      map.fitBounds(bounds, { padding: [12, 12] })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map, bounds])
  return null
}

function LegendDot({ color, ring }: { color: string; ring?: boolean }) {
  return (
    <span
      className='size-2.5 shrink-0 rounded-full'
      style={
        ring
          ? { border: `1.5px dashed ${color}` }
          : { background: color, boxShadow: '0 0 0 1px rgb(255 255 255 / .8)' }
      }
    />
  )
}

/**
 * Leaflet map of job sites. In `risk` mode sites are colored by their GO /
 * CAUTION / NO-GO call and the top `rankLabels` carry their rank number; in
 * `context` mode sites are muted so crew reports stand out.
 */
export function SiteMap({
  markers,
  strikes = [],
  reports = [],
  selectedSiteId,
  onSelect,
  siteStyle = 'risk',
  rankLabels = 0,
  showRiskLegend = true,
  height = 'h-[520px]',
  className,
  interactive = true,
}: {
  markers: SiteMarker[]
  strikes?: LightningStrike[]
  reports?: HazardReport[]
  selectedSiteId?: string
  onSelect?: (siteId: string) => void
  siteStyle?: 'risk' | 'context'
  rankLabels?: number
  /** Hide the GO / CAUTION / NO-GO key where the call is shown elsewhere. */
  showRiskLegend?: boolean
  height?: string
  className?: string
  interactive?: boolean
}) {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light'
  const selected = markers.find((m) => m.site.id === selectedSiteId)?.site

  // Draw low-risk first so the riskiest markers sit on top.
  const ordered = useMemo(
    () => [...markers].sort((a, b) => a.score - b.score),
    [markers]
  )
  const ranks = useMemo(() => {
    const map = new Map<string, number>()
    if (siteStyle !== 'risk' || rankLabels <= 0) return map
    ;[...markers]
      .sort((a, b) => b.score - a.score)
      .slice(0, rankLabels)
      .forEach((marker, index) => map.set(marker.site.id, index + 1))
    return map
  }, [markers, rankLabels, siteStyle])

  const bounds = useMemo(() => {
    if (selected || markers.length < 2) return undefined
    return latLngBounds(markers.map((m) => [m.site.lat, m.site.lon]))
  }, [markers, selected])

  const lightningSites = markers.filter((m) => m.activeLightning)
  const extraLegend =
    strikes.length > 0 ||
    lightningSites.length > 0 ||
    (siteStyle === 'risk' && reports.length > 0)
  const showLegend = siteStyle === 'context' || showRiskLegend || extraLegend

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-lg border bg-muted/30',
        height,
        className
      )}
    >
      <MapContainer
        center={selected ? [selected.lat, selected.lon] : US_CENTER}
        zoom={selected ? 10 : 4}
        bounds={bounds}
        boundsOptions={{ padding: [12, 12] }}
        minZoom={3}
        scrollWheelZoom={false}
        dragging={interactive}
        zoomControl={interactive}
        doubleClickZoom={interactive}
        attributionControl
        style={{ height: '100%', width: '100%', background: 'transparent' }}
        className='z-0'
      >
        <TileLayer
          key={`base-${theme}`}
          attribution={ATTRIBUTION}
          url={TILE_URL[theme]}
          maxNativeZoom={16}
        />
        {selected ? (
          <TileLayer
            key={`labels-${theme}`}
            url={LABEL_URL[theme]}
            maxNativeZoom={16}
          />
        ) : null}

        {lightningSites.map(({ site }) => (
          <Circle
            key={`radius-${site.id}`}
            center={[site.lat, site.lon]}
            radius={LIGHTNING_RADIUS_MI * METERS_PER_MILE}
            pathOptions={{
              color: STRIKE_COLOR,
              weight: 1.5,
              dashArray: '4 4',
              fillColor: STRIKE_COLOR,
              fillOpacity: 0.06,
            }}
          />
        ))}

        {strikes.map((strike) => (
          <CircleMarker
            key={strike.id}
            center={[strike.lat, strike.lon]}
            radius={2 + strike.intensity * 2}
            pathOptions={{
              color: STRIKE_COLOR,
              fillColor: STRIKE_COLOR,
              fillOpacity: 0.8,
              weight: 1,
            }}
          >
            <Tooltip>
              Lightning strike · {strike.distanceMi} mi from site
            </Tooltip>
          </CircleMarker>
        ))}

        {ordered.map(({ site, score, activeLightning, hasReports }) => {
          const call = recommendationFromScore(score)
          const color =
            siteStyle === 'risk' ? RECOMMENDATION_HEX[call] : CONTEXT_SITE_COLOR
          const isSelected = site.id === selectedSiteId
          const rank = ranks.get(site.id)
          const handlers = onSelect
            ? { click: () => onSelect(site.id) }
            : undefined
          const tooltip = (
            <Tooltip direction='top' offset={[0, -6]}>
              <span className='font-medium'>
                {rank ? `#${rank} · ` : ''}
                {site.name}
              </span>
              <br />
              {site.county} County, {site.state}
              {siteStyle === 'risk' ? (
                <>
                  <br />
                  Hazard index {score.toFixed(1)} · {call}
                </>
              ) : null}
              {activeLightning ? (
                <>
                  <br />
                  Lightning stop-work active
                </>
              ) : null}
              {hasReports ? (
                <>
                  <br />
                  Recent crew reports
                </>
              ) : null}
            </Tooltip>
          )

          if (rank) {
            return (
              <Marker
                key={site.id}
                position={[site.lat, site.lon]}
                icon={rankIcon(rank, color)}
                zIndexOffset={1000 - rank}
                eventHandlers={handlers}
              >
                {tooltip}
              </Marker>
            )
          }

          return (
            <CircleMarker
              key={site.id}
              center={[site.lat, site.lon]}
              radius={
                isSelected ? 10 : siteStyle === 'risk' ? 4.5 + score * 0.45 : 4
              }
              pathOptions={{
                color: isSelected ? '#ffffff' : color,
                fillColor: color,
                fillOpacity: siteStyle === 'risk' ? 0.85 : 0.6,
                weight: isSelected ? 3 : 1,
              }}
              eventHandlers={handlers}
            >
              {tooltip}
            </CircleMarker>
          )
        })}

        {reports.map((report) => (
          <CircleMarker
            key={report.id}
            center={[report.lat, report.lon]}
            radius={6}
            pathOptions={{
              color: '#ffffff',
              fillColor: REPORT_COLOR[report.severity],
              fillOpacity: 1,
              weight: 2,
            }}
          >
            <Tooltip direction='top' offset={[0, -6]}>
              <span className='font-medium'>
                {REPORT_TYPE_LABEL[report.type]} ·{' '}
                {ALERT_SEVERITY_LABEL[report.severity]}
              </span>
              <br />
              {report.note.length > 70
                ? `${report.note.slice(0, 70)}…`
                : report.note}
              <br />
              {report.reportedBy} · {report.confirmations} confirmations
            </Tooltip>
          </CircleMarker>
        ))}

        <MapFocus site={selected} />
        <FitBounds bounds={bounds} />
      </MapContainer>

      {showLegend ? (
        <div className='pointer-events-none absolute top-2 right-2 z-[500] rounded-md border bg-background/95 px-2.5 py-2 text-[11px] shadow-sm'>
          {siteStyle === 'risk' && showRiskLegend ? (
            <>
              <p className='mb-1 font-medium'>Hazard index</p>
              <ul className='space-y-0.5'>
                <li className='flex items-center gap-1.5'>
                  <LegendDot color={RECOMMENDATION_HEX.GO} /> GO
                  <span className='text-muted-foreground'>&lt; {GO_BELOW}</span>
                </li>
                <li className='flex items-center gap-1.5'>
                  <LegendDot color={RECOMMENDATION_HEX.CAUTION} /> CAUTION
                  <span className='text-muted-foreground'>
                    {GO_BELOW}–{CAUTION_BELOW}
                  </span>
                </li>
                <li className='flex items-center gap-1.5'>
                  <LegendDot color={RECOMMENDATION_HEX['NO-GO']} /> NO-GO
                  <span className='text-muted-foreground'>
                    ≥ {CAUTION_BELOW}
                  </span>
                </li>
              </ul>
            </>
          ) : null}
          {siteStyle === 'context' ? (
            <>
              <p className='mb-1 font-medium'>Crew reports</p>
              <ul className='space-y-0.5'>
                {(['critical', 'warning', 'info'] as const).map((severity) => (
                  <li key={severity} className='flex items-center gap-1.5'>
                    <LegendDot color={REPORT_COLOR[severity]} />
                    {ALERT_SEVERITY_LABEL[severity]}
                  </li>
                ))}
                <li className='flex items-center gap-1.5'>
                  <LegendDot color={CONTEXT_SITE_COLOR} /> Monitored site
                </li>
              </ul>
            </>
          ) : null}
          {extraLegend ? (
            <ul
              className={cn(
                'space-y-0.5',
                (siteStyle === 'context' || showRiskLegend) &&
                  'mt-1.5 border-t pt-1.5'
              )}
            >
              {strikes.length > 0 ? (
                <li className='flex items-center gap-1.5'>
                  <LegendDot color={STRIKE_COLOR} /> Lightning strike
                </li>
              ) : null}
              {lightningSites.length > 0 ? (
                <li className='flex items-center gap-1.5'>
                  <LegendDot color={STRIKE_COLOR} ring /> {LIGHTNING_RADIUS_MI}
                  -mi stop-work radius
                </li>
              ) : null}
              {siteStyle === 'risk' && reports.length > 0 ? (
                <li className='flex items-center gap-1.5'>
                  <LegendDot color={REPORT_COLOR.warning} /> Crew report
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
