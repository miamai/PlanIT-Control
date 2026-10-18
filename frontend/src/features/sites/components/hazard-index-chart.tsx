import { useMemo } from 'react'
import { parse } from 'date-fns'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { type HazardIndexPoint } from '@/api/types'
import {
  CAUTION_BELOW,
  GO_BELOW,
  RECOMMENDATION_HEX,
  RISK_BANDS,
  recommendationFromScore,
} from '@/lib/planit'
import { RecommendationStatus } from '@/components/planit/risk-status'

/** 14-day hazard index over the GO / CAUTION / NO-GO bands. */
export function HazardIndexChart({ points }: { points: HazardIndexPoint[] }) {
  const data = useMemo(
    () =>
      points.map((point) => ({
        label: parse(point.date, 'yyyy-MM-dd', new Date()).toLocaleDateString(
          'en-US',
          { month: 'short', day: 'numeric' }
        ),
        score: point.score,
      })),
    [points]
  )

  return (
    <ResponsiveContainer width='100%' height={240}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 56, left: -12, bottom: 0 }}
      >
        {RISK_BANDS.map((band) => (
          <ReferenceArea
            key={band.recommendation}
            y1={band.from}
            y2={band.to}
            fill={RECOMMENDATION_HEX[band.recommendation]}
            fillOpacity={0.07}
            strokeOpacity={0}
            ifOverflow='extendDomain'
            label={{
              value: band.recommendation,
              position: 'right',
              fontSize: 10,
              fill: RECOMMENDATION_HEX[band.recommendation],
            }}
          />
        ))}
        <CartesianGrid
          vertical={false}
          strokeDasharray='3 3'
          className='stroke-border'
        />
        <XAxis
          dataKey='label'
          stroke='#888888'
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval='preserveStartEnd'
          minTickGap={16}
        />
        <YAxis
          domain={[0, 10]}
          ticks={[0, GO_BELOW, CAUTION_BELOW, 10]}
          stroke='#888888'
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ stroke: '#888888', strokeDasharray: '3 3' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const score = Number(payload[0].value)
            return (
              <div className='space-y-1 rounded-md border bg-background px-3 py-2 text-xs shadow-sm'>
                <p className='font-medium'>{label}</p>
                <div className='flex items-center gap-2'>
                  <span className='tabular-nums'>
                    Hazard index {score.toFixed(1)}
                  </span>
                  <RecommendationStatus
                    recommendation={recommendationFromScore(score)}
                    className='text-xs'
                  />
                </div>
              </div>
            )
          }}
        />
        <Area
          type='monotone'
          dataKey='score'
          stroke='currentColor'
          className='text-foreground'
          fill='currentColor'
          fillOpacity={0.06}
          strokeWidth={2}
          dot={(props) => {
            const { cx, cy, payload, index } = props as {
              cx: number
              cy: number
              index: number
              payload: { score: number }
            }
            const color =
              RECOMMENDATION_HEX[recommendationFromScore(payload.score)]
            return (
              <circle
                key={index}
                cx={cx}
                cy={cy}
                r={3.5}
                fill={color}
                className='stroke-background'
                strokeWidth={1.5}
              />
            )
          }}
          activeDot={{ r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
