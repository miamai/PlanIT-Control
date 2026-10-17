import { useMemo } from 'react'
import { parseISO, format } from 'date-fns'
import {
  Bar,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { type TimelinePoint } from '@/api/types'

export function ConditionsChart({ points }: { points: TimelinePoint[] }) {
  const data = useMemo(
    () =>
      points.map((point) => ({
        time: format(parseISO(point.t), 'HH:mm'),
        heatIndex: point.heatIndex,
        windMph: point.windMph,
        precipIn: point.precipIn,
        hazardIndex: point.hazardIndex,
      })),
    [points]
  )

  return (
    <ResponsiveContainer width='100%' height={260}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
      >
        <XAxis
          dataKey='time'
          stroke='#888888'
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId='heat'
          orientation='left'
          stroke='#888888'
          fontSize={11}
          tickLine={false}
          axisLine={false}
          label={{ value: '°F', position: 'insideTopLeft', fontSize: 10 }}
        />
        <YAxis
          yAxisId='wind'
          orientation='right'
          stroke='#888888'
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div className='space-y-1 rounded-md border bg-background px-3 py-2 text-xs shadow-sm'>
                <p className='font-medium'>{label}</p>
                {payload.map((entry) => (
                  <p
                    key={String(entry.dataKey)}
                    className='text-muted-foreground'
                  >
                    {entry.name}: {entry.value}
                  </p>
                ))}
              </div>
            )
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          yAxisId='wind'
          dataKey='precipIn'
          name='Precip (in)'
          fill='currentColor'
          className='text-sky-500'
          fillOpacity={0.35}
          barSize={8}
        />
        <Line
          yAxisId='heat'
          type='monotone'
          dataKey='heatIndex'
          name='Heat index °F'
          stroke='#f97316'
          strokeWidth={2}
          dot={false}
        />
        <Line
          yAxisId='wind'
          type='monotone'
          dataKey='windMph'
          name='Wind mph'
          stroke='#14b8a6'
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
