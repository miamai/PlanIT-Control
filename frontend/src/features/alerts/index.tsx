import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  BellRing,
  Flame,
  Gauge,
  Layers,
  Send,
  Thermometer,
  Waves,
  Zap,
} from 'lucide-react'
import { DELIVERY_CHANNELS } from '@/lib/notification-channels'
import {
  ALERT_TYPE_LABEL,
  ALL_CLEAR_MINUTES,
  LIGHTNING_RADIUS_MI,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useActiveAlerts } from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { AlertsFeed } from '@/components/planit/alerts-feed'
import { LightningCountdown } from '@/components/planit/lightning-countdown'
import { PageHeading } from '@/components/planit/page-heading'
import { PanelHeader } from '@/components/planit/panel-header'
import { PlanitHeader } from '@/components/planit/planit-header'

const ALL = '__all__'
const PAGE_SIZE = 12
// Lightning stop-work alerts get their own countdown cards above the list.
const TYPES = [
  'heat',
  'flood',
  'wildfire',
  'storm',
  'wildlife',
  'soil',
] as const

/** The core API's default alert rules (non-lightning values are its demo profile). */
const THRESHOLDS = [
  {
    icon: Zap,
    name: 'Lightning',
    rule: `Strike ≤ ${LIGHTNING_RADIUS_MI} mi · ${ALL_CLEAR_MINUTES} min to all-clear eligibility`,
  },
  { icon: Waves, name: 'Flood', rule: 'Official NWS warnings' },
  {
    icon: Thermometer,
    name: 'Heat',
    rule: 'HI ≥ 103°F high · ≥ 125°F critical (demo)',
  },
  { icon: Flame, name: 'Wildfire', rule: 'Satellite detection ≤ 25 mi' },
  {
    icon: Layers,
    name: 'Soil',
    rule: '72 h rain ≥ 2 in moderate · ≥ 4 in high (demo)',
  },
] as const

export function Alerts() {
  const { alerts: active, isLoading } = useActiveAlerts()
  const [type, setType] = useState<string>(ALL)
  const [showAll, setShowAll] = useState(false)

  const stopWork = active.filter((a) => a.type === 'lightning' && a.allClearAt)
  const alerts = useMemo(
    () => active.filter((a) => !(a.type === 'lightning' && a.allClearAt)),
    [active]
  )

  const filtered = useMemo(
    () =>
      type === ALL ? alerts : alerts.filter((alert) => alert.type === type),
    [alerts, type]
  )

  const counts = useMemo(() => {
    const map: Record<string, number> = { [ALL]: alerts.length }
    for (const alert of alerts) map[alert.type] = (map[alert.type] ?? 0) + 1
    return map
  }, [alerts])

  const critical = alerts.filter((a) => a.severity === 'critical').length
  const warning = alerts.filter((a) => a.severity === 'warning').length
  const advisory = alerts.filter((a) => a.severity === 'info').length
  const visible = showAll ? filtered : filtered.slice(0, PAGE_SIZE)

  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading title='Alerts' />

        {stopWork.length > 0 ? (
          <section className='mb-4'>
            <h2 className='mb-3 flex items-center gap-2 text-sm font-semibold'>
              {stopWork.some((alert) => alert.status === 'active') ? (
                <>
                  <span className='relative flex size-2'>
                    <span className='absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75' />
                    <span className='relative inline-flex size-2 rounded-full bg-red-600' />
                  </span>
                  Stop-work in effect
                </>
              ) : (
                <>
                  <span className='inline-flex size-2 rounded-full bg-amber-500' />
                  Lightning all-clear awaiting admin sign-off
                </>
              )}
            </h2>
            <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
              {stopWork.map((alert) => (
                <Card key={alert.id} className='border-red-600/30 py-4'>
                  <CardContent className='px-4'>
                    {alert.allClearAt ? (
                      <LightningCountdown
                        allClearAt={alert.allClearAt}
                        strikeCount={alert.strikeCount}
                        distanceMi={alert.distanceMi}
                        heading={
                          <Link
                            to='/sites/$siteId'
                            params={{ siteId: alert.site.id }}
                            className='hover:underline'
                          >
                            {alert.site.name}
                            <span className='font-normal text-muted-foreground'>
                              {' '}
                              · {alert.site.state}
                            </span>
                          </Link>
                        }
                      />
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ) : null}

        <div className='grid gap-4 lg:grid-cols-3'>
          <Card className='min-w-0 gap-4 py-4 shadow-none lg:col-span-2'>
            <PanelHeader
              icon={BellRing}
              title='Active alerts'
              className='flex-wrap gap-y-2 px-4'
              aside={
                <span className='tabular-nums'>
                  <span className='font-medium text-foreground'>
                    {critical} critical
                  </span>{' '}
                  · {warning} warning · {advisory} advisory
                </span>
              }
            />
            <CardContent className='space-y-4 px-4'>
              <Tabs
                value={type}
                onValueChange={(value) => {
                  setType(value)
                  setShowAll(false)
                }}
              >
                <div className='-mx-1 overflow-x-auto px-1 pb-1'>
                  <TabsList>
                    <TabsTrigger value={ALL}>
                      All
                      <span className='ms-1 text-muted-foreground tabular-nums'>
                        {counts[ALL]}
                      </span>
                    </TabsTrigger>
                    {TYPES.map((alertType) => (
                      <TabsTrigger
                        key={alertType}
                        value={alertType}
                        disabled={!counts[alertType]}
                      >
                        {ALERT_TYPE_LABEL[alertType]}
                        <span className='ms-1 text-muted-foreground tabular-nums'>
                          {counts[alertType] ?? 0}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              </Tabs>

              {isLoading ? (
                <div className='space-y-3'>
                  <Skeleton className='h-20 w-full' />
                  <Skeleton className='h-20 w-full' />
                </div>
              ) : (
                <AlertsFeed alerts={visible} />
              )}

              {filtered.length > PAGE_SIZE ? (
                <Button
                  variant='outline'
                  size='sm'
                  className='w-full'
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll ? 'Show fewer' : `Show all ${filtered.length}`}
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <div className='space-y-4'>
            <Card className='gap-4'>
              <PanelHeader icon={Gauge} title='Thresholds' />
              <CardContent>
                <ul className='divide-y'>
                  {THRESHOLDS.map((item) => (
                    <li
                      key={item.name}
                      className='flex items-center gap-3 py-2.5 first:pt-0 last:pb-0'
                    >
                      <item.icon className='size-4 shrink-0 text-muted-foreground' />
                      <span className='w-16 shrink-0 text-sm font-medium'>
                        {item.name}
                      </span>
                      <span className='text-xs text-muted-foreground'>
                        {item.rule}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className='gap-4'>
              <PanelHeader icon={Send} title='Channels' />
              <CardContent>
                <ul className='divide-y'>
                  {DELIVERY_CHANNELS.map((channel) => (
                    <li
                      key={channel.label}
                      className='flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0'
                    >
                      <span className='font-medium'>{channel.label}</span>
                      <span className='flex items-center gap-2 text-xs text-muted-foreground'>
                        {channel.available ? 'Available' : 'Not connected'}
                        <span
                          aria-hidden
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            channel.available
                              ? 'bg-emerald-500'
                              : 'bg-muted-foreground/35'
                          )}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
