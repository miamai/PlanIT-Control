import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  BellRing,
  Flame,
  Gauge,
  RadioTower,
  Send,
  Thermometer,
  Waves,
  Zap,
} from 'lucide-react'
import { ALERT_TYPE_LABEL } from '@/lib/planit'
import { useActiveAlerts, useSimulateStrike } from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
const TYPES = ['heat', 'flood', 'wildfire', 'storm', 'wildlife'] as const

const THRESHOLDS = [
  { icon: Zap, name: 'Lightning', rule: 'Strike ≤ 10 mi · 30 min all-clear' },
  { icon: Waves, name: 'Flood', rule: 'Gauge ≥ 95% of flood stage' },
  {
    icon: Thermometer,
    name: 'Heat',
    rule: 'HI ≥ 100°F warning · ≥ 110°F critical',
  },
  { icon: Flame, name: 'Smoke', rule: 'Red flag or AQI ≥ 150' },
] as const

const CHANNELS = [
  { label: 'Push', scope: 'All alerts' },
  { label: 'SMS', scope: 'Critical + lightning' },
  { label: 'Email', scope: '18:00 briefing' },
]

export function Alerts() {
  const active = useActiveAlerts()
  const simulateStrike = useSimulateStrike()
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
        <PageHeading
          title='Alerts'
          actions={
            <Button
              size='sm'
              variant='outline'
              onClick={() => simulateStrike()}
            >
              <RadioTower /> Simulate strike
            </Button>
          }
        />

        {stopWork.length > 0 ? (
          <section className='mb-4'>
            <h2 className='mb-3 flex items-center gap-2 text-sm font-semibold'>
              <span className='relative flex size-2'>
                <span className='absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75' />
                <span className='relative inline-flex size-2 rounded-full bg-red-600' />
              </span>
              Stop-work in effect
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

              <AlertsFeed alerts={visible} />

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
                  {CHANNELS.map((channel) => (
                    <li
                      key={channel.label}
                      className='flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0'
                    >
                      <span className='font-medium'>{channel.label}</span>
                      <span className='flex items-center gap-2 text-xs text-muted-foreground'>
                        {channel.scope}
                        <span className='size-2 rounded-full bg-emerald-500' />
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
