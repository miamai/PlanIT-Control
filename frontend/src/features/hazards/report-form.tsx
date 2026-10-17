import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createHazardReport } from '@/api'
import { LocateFixed, Loader2, MapPin, Send } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Main } from '@/components/layout/main'
import { LocationPicker } from '@/components/planit/location-picker'
import { PageHeading } from '@/components/planit/page-heading'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'

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
}: {
  defaultSiteId?: string
}) {
  const { sites, isLoading } = useSites()

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading title='Report a hazard' />
        {isLoading ? (
          <Skeleton className='h-[480px] w-full' />
        ) : sites.length === 0 ? (
          <Card>
            <CardContent className='p-10 text-center text-sm text-muted-foreground'>
              No sites are available to report against.
            </CardContent>
          </Card>
        ) : (
          <ReportFormFields sites={sites} defaultSiteId={defaultSiteId} />
        )}
      </Main>
    </>
  )
}

function ReportFormFields({
  sites,
  defaultSiteId,
}: {
  sites: Site[]
  defaultSiteId?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const authUser = useAuthStore((state) => state.auth.user)
  const profile = useProfile()

  const [siteId, setSiteId] = useState(
    sites.some((s) => s.id === defaultSiteId) ? defaultSiteId! : sites[0].id
  )
  const [type, setType] = useState<HazardReportType>('soil')
  const [note, setNote] = useState('')
  const site = useMemo(
    () => sites.find((s) => s.id === siteId) ?? sites[0],
    [sites, siteId]
  )
  const [location, setLocation] = useState<{ lat: number; lon: number }>({
    lat: site.lat,
    lon: site.lon,
  })
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState('')

  const createMutation = useMutation({
    mutationFn: createHazardReport,
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({ queryKey: ['hazard-reports'] })
      // Wildlife reports are shared with nearby sites and can raise alerts.
      await queryClient.invalidateQueries({ queryKey: planitKeys.alerts })
      toastSuccess(
        'Hazard shared',
        `${REPORT_TYPE_LABEL[report.type]} report sent to the network.`
      )
      navigate({
        to: hasRole(authUser, 'supervisor') ? '/hazards' : '/sites/$siteId',
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
        setSiteId(nearestSite(sites, point).id)
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
    setSiteId(id)
    if (next) setLocation({ lat: next.lat, lon: next.lon })
  }

  const distanceToSite = milesBetween(location, site)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
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
              <Button type='button' variant='outline' onClick={locateMe}>
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
                onClick={() => setSiteId(nearestSite(sites, location).id)}
              >
                <MapPin /> Snap to nearest site
              </Button>
              <span className='ms-auto text-xs text-muted-foreground tabular-nums'>
                {location.lat.toFixed(5)}, {location.lon.toFixed(5)}
              </span>
            </div>
            {geoError ? (
              <p className='text-xs text-red-600'>{geoError}</p>
            ) : null}
            <LocationPicker
              value={location}
              site={site}
              onChange={setLocation}
            />
            <div className='space-y-2'>
              <Label>Site</Label>
              <Select value={siteId} onValueChange={chooseSite}>
                <SelectTrigger className='w-full sm:w-80'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className='max-h-72'>
                  {sites.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name} · {option.state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {distanceToSite >= 0.1 ? (
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
              disabled={createMutation.isPending}
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
