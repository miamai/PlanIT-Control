import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { createHazardReport, getSite } from '@/api'
import { Camera, LocateFixed, Loader2, MapPin, Send } from 'lucide-react'
import { type HazardReportType, type Site } from '@/api/types'
import { hasRole, useAuthStore } from '@/stores/auth-store'
import { REPORT_TYPE_ICON, REPORT_TYPE_LABEL } from '@/lib/planit'
import { toastError, toastSuccess } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { planitKeys, useSites } from '@/hooks/use-planit'
import { useProfile } from '@/hooks/use-profile'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Main } from '@/components/layout/main'
import { LocationPicker } from '@/components/planit/location-picker'
import { PageHeading } from '@/components/planit/page-heading'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'
import { SiteCombobox } from './site-combobox'

const TYPES: HazardReportType[] = [
  'lightning',
  'flood',
  'heat',
  'wildfire',
  'storm',
  'wildlife',
  'soil',
]

/** The API rejects reports pinned implausibly far from the chosen site. */
const MAX_DISTANCE_MI = 100

function milesBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

function nearestSite(sites: Site[], point: { lat: number; lon: number }) {
  let best = sites[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of sites) {
    const distance = milesBetween(point, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

export function HazardReportForm({
  defaultSiteId,
  defaultType,
}: {
  defaultSiteId?: string
  defaultType?: HazardReportType
}) {
  const { sites, isLoading, isError, refresh } = useSites()
  const inList = sites.some((site) => site.id === defaultSiteId)
  const target = useQuery({
    queryKey: ['report-target-site', defaultSiteId],
    queryFn: async () => (await getSite(defaultSiteId!)) ?? null,
    enabled: !!defaultSiteId && !inList && !isLoading && !isError,
    retry: false,
  })
  const availableSites =
    target.data && !inList ? [...sites, target.data] : sites
  const resolvingTarget =
    !!defaultSiteId && !inList && !isError && (isLoading || target.isPending)

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading
          title='Report a hazard'
          actions={
            <Button asChild variant='outline' size='sm'>
              <Link to='/hazards/capture' search={{ site: defaultSiteId }}>
                <Camera /> Photo report
              </Link>
            </Button>
          }
        />
        {isError ? (
          <Card>
            <CardContent className='space-y-3'>
              <p role='alert'>Could not load sites.</p>
              <Button variant='outline' onClick={() => void refresh()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : isLoading || resolvingTarget ? (
          <Skeleton className='h-[480px] w-full' />
        ) : availableSites.length === 0 && !defaultSiteId ? (
          <Card>
            <CardContent className='p-10 text-center text-sm text-muted-foreground'>
              No sites are available to report against.
            </CardContent>
          </Card>
        ) : (
          <>
            {defaultSiteId && !inList && !target.data ? (
              <div role='alert' className='mb-4 rounded-lg border p-4 text-sm'>
                {target.isError
                  ? 'Could not load the linked site. Retry, or choose another site.'
                  : 'The linked site is unavailable. Select a site to continue.'}
                {target.isError ? (
                  <Button
                    variant='outline'
                    size='sm'
                    className='ms-2'
                    onClick={() => void target.refetch()}
                  >
                    Retry linked site
                  </Button>
                ) : null}
              </div>
            ) : null}
            <ReportFormFields
              key={`${defaultSiteId ?? 'new'}:${defaultType ?? 'soil'}:${availableSites.some((site) => site.id === defaultSiteId) ? 'resolved' : 'unselected'}`}
              sites={availableSites}
              defaultSiteId={defaultSiteId}
              defaultType={defaultType}
            />
          </>
        )}
      </Main>
    </>
  )
}

function ReportFormFields({
  sites,
  defaultSiteId,
  defaultType,
}: {
  sites: Site[]
  defaultSiteId?: string
  defaultType?: HazardReportType
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const authUser = useAuthStore((state) => state.auth.user)
  const profile = useProfile()

  const [siteId, setSiteId] = useState(
    sites.some((s) => s.id === defaultSiteId) ? defaultSiteId! : ''
  )
  const [type, setType] = useState<HazardReportType>(defaultType ?? 'soil')
  const [note, setNote] = useState('')
  const site = useMemo(
    () => sites.find((s) => s.id === siteId),
    [sites, siteId]
  )
  const [location, setLocation] = useState<{ lat: number; lon: number }>({
    lat: site?.lat ?? 39,
    lon: site?.lon ?? -98,
  })
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState('')

  const createMutation = useMutation({
    mutationFn: createHazardReport,
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({ queryKey: ['hazard-reports'] })
      // Wildlife reports are shared with nearby sites and can raise alerts.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: planitKeys.alerts }),
        queryClient.invalidateQueries({ queryKey: ['site'] }),
        queryClient.invalidateQueries({ queryKey: planitKeys.rankings }),
        queryClient.invalidateQueries({ queryKey: planitKeys.briefings }),
      ])
      toastSuccess(
        'Hazard shared',
        `${REPORT_TYPE_LABEL[report.type]} report sent to the network.`
      )
      navigate({
        to: hasRole(authUser, 'admin') ? '/hazards' : '/sites/$siteId',
        params: { siteId: report.siteId },
      })
    },
  })

  function locateMe() {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported on this device.')
      return
    }
    setLocating(true)
    setGeoError('')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: Number(position.coords.latitude.toFixed(5)),
          lon: Number(position.coords.longitude.toFixed(5)),
        }
        setLocation(point)
        const nearest = nearestSite(sites, point)
        if (nearest) setSiteId(nearest.id)
        setLocating(false)
      },
      (error) => {
        setGeoError(error.message)
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    )
  }

  function chooseSite(id: string) {
    const next = sites.find((s) => s.id === id)
    if (!next) return
    setSiteId(id)
    setLocation({ lat: next.lat, lon: next.lon })
  }

  const distanceToSite = site ? milesBetween(location, site) : 0

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!site) {
      toastError(
        'Select a site',
        'Choose the site for this report before submitting.'
      )
      return
    }
    if (note.trim().length < 3) {
      toastError(
        'Note required',
        'Describe what the crew is seeing on the ground.'
      )
      return
    }
    if (distanceToSite > MAX_DISTANCE_MI) {
      toastError(
        'Pin too far from site',
        `Move the pin within ${MAX_DISTANCE_MI} mi of ${site.name}, or pick the nearest site.`
      )
      return
    }
    createMutation.mutate({
      siteId,
      type,
      note: note.trim(),
      lat: location.lat,
      lon: location.lon,
    })
  }

  return (
    <form onSubmit={handleSubmit} className='grid gap-4 lg:grid-cols-3'>
      <div className='min-w-0 space-y-4 lg:col-span-2'>
        <Card className='gap-5'>
          <PanelHeader title='Hazard' />
          <CardContent className='space-y-5'>
            <div className='space-y-2'>
              <Label id='hazard-type-label' className='sr-only'>
                Hazard type
              </Label>
              <div
                role='radiogroup'
                aria-labelledby='hazard-type-label'
                className='grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-7'
              >
                {TYPES.map((reportType) => {
                  const Icon = REPORT_TYPE_ICON[reportType]
                  const active = type === reportType
                  return (
                    <button
                      key={reportType}
                      type='button'
                      role='radio'
                      aria-checked={active}
                      onClick={() => setType(reportType)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors',
                        active
                          ? 'border-foreground bg-accent'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                    >
                      <Icon className='size-5' />
                      <span className='text-center leading-tight'>
                        {REPORT_TYPE_LABEL[reportType]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='note'>What&apos;s happening?</Label>
              <Textarea
                id='note'
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder='e.g. Standing water across the access road, rising fast after overnight rain.'
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card className='gap-5'>
          <PanelHeader title='Location' />
          <CardContent className='space-y-4'>
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={
                  sites.length === 0 || locating || createMutation.isPending
                }
                onClick={locateMe}
              >
                {locating ? (
                  <Loader2 className='animate-spin' />
                ) : (
                  <LocateFixed />
                )}
                Use my GPS
              </Button>
              <Button
                type='button'
                variant='ghost'
                disabled={!site || createMutation.isPending}
                onClick={() => {
                  const nearest = nearestSite(sites, location)
                  if (nearest) chooseSite(nearest.id)
                }}
              >
                <MapPin /> Snap to nearest site
              </Button>
              {site ? (
                <span className='ms-auto text-xs text-muted-foreground tabular-nums'>
                  {location.lat.toFixed(5)}, {location.lon.toFixed(5)}
                </span>
              ) : null}
            </div>
            {geoError ? (
              <p className='text-xs text-red-600'>{geoError}</p>
            ) : null}
            {site ? (
              <LocationPicker
                value={location}
                site={site}
                onChange={setLocation}
              />
            ) : (
              <p className='rounded-lg border border-dashed p-6 text-sm text-muted-foreground'>
                Select a site to place the hazard pin.
              </p>
            )}
            <div className='space-y-2'>
              <Label>Site</Label>
              <SiteCombobox
                sites={sites}
                value={siteId}
                onChange={chooseSite}
                disabled={createMutation.isPending}
              />
              {site && distanceToSite >= 0.1 ? (
                <p
                  className={cn(
                    'text-xs',
                    distanceToSite > MAX_DISTANCE_MI
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  )}
                >
                  Pin is {distanceToSite.toFixed(1)} mi from {site.name}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <Card className='gap-5 lg:sticky lg:top-4'>
          <PanelHeader title='Reporter' />
          <CardContent className='space-y-4'>
            <p className='text-sm'>
              Reporting as <span className='font-medium'>{profile.name}</span>
              <span className='text-muted-foreground'>
                {' '}
                · {profile.roleLabel}
              </span>
            </p>
            <Button
              type='submit'
              size='lg'
              className='w-full'
              disabled={createMutation.isPending || !site}
            >
              {createMutation.isPending ? (
                <Loader2 className='animate-spin' />
              ) : (
                <Send />
              )}
              Submit
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}
