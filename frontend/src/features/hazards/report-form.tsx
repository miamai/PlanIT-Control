import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createHazardReport } from '@/api'
import {
  Camera,
  LocateFixed,
  Loader2,
  MapPin,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { SITE_SEED } from '@/api/mock/sites-data'
import { type AlertSeverity, type HazardReportType } from '@/api/types'
import { useAuthStore } from '@/stores/auth-store'
import { REPORT_TYPE_LABEL } from '@/lib/planit'
import { toastError, toastSuccess } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

const SEVERITIES: { value: AlertSeverity; label: string; tone: string }[] = [
  {
    value: 'info',
    label: 'Info — heads up',
    tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  {
    value: 'warning',
    label: 'Warning — take action',
    tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  {
    value: 'critical',
    label: 'Critical — stop work',
    tone: 'bg-red-500/10 text-red-700 dark:text-red-300',
  },
]

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
  const authUser = useAuthStore((state) => state.auth.user)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [siteId, setSiteId] = useState(defaultSiteId ?? SITE_SEED[0].id)
  const [type, setType] = useState<HazardReportType>('soil')
  const [severity, setSeverity] = useState<AlertSeverity>('warning')
  const [note, setNote] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | undefined>()
  const [photoName, setPhotoName] = useState('')
  const [reporterRole, setReporterRole] = useState<'crew' | 'supervisor'>(
    authUser?.role.includes('supervisor') ? 'supervisor' : 'crew'
  )
  const [reportedBy, setReportedBy] = useState(
    authUser?.email ?? 'crew@planit.control'
  )

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
        setLocation({
          lat: Number(position.coords.latitude.toFixed(5)),
          lon: Number(position.coords.longitude.toFixed(5)),
        })
        setLocating(false)
      },
      (error) => {
        setGeoError(error.message)
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    )
  }

  function pickNearestSite() {
    let best = SITE_SEED[0]
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of SITE_SEED) {
      const distance =
        (candidate.lat - location.lat) ** 2 +
        (candidate.lon - location.lon) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        best = candidate
      }
    }
    setSiteId(best.id)
  }

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
      <PlanitHeader active='hazards' />
      <Main>
        <div className='mb-6 max-w-xl space-y-1'>
          <h1 className='text-2xl font-bold tracking-tight'>Report a hazard</h1>
          <p className='text-sm text-muted-foreground'>
            30 seconds from the field: snap a photo, drop a pin, pick a type.
            Every report is shared instantly with other crews and network
            owners.
          </p>
        </div>

        <form onSubmit={handleSubmit} className='grid gap-4 lg:grid-cols-3'>
          <div className='space-y-4 lg:col-span-2'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>What did you find?</CardTitle>
              </CardHeader>
              <CardContent className='space-y-5'>
                <div className='space-y-2'>
                  <Label>Hazard type</Label>
                  <Select
                    value={type}
                    onValueChange={(value) =>
                      setType(value as HazardReportType)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((reportType) => (
                        <SelectItem key={reportType} value={reportType}>
                          {REPORT_TYPE_LABEL[reportType]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-2'>
                  <Label>Severity</Label>
                  <RadioGroup
                    value={severity}
                    onValueChange={(value) =>
                      setSeverity(value as AlertSeverity)
                    }
                    className='grid gap-2 sm:grid-cols-3'
                  >
                    {SEVERITIES.map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm transition-colors',
                          severity === option.value
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        )}
                      >
                        <RadioGroupItem value={option.value} />
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase',
                            option.tone
                          )}
                        >
                          {option.value}
                        </span>
                        <span className='text-xs text-muted-foreground'>
                          {option.label.split('—')[1]}
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
                    placeholder='e.g. Standing water across access road, water rising fast after overnight rain.'
                    rows={4}
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
                  <div className='flex flex-wrap items-center gap-3'>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Camera /> Take or attach photo
                    </Button>
                    {photoUrl ? (
                      <div className='flex items-center gap-2'>
                        <img
                          src={photoUrl}
                          alt='Hazard preview'
                          className='size-14 rounded-md border object-cover'
                        />
                        <span className='max-w-[140px] truncate text-xs text-muted-foreground'>
                          {photoName}
                        </span>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            setPhotoUrl(undefined)
                            setPhotoName('')
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <span className='text-xs text-muted-foreground'>
                        Optional but strongly encouraged.
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>Where is it?</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex flex-wrap items-center gap-3'>
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
                    onClick={pickNearestSite}
                  >
                    <MapPin /> Nearest monitored site
                  </Button>
                  <span className='text-xs text-muted-foreground tabular-nums'>
                    {location.lat.toFixed(5)}, {location.lon.toFixed(5)}
                  </span>
                </div>
                {geoError ? (
                  <p className='text-xs text-red-600'>
                    {geoError} — pin defaulted to the selected site. You can
                    still submit.
                  </p>
                ) : null}
                <div className='space-y-2'>
                  <Label>Nearest site (shared with)</Label>
                  <Select value={siteId} onValueChange={setSiteId}>
                    <SelectTrigger>
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
                  <p className='text-xs text-muted-foreground'>
                    {site.utility} · {site.county} County, {site.state} ·{' '}
                    {site.capacityMw.toLocaleString()} MW
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className='space-y-4'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>Filed by</CardTitle>
              </CardHeader>
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
                  className='w-full'
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className='animate-spin' />
                  ) : (
                    <Send />
                  )}
                  Share with network
                </Button>
                <p className='flex items-start gap-2 text-xs text-muted-foreground'>
                  <ShieldCheck className='mt-0.5 size-3.5 shrink-0' />
                  Shared with network owners — visible to every crew on this
                  site&apos;s utility. Last synced{' '}
                  {format(new Date(), 'HH:mm:ss')}.
                </p>
              </CardContent>
            </Card>
          </div>
        </form>
      </Main>
    </>
  )
}
