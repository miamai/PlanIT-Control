import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createHazardReport } from '@/api'
import { Camera, LocateFixed, Loader2, MapPin, Send, X } from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { type AlertSeverity, type HazardReportType } from '@/api/types'
import { REPORT_TYPE_ICON, REPORT_TYPE_LABEL } from '@/lib/planit'
import { toastError, toastSuccess } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useProfile } from '@/hooks/use-profile'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Main } from '@/components/layout/main'
import { LocationPicker } from '@/components/planit/location-picker'
import { PageHeading } from '@/components/planit/page-heading'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'
import { AlertSeverityStatus } from '@/components/planit/risk-status'

const TYPES: HazardReportType[] = [
  'lightning',
  'flood',
  'heat',
  'wildfire',
  'storm',
  'wildlife',
  'soil',
]

const SEVERITIES: {
  value: AlertSeverity
  hint: string
}[] = [
  {
    value: 'info',
    hint: 'Heads up',
  },
  {
    value: 'warning',
    hint: 'Take action',
  },
  {
    value: 'critical',
    hint: 'Stop work',
  },
]

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

function nearestSite(point: { lat: number; lon: number }) {
  let best = SITE_SEED[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of SITE_SEED) {
    const distance = milesBetween(point, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

function useDefaultLocation(siteId?: string) {
  const site = SITE_SEED.find((s) => s.id === siteId) ?? SITE_SEED[0]
  return { lat: site.lat, lon: site.lon, site }
}

export function HazardReportForm({
  defaultSiteId,
}: {
  defaultSiteId?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const profile = useProfile()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [siteId, setSiteId] = useState(defaultSiteId ?? SITE_SEED[0].id)
  const [type, setType] = useState<HazardReportType>('soil')
  const [severity, setSeverity] = useState<AlertSeverity>('warning')
  const [note, setNote] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | undefined>()
  const [photoName, setPhotoName] = useState('')
  const [reporterRole, setReporterRole] = useState<'crew' | 'supervisor'>(
    profile.role
  )
  const [reportedBy, setReportedBy] = useState(profile.name)

  const defaults = useDefaultLocation(siteId)
  const [location, setLocation] = useState<{ lat: number; lon: number }>({
    lat: defaults.lat,
    lon: defaults.lon,
  })
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState('')

  const site = useMemo(
    () => SITE_SEED.find((s) => s.id === siteId) ?? SITE_SEED[0],
    [siteId]
  )

  const createMutation = useMutation({
    mutationFn: createHazardReport,
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({ queryKey: ['hazard-reports'] })
      toastSuccess(
        'Hazard shared',
        `${REPORT_TYPE_LABEL[report.type]} report sent to the network.`
      )
      navigate({ to: '/hazards' })
    },
  })

  function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setPhotoUrl(String(reader.result))
      setPhotoName(file.name)
    }
    reader.readAsDataURL(file)
  }

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
        setSiteId(nearestSite(point).id)
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
    const next = SITE_SEED.find((s) => s.id === id)
    setSiteId(id)
    if (next) setLocation({ lat: next.lat, lon: next.lon })
  }

  const distanceToSite = milesBetween(location, site)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!note.trim()) {
      toastError(
        'Note required',
        'Describe what the crew is seeing on the ground.'
      )
      return
    }
    createMutation.mutate({
      siteId,
      type,
      severity,
      note: note.trim(),
      photoUrl,
      lat: location.lat,
      lon: location.lon,
      reportedBy: reportedBy.trim() || 'crew@planit.control',
      reporterRole,
    })
  }

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading title='Report a hazard' />

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
                  <Label id='severity-label'>Severity</Label>
                  <RadioGroup
                    value={severity}
                    onValueChange={(value) =>
                      setSeverity(value as AlertSeverity)
                    }
                    aria-labelledby='severity-label'
                    className='grid grid-cols-1 gap-2 min-[400px]:grid-cols-3'
                  >
                    {SEVERITIES.map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          'flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring/50',
                          severity === option.value
                            ? 'border-foreground/50 bg-muted ring-1 ring-foreground/15'
                            : 'hover:bg-muted/50'
                        )}
                      >
                        <RadioGroupItem
                          value={option.value}
                          className='sr-only'
                        />
                        <AlertSeverityStatus severity={option.value} />
                        <span className='text-xs text-muted-foreground'>
                          {option.hint}
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
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

                <div className='space-y-2'>
                  <Label>Photo</Label>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='image/*'
                    capture='environment'
                    className='hidden'
                    onChange={handlePhoto}
                  />
                  {photoUrl ? (
                    <div className='flex items-center gap-3 rounded-lg border p-2'>
                      <img
                        src={photoUrl}
                        alt='Hazard preview'
                        className='size-16 rounded-md object-cover'
                      />
                      <span className='min-w-0 flex-1 truncate text-sm text-muted-foreground'>
                        {photoName}
                      </span>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        aria-label='Remove photo'
                        onClick={() => {
                          setPhotoUrl(undefined)
                          setPhotoName('')
                        }}
                      >
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <button
                      type='button'
                      onClick={() => fileInputRef.current?.click()}
                      className='flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground'
                    >
                      <Camera className='size-6' />
                      <span className='font-medium text-foreground'>
                        Add photo
                      </span>
                    </button>
                  )}
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
                    onClick={() => setSiteId(nearestSite(location).id)}
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
                      {SITE_SEED.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name} · {option.state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {distanceToSite >= 0.1 ? (
                    <p className='text-xs text-muted-foreground'>
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
                <div className='space-y-2'>
                  <Label htmlFor='reporter'>Name / call sign</Label>
                  <Input
                    id='reporter'
                    value={reportedBy}
                    onChange={(e) => setReportedBy(e.target.value)}
                  />
                </div>
                <div className='space-y-2'>
                  <Label>Role</Label>
                  <RadioGroup
                    value={reporterRole}
                    onValueChange={(value) =>
                      setReporterRole(value as 'crew' | 'supervisor')
                    }
                    className='flex gap-4'
                  >
                    <label className='flex items-center gap-2 text-sm'>
                      <RadioGroupItem value='crew' /> Crew
                    </label>
                    <label className='flex items-center gap-2 text-sm'>
                      <RadioGroupItem value='supervisor' /> Supervisor
                    </label>
                  </RadioGroup>
                </div>
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
      </Main>
    </>
  )
}
