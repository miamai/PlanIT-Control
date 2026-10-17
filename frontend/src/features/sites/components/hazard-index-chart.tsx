import { useMemo } from 'react'
import { parse } from 'date-fns'
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { type HazardIndexPoint } from '@/api/types'
import { severityFromScore } from '@/lib/planit'

export function HazardIndexChart({ points }: { points: HazardIndexPoint[] }) {
  const data = useMemo(
    () =>
      points.map((point) => ({
        label: parse(point.date, 'yyyy-MM-dd', new Date()).toLocaleDateString(
          'en-US',
          { month: 'short', day: 'numeric' }
        ),
        score: point.score,
        severity: severityFromScore(point.score),
      })),
    [points]
  )

  return (
    <ResponsiveContainer width='100%' height={240}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
      >
        <defs>
          <linearGradient id='hazardFill' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='currentColor' stopOpacity={0.35} />
            <stop offset='100%' stopColor='currentColor' stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey='label'
          stroke='#888888'
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval='preserveStartEnd'
        />
        <YAxis
          domain={[0, 10]}
          stroke='#888888'
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div className='rounded-md border bg-background px-3 py-2 text-xs shadow-sm'>
                <p className='font-medium'>{label}</p>
                <p className='text-muted-foreground'>
                  Hazard index {Number(payload[0].value).toFixed(1)}/10
                </p>
              </div>
            )
          }}
        />
        <ReferenceLine
          y={6.5}
          stroke='#dc2626'
          strokeDasharray='4 4'
          label={{
            value: 'NO-GO 6.5',
            position: 'insideTopRight',
            fontSize: 10,
          }}
        />
        <Area
          type='monotone'
          dataKey='score'
          stroke='currentColor'
          className='text-primary'
          fill='url(#hazardFill)'
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
