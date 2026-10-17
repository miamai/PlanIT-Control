import { useMemo, useState } from 'react'
import { RadioTower, Siren, Zap } from 'lucide-react'
import { ALERT_TYPE_LABEL } from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useActiveAlerts, useSimulateStrike } from '@/hooks/use-planit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { AlertsFeed } from '@/components/planit/alerts-feed'
import { PlanitHeader } from '@/components/planit/planit-header'
import { StatCard } from '@/components/planit/stat-card'

const ALL = '__all__'
const TYPES = [
  'lightning',
  'heat',
  'flood',
  'wildfire',
  'storm',
  'wildlife',
] as const

const RULES = [
  {
    icon: Zap,
    name: 'Lightning stop-work',
    detail:
      'Any strike within 10 miles → stop-work alert, 30-minute all-clear countdown that resets on every new strike.',
    tone: 'violet',
  },
  {
    icon: Siren,
    name: 'River flood watch',
    detail:
      'Overnight rainfall pushing a gauge above 95% of flood stage → flood-risk warning for riverside sites.',
    tone: 'blue',
  },
  {
    icon: Siren,
    name: 'Heat threshold',
    detail:
      'Heat index ≥ 100°F → heat advisory; ≥ 110°F → critical alert with mandatory rest-cycle action.',
    tone: 'orange',
  },
  {
    icon: Siren,
    name: 'Red flag & smoke',
    detail:
      'Red flag conditions or AQI ≥ 150 → hot-work ban and N95 mask requirement.',
    tone: 'red',
  },
] as const

export function Alerts() {
  const alerts = useActiveAlerts()
  const simulateStrike = useSimulateStrike()
  const [type, setType] = useState<string>(ALL)

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
  const lightning = alerts.filter((a) => a.type === 'lightning').length

  return (
    <>
      <PlanitHeader
        active='alerts'
        actions={
          <Button
            size='sm'
            className='hidden sm:inline-flex'
            onClick={() => simulateStrike()}
          >
            <RadioTower /> Simulate strike
          </Button>
        }
      />
      <Main>
        <div className='mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <div className='space-y-1'>
            <h1 className='text-2xl font-bold tracking-tight'>Alert center</h1>
            <p className='text-sm text-muted-foreground'>
              Instant warnings the moment conditions turn dangerous — push and
              SMS go out through the same engine.
            </p>
          </div>
          <Button
            size='sm'
            variant='outline'
            onClick={() => simulateStrike()}
            className='sm:hidden'
          >
            <RadioTower /> Simulate strike
          </Button>
        </div>

        <div className='mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          <StatCard
            label='Active alerts'
            value={alerts.length}
            icon={Siren}
            hint='Across all monitored sites'
          />
          <StatCard
            label='Critical'
            value={critical}
            icon={Siren}
            tone={critical > 0 ? 'danger' : 'default'}
            hint={critical > 0 ? 'Supervisor action required' : 'None open'}
          />
          <StatCard
            label='Lightning stop-work'
            value={lightning}
            icon={Zap}
            tone={lightning > 0 ? 'warning' : 'default'}
            hint='10 mi radius · 30 min reset'
          />
          <StatCard
            label='Delivery channels'
            value='Push · SMS'
            icon={RadioTower}
            hint='Twilio SMS hook in alert engine'
          />
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          <div className='space-y-4 lg:col-span-2'>
            <Tabs value={type} onValueChange={setType}>
              <div className='overflow-x-auto pb-2'>
                <TabsList>
                  <TabsTrigger value={ALL}>
                    All
                    <span className='ms-1 text-muted-foreground tabular-nums'>
                      {counts[ALL]}
                    </span>
                  </TabsTrigger>
                  {TYPES.map((alertType) => (
                    <TabsTrigger key={alertType} value={alertType}>
                      {ALERT_TYPE_LABEL[alertType]}
                      <span className='ms-1 text-muted-foreground tabular-nums'>
                        {counts[alertType] ?? 0}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>

            <AlertsFeed
              alerts={filtered}
              onSimulate={simulateStrike}
              emptyMessage='No active alerts of this type right now.'
            />
          </div>

          <div className='space-y-4'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>Detection rules</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                {RULES.map((rule) => (
                  <div key={rule.name} className='flex gap-3'>
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-md',
                        rule.tone === 'violet'
                          ? 'bg-violet-500/10 text-violet-600'
                          : rule.tone === 'blue'
                            ? 'bg-blue-500/10 text-blue-600'
                            : rule.tone === 'orange'
                              ? 'bg-orange-500/10 text-orange-600'
                              : 'bg-red-500/10 text-red-600'
                      )}
                    >
                      <rule.icon className='size-4' />
                    </span>
                    <div className='space-y-1'>
                      <p className='text-sm font-medium'>{rule.name}</p>
                      <p className='text-xs leading-relaxed text-muted-foreground'>
                        {rule.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='flex items-center justify-between text-base'>
                  Notification channels
                  <Badge variant='outline' className='text-[10px]'>
                    real-time
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-3 text-sm'>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground'>
                    Push (web / mobile)
                  </span>
                  <Badge className='border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'>
                    enabled
                  </Badge>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground'>SMS (Twilio)</span>
                  <Badge className='border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'>
                    enabled
                  </Badge>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground'>
                    6 PM briefing email
                  </span>
                  <Badge className='border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'>
                    enabled
                  </Badge>
                </div>
                <p className='pt-1 text-xs leading-relaxed text-muted-foreground'>
                  Crews that acknowledge an alert are skipped for the repeat
                  push 5 minutes later; supervisors always get both.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
