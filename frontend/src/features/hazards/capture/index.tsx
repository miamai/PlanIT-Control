import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  chooseCaptureType,
  sendCaptureFrame,
  skipCaptureStep,
  startCapture,
  submitCapture,
} from '@/api'
import {
  Camera,
  Check,
  CircleDashed,
  FileText,
  Loader2,
  RefreshCw,
  ScanLine,
  Send,
  SkipForward,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { ApiError } from '@/api/client'
import {
  type CaptureFeedback,
  type CaptureSession,
  type HazardReportType,
  type Site,
} from '@/api/types'
import { hasRole, useAuthStore } from '@/stores/auth-store'
import { REPORT_TYPE_ICON, REPORT_TYPE_LABEL } from '@/lib/planit'
import { toastError, toastSuccess } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { planitKeys, useSites } from '@/hooks/use-planit'
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
import { PageHeading } from '@/components/planit/page-heading'
import { PlanitHeader } from '@/components/planit/planit-header'
import { useCamera, useSteadyShot } from './use-camera'
import {
  type Position,
  useCompassHeading,
  useSpeech,
  useWatchedPosition,
} from './use-sensors'

const TYPES: HazardReportType[] = [
  'flood',
  'wildfire',
  'storm',
  'lightning',
  'heat',
  'wildlife',
  'soil',
]

/** Pause between the two photos of a two-photo step (water flow). */
const PAIR_GAP_MS = 2000

function milesBetween(a: Position, b: Position): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

function nearestSite(sites: Site[], point: Position): Site {
  return sites.reduce((best, site) =>
    milesBetween(point, site) < milesBetween(point, best) ? site : best
  )
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

export function GuidedCapture({ defaultSiteId }: { defaultSiteId?: string }) {
  const { sites, isLoading } = useSites()

  return (
    <>
      <PlanitHeader />
      <Main fluid className='mx-auto w-full max-w-xl'>
        {isLoading ? (
          <>
            <CaptureHeading siteId={defaultSiteId} />
            <Skeleton className='h-[480px] w-full' />
          </>
        ) : sites.length === 0 ? (
          <>
            <CaptureHeading siteId={defaultSiteId} />
            <Card>
              <CardContent className='p-10 text-center text-sm text-muted-foreground'>
                No sites are available to report against.
              </CardContent>
            </Card>
          </>
        ) : (
          <CaptureFlow sites={sites} defaultSiteId={defaultSiteId} />
        )}
      </Main>
    </>
  )
}

/** Page title with a way out to the form. Left off while the camera is up, to give it the screen. */
function CaptureHeading({ siteId }: { siteId?: string }) {
  return (
    <PageHeading
      title='Photo report'
      description='The camera walks you through the shots that describe the hazard.'
      actions={
        <Button asChild variant='outline' size='sm'>
          <Link to='/hazards/new' search={{ site: siteId }}>
            <FileText /> Use the form
          </Link>
        </Button>
      }
    />
  )
}

function CaptureFlow({
  sites,
  defaultSiteId,
}: {
  sites: Site[]
  defaultSiteId?: string
}) {
  const { videoRef, state: cameraState, start, stop, grab } = useCamera()
  const compass = useCompassHeading()
  const speech = useSpeech()
  const gps = useWatchedPosition()
  const inFlight = useRef(false)

  // Until the crew picks one, the site is the nearest to their GPS fix.
  const [pickedSiteId, setPickedSiteId] = useState(
    sites.some((s) => s.id === defaultSiteId) ? defaultSiteId : undefined
  )
  const siteId =
    pickedSiteId ?? (gps ? nearestSite(sites, gps).id : sites[0].id)
  const site = sites.find((s) => s.id === siteId) ?? sites[0]
  const [starting, setStarting] = useState(false)
  const [session, setSession] = useState<CaptureSession>()
  const [feedback, setFeedback] = useState<CaptureFeedback>()
  const [evidence, setEvidence] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState<number>()
  const [choosingType, setChoosingType] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [unavailable, setUnavailable] = useState<string>()
  const [auto, setAuto] = useState(true)

  // Without a GPS fix yet, photos are pinned to the site, as the form does.
  const position = useMemo<Position>(
    () => gps ?? { lat: site.lat, lon: site.lon },
    [gps, site]
  )

  const step = session?.status === 'active' ? session.nextStep : undefined
  const confirming =
    !!session &&
    !session.type &&
    !!feedback?.satisfied &&
    feedback.item === 'identify' &&
    !!feedback.typeGuess
  const capturing =
    !!step && !reviewing && !confirming && !choosingType && !unavailable
  const shot = useSteadyShot(
    videoRef,
    capturing && auto && !busy && cameraState === 'live',
    () => void snap()
  )

  function failed(error: unknown) {
    if (error instanceof ApiError && error.status === 503) {
      setUnavailable(error.detail ?? error.message)
    } else {
      toastError(
        'Something went wrong',
        error instanceof ApiError ? (error.detail ?? error.message) : undefined
      )
    }
  }

  /** Take in a new session state: read out what changed and free the camera when done. */
  function advance(next: CaptureSession, result?: CaptureFeedback) {
    setSession(next)
    setFeedback(result)
    if (next.danger) {
      stop()
      speech.say(next.danger.instruction, true)
    } else if (result?.hint && !result.satisfied) {
      speech.say(result.hint)
    } else if (next.nextStep && next.nextStep.item !== step?.item) {
      speech.say(next.nextStep.instruction)
    }
    if (
      next.status !== 'active' ||
      !next.nextStep ||
      (next.type && !next.guided)
    ) {
      stop()
    }
  }

  async function begin() {
    setStarting(true)
    try {
      const [granted] = await Promise.all([start(), compass.enable()])
      if (granted) advance(await startCapture({ siteId, ...position }))
    } catch (error) {
      failed(error)
    } finally {
      setStarting(false)
    }
  }

  async function snap() {
    if (!session || !step || inFlight.current) return
    const first = grab()
    if (!first) return
    inFlight.current = true
    shot.rearm()
    setBusy(true)
    const images = [first]
    try {
      for (let i = 1; i < step.frames; i++) {
        setCountdown(PAIR_GAP_MS / 1000)
        await sleep(PAIR_GAP_MS / 2)
        setCountdown(PAIR_GAP_MS / 2000)
        await sleep(PAIR_GAP_MS / 2)
        setCountdown(undefined)
        const next = grab()
        if (next) images.push(next)
      }
      const result = await sendCaptureFrame(session.id, {
        item: step.item,
        images,
        ...position,
        headingDeg:
          compass.heading === undefined
            ? undefined
            : Math.round(compass.heading * 10) / 10,
      })
      if (result.feedback.satisfied) {
        setEvidence((e) => ({ ...e, [step.item]: images }))
      }
      advance(result.session, result.feedback)
    } catch (error) {
      failed(error)
    } finally {
      inFlight.current = false
      setBusy(false)
      setCountdown(undefined)
    }
  }

  async function chooseType(type: HazardReportType) {
    if (!session) return
    try {
      advance(await chooseCaptureType(session.id, type))
      setChoosingType(false)
    } catch (error) {
      failed(error)
    }
  }

  async function skip() {
    if (!session || !step || busy) return
    try {
      advance(await skipCaptureStep(session.id, step.item))
      shot.rearm()
    } catch (error) {
      failed(error)
    }
  }

  const page = (content: React.ReactNode) => (
    <>
      <CaptureHeading siteId={session?.siteId ?? siteId} />
      {content}
    </>
  )

  if (unavailable) {
    return page(
      <Notice
        icon={CircleDashed}
        title='Photo checks are unavailable'
        body={unavailable}
        action={
          <Button asChild>
            <Link to='/hazards/new' search={{ site: siteId }}>
              <FileText /> Use the form
            </Link>
          </Button>
        }
      />
    )
  }

  if (cameraState === 'denied' || cameraState === 'unsupported') {
    return page(
      <Notice
        icon={Camera}
        title={
          cameraState === 'denied'
            ? 'Camera access is blocked'
            : 'This browser has no camera access'
        }
        body='Allow the camera for this site in your browser settings, or send the report with the form.'
        action={
          <Button asChild>
            <Link to='/hazards/new' search={{ site: siteId }}>
              <FileText /> Use the form
            </Link>
          </Button>
        }
      />
    )
  }

  if (session?.danger) {
    return page(<SafetyStop session={session} />)
  }

  if (session?.type && !session.guided) {
    return page(
      <Notice
        icon={FileText}
        title='Photo guidance covers flooding for now'
        body={`Send this ${REPORT_TYPE_LABEL[session.type].toLowerCase()} report with the form instead.`}
        action={
          <Button asChild>
            <Link
              to='/hazards/new'
              search={{ site: session.siteId, type: session.type }}
            >
              <FileText /> Continue with the form
            </Link>
          </Button>
        }
      />
    )
  }

  if (session && session.status === 'active' && (reviewing || !step)) {
    return page(
      <Review
        session={session}
        evidence={evidence}
        onBack={step ? () => setReviewing(false) : undefined}
      />
    )
  }

  if (!session) {
    return page(
      <Card>
        <CardContent className='space-y-5'>
          <div className='space-y-2'>
            <Label>Site</Label>
            <Select value={siteId} onValueChange={setPickedSiteId}>
              <SelectTrigger className='w-full'>
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
          </div>
          <ul className='space-y-2 text-sm text-muted-foreground'>
            <li>Point the camera at the hazard from where you are.</li>
            <li>
              Each step asks for one shot. Hold the phone still and it takes the
              photo for you.
            </li>
            <li>Never move closer to water, fire or animals to get a shot.</li>
          </ul>
          <Button
            size='lg'
            className='w-full'
            onClick={begin}
            disabled={starting}
          >
            {starting ? <Loader2 className='animate-spin' /> : <Camera />}
            Start camera
          </Button>
        </CardContent>
      </Card>
    )
  }

  const instruction = confirming
    ? 'Is this the hazard you are reporting?'
    : choosingType
      ? 'What are you reporting?'
      : (step?.instruction ?? '')

  return (
    <div className='space-y-3'>
      <Card className='gap-0 overflow-hidden py-0'>
        <p
          aria-live='polite'
          className='flex min-h-16 items-center px-4 py-3 text-base leading-snug font-medium'
        >
          {instruction}
        </p>
        <div className='relative aspect-[3/4] max-h-[52dvh] w-full bg-black'>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className='absolute inset-0 size-full object-cover'
          />
          <div className='pointer-events-none absolute inset-5 rounded-md border-2 border-dashed border-white/40' />
          {countdown ? (
            <div className='absolute inset-0 flex items-center justify-center text-6xl font-semibold text-white tabular-nums'>
              {countdown}
            </div>
          ) : null}
          {busy && !countdown ? (
            <div className='absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs text-white'>
              <Loader2 className='size-3.5 animate-spin' /> Checking
            </div>
          ) : null}
          {auto && capturing && !busy ? (
            <div className='absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs text-white'>
              <ScanLine className='size-3.5' />
              Hold still to take the photo
            </div>
          ) : null}
        </div>
        <FeedbackLine feedback={feedback} />

        {confirming && feedback?.typeGuess ? (
          <div className='flex flex-wrap gap-2 border-t px-4 py-3'>
            <Button onClick={() => chooseType(feedback.typeGuess!)}>
              <Check /> Yes,{' '}
              {REPORT_TYPE_LABEL[feedback.typeGuess].toLowerCase()}
            </Button>
            <Button
              variant='outline'
              onClick={() => {
                setChoosingType(true)
                setFeedback(undefined)
                speech.say('What are you reporting?')
              }}
            >
              Something else
            </Button>
          </div>
        ) : choosingType ? (
          <TypePicker onPick={chooseType} />
        ) : (
          <div className='flex items-center justify-between gap-2 border-t px-4 py-3'>
            <Button
              variant='ghost'
              size='sm'
              onClick={skip}
              disabled={!session.type || busy}
            >
              <SkipForward /> Skip
            </Button>
            <button
              type='button'
              aria-label='Take photo'
              onClick={() => void snap()}
              disabled={busy || !capturing}
              className='size-16 shrink-0 rounded-full border-4 border-foreground/80 bg-background transition-transform active:scale-95 disabled:opacity-50'
            />
            <div className='flex items-center gap-1'>
              <Button
                variant={auto ? 'secondary' : 'ghost'}
                size='sm'
                aria-pressed={auto}
                onClick={() => setAuto((a) => !a)}
              >
                Auto
              </Button>
              {speech.supported ? (
                <Button
                  variant={speech.enabled ? 'secondary' : 'ghost'}
                  size='icon'
                  aria-label={
                    speech.enabled ? 'Stop reading aloud' : 'Read aloud'
                  }
                  aria-pressed={speech.enabled}
                  onClick={() => speech.setEnabled((v) => !v)}
                >
                  {speech.enabled ? <Volume2 /> : <VolumeX />}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Card>

      {session.type ? (
        <Progress session={session} onFinish={() => setReviewing(true)} />
      ) : null}
      <p className='text-xs text-muted-foreground tabular-nums'>
        {gps
          ? `GPS ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`
          : `No GPS fix yet; photos are pinned to ${site.name}.`}
        {compass.heading !== undefined
          ? ` · facing ${Math.round(compass.heading)}°`
          : ''}
      </p>
    </div>
  )
}

function FeedbackLine({ feedback }: { feedback?: CaptureFeedback }) {
  return (
    <p
      aria-live='polite'
      className='flex min-h-11 items-center gap-2 border-t px-4 py-2 text-sm'
    >
      {feedback?.satisfied && feedback.text ? (
        <>
          <Check className='size-4 shrink-0 text-emerald-600' />
          {feedback.text}
        </>
      ) : feedback?.hint ? (
        <>
          <RefreshCw className='size-4 shrink-0 text-amber-600' />
          {feedback.hint}
        </>
      ) : null}
    </p>
  )
}

function TypePicker({ onPick }: { onPick: (type: HazardReportType) => void }) {
  return (
    <div className='grid grid-cols-4 gap-2 border-t px-4 py-3 sm:grid-cols-7'>
      {TYPES.map((type) => {
        const Icon = REPORT_TYPE_ICON[type]
        return (
          <button
            key={type}
            type='button'
            onClick={() => onPick(type)}
            className='flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
          >
            <Icon className='size-5' />
            <span className='text-center leading-tight'>
              {REPORT_TYPE_LABEL[type]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Progress({
  session,
  onFinish,
}: {
  session: CaptureSession
  onFinish: () => void
}) {
  return (
    <div className='flex items-center gap-2'>
      <ol className='flex flex-1 gap-1.5' aria-label='Steps'>
        {session.checklist.map((item) => (
          <li
            key={item.item}
            title={item.text ?? item.instruction}
            aria-label={`${item.item}: ${item.status}`}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              item.status === 'done'
                ? 'bg-emerald-500'
                : item.status === 'skipped'
                  ? 'bg-muted-foreground/40'
                  : item.item === session.nextStep?.item
                    ? 'bg-foreground/60'
                    : 'bg-muted'
            )}
          />
        ))}
      </ol>
      <Button variant='ghost' size='sm' onClick={onFinish}>
        Finish now
      </Button>
    </div>
  )
}

function useSubmitCapture(session: CaptureSession) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const authUser = useAuthStore((state) => state.auth.user)
  return useMutation({
    mutationFn: (note: string) => submitCapture(session.id, note),
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({ queryKey: ['hazard-reports'] })
      await queryClient.invalidateQueries({ queryKey: planitKeys.alerts })
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
}

function Review({
  session,
  evidence,
  onBack,
}: {
  session: CaptureSession
  evidence: Record<string, string[]>
  onBack?: () => void
}) {
  const [note, setNote] = useState(session.draft)
  const [error, setError] = useState<string>()
  const submit = useSubmitCapture(session)

  function send() {
    if (note.trim().length < 3) {
      setError('Describe what the crew is seeing on the ground.')
      return
    }
    submit.mutate(note.trim())
  }

  return (
    <Card>
      <CardContent className='space-y-5'>
        <ul className='space-y-3'>
          {session.checklist.map((item) => (
            <li key={item.item} className='flex items-start gap-3'>
              {evidence[item.item]?.length ? (
                <div className='flex shrink-0 gap-1'>
                  {evidence[item.item].map((image, i) => (
                    <img
                      key={i}
                      src={`data:image/jpeg;base64,${image}`}
                      alt=''
                      className='size-14 rounded-md object-cover'
                    />
                  ))}
                </div>
              ) : (
                <div className='flex size-14 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground'>
                  <SkipForward className='size-4' />
                </div>
              )}
              <p className='pt-1 text-sm'>
                {item.text ??
                  (item.status === 'skipped' ? (
                    <span className='text-muted-foreground'>Skipped</span>
                  ) : (
                    <span className='text-muted-foreground'>Not captured</span>
                  ))}
              </p>
            </li>
          ))}
        </ul>
        <div className='space-y-2'>
          <Label htmlFor='capture-note'>Report note</Label>
          <Textarea
            id='capture-note'
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setError(undefined)
            }}
            placeholder='Standing water across the access road, rising fast after overnight rain.'
            rows={4}
          />
          <p
            className={cn(
              'text-xs',
              error ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {error ??
              'Written from what each photo showed. Fix anything that is wrong before sending.'}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button size='lg' onClick={send} disabled={submit.isPending}>
            {submit.isPending ? <Loader2 className='animate-spin' /> : <Send />}
            Send report
          </Button>
          {onBack ? (
            <Button size='lg' variant='ghost' onClick={onBack}>
              Back to camera
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function SafetyStop({ session }: { session: CaptureSession }) {
  const submit = useSubmitCapture(session)
  const danger = session.danger!
  const sentNote = useMemo(
    () => session.draft || `Safety stop: ${danger.summary}.`,
    [session.draft, danger.summary]
  )

  return (
    <Card className='border-destructive bg-destructive/5'>
      <CardContent className='space-y-4' role='alert'>
        <TriangleAlert className='size-10 text-destructive' />
        <p className='text-2xl leading-tight font-semibold text-destructive'>
          {danger.instruction}
        </p>
        <p className='text-sm text-muted-foreground'>
          The photo shows {danger.summary}. You don&apos;t need more photos.
        </p>
        {session.reportId ? (
          <p className='text-sm'>
            Your report was sent with what you captured so far.
          </p>
        ) : (
          <Button
            size='lg'
            variant='destructive'
            onClick={() => submit.mutate(sentNote)}
            disabled={submit.isPending}
          >
            {submit.isPending ? <Loader2 className='animate-spin' /> : <Send />}
            Send report now
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function Notice({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Camera
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className='space-y-3 py-6 text-center'>
        <Icon className='mx-auto size-8 text-muted-foreground' />
        <p className='font-medium'>{title}</p>
        <p className='text-sm text-muted-foreground'>{body}</p>
        {action ? <div className='pt-2'>{action}</div> : null}
      </CardContent>
    </Card>
  )
}
