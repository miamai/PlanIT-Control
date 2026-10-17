import { useMemo } from 'react'
import { parseISO, format } from 'date-fns'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { type TimelinePoint } from '@/api/types'

type Metric = 'heatIndex' | 'windMph' | 'precipIn'

const METRICS: {
  key: Metric
  label: string
  unit: string
  color: string
  threshold?: { value: number; label: string }
}[] = [
  {
    key: 'heatIndex',
    label: 'Heat index',
    unit: '°F',
    color: '#f97316',
    // Core API default (demo profile) for a HIGH heat alert.
    threshold: { value: 103, label: 'Alert 103°F' },
  },
  { key: 'windMph', label: 'Wind', unit: 'mph', color: '#14b8a6' },
  { key: 'precipIn', label: 'Rainfall', unit: 'in', color: '#0ea5e9' },
]

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean
  payload?: readonly { value?: unknown }[]
  label?: unknown
  unit: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className='rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-sm'>
      <span className='text-muted-foreground'>{String(label)} · </span>
      <span className='font-medium tabular-nums'>
        {String(payload[0].value)} {unit}
      </span>
    </div>
  )
}

/** Last 24 h as three small charts, each on its own scale and unit. */
export function ConditionsChart({ points }: { points: TimelinePoint[] }) {
  const data = useMemo(
    () =>
      points.map((point) => ({
        time: format(parseISO(point.t), 'HH:mm'),
        heatIndex: point.heatIndex ?? null,
        windMph: point.windMph ?? null,
        precipIn: point.precipIn ?? null,
      })),
    [points]
  )

  return (
    <div className='grid gap-6 md:grid-cols-3 md:gap-4'>
      {METRICS.map((metric) => {
        const values = data.flatMap((d) =>
          d[metric.key] === null ? [] : [d[metric.key] as number]
        )
        const latest = values[values.length - 1]
        const total =
          metric.key === 'precipIn' && values.length > 0
            ? values.reduce((sum, value) => sum + value, 0)
            : undefined
        return (
          <div key={metric.key} className='min-w-0'>
            <div className='mb-2 flex items-baseline justify-between gap-2'>
              <p className='flex items-center gap-1.5 text-xs font-medium'>
                <span
                  className='size-2 rounded-full'
                  style={{ background: metric.color }}
                />
                {metric.label}
              </p>
              <p className='text-xs text-muted-foreground'>
                {total !== undefined ? (
                  <>
                    <span className='font-semibold text-foreground tabular-nums'>
                      {total.toFixed(2)}
                    </span>{' '}
                    in / 24 h
                  </>
                ) : latest !== undefined ? (
                  <>
                    latest{' '}
                    <span className='font-semibold text-foreground tabular-nums'>
                      {latest}
                    </span>{' '}
                    {metric.unit}
                  </>
                ) : (
                  'no data'
                )}
              </p>
            </div>
            <ResponsiveContainer width='100%' height={130}>
              {metric.key === 'precipIn' ? (
                <BarChart
                  data={data}
                  margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                >
                  <XAxis
                    dataKey='time'
                    stroke='#888888'
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    interval='preserveStartEnd'
                    minTickGap={24}
                  />
                  <YAxis
                    stroke='#888888'
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals
                    width={32}
                  />
                  <Tooltip
                    cursor={{ fill: 'currentColor', fillOpacity: 0.06 }}
                    content={(props) => (
                      <ChartTooltip {...props} unit={metric.unit} />
                    )}
                  />
                  <Bar
                    dataKey={metric.key}
                    fill={metric.color}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              ) : (
                <AreaChart
                  data={data}
                  margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                >
                  <XAxis
                    dataKey='time'
                    stroke='#888888'
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    interval='preserveStartEnd'
                    minTickGap={24}
                  />
                  <YAxis
                    stroke='#888888'
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    domain={['auto', 'auto']}
                    width={32}
                  />
                  <Tooltip
                    cursor={{ stroke: '#888888', strokeDasharray: '3 3' }}
                    content={(props) => (
                      <ChartTooltip {...props} unit={metric.unit} />
                    )}
                  />
                  {metric.threshold ? (
                    <ReferenceLine
                      y={metric.threshold.value}
                      stroke='#dc2626'
                      strokeDasharray='4 4'
                      ifOverflow='extendDomain'
                      label={{
                        value: metric.threshold.label,
                        position: 'insideTopRight',
                        fontSize: 10,
                        fill: '#dc2626',
                      }}
                    />
                  ) : null}
                  <Area
                    type='monotone'
                    dataKey={metric.key}
                    stroke={metric.color}
                    fill={metric.color}
                    fillOpacity={0.12}
                    strokeWidth={2}
                    dot={values.length < 3}
                    connectNulls
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        )
      })}
    </div>
  )
}
