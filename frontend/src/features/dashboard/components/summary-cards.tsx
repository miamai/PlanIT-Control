import { Gauge, MapPin, Siren, Zap } from 'lucide-react'
import { type Recommendation } from '@/api/types'
import {
  formatDuration,
  RECOMMENDATION_TEXT,
  recommendationFromScore,
} from '@/lib/planit'
import { cn } from '@/lib/utils'
import { useCountdown } from '@/hooks/use-planit'
import { RiskDistributionBar, ScoreBar } from '@/components/planit/score-bar'
import { StatCard } from '@/components/planit/stat-card'

export interface Summary {
  sites: number
  calls: Record<Recommendation, number>
  activeAlerts: number
  critical: number
  warning: number
  advisory: number
  lightningSites: number
  /** Soonest lightning all-clear across the fleet, if any stop-work is active. */
  nextAllClearAt?: string
  avgScore: number
}

export function SummaryCards({ summary }: { summary: Summary }) {
  const nextAllClear = useCountdown(summary.nextAllClearAt)
  const fleetCall = recommendationFromScore(summary.avgScore)

  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
      <StatCard label='Sites monitored' value={summary.sites} icon={MapPin}>
        <RiskDistributionBar counts={summary.calls} />
      </StatCard>
      <StatCard
        label='Lightning stop-work'
        value={
          <>
            {summary.lightningSites}
            <span className='ms-1 text-sm font-normal text-muted-foreground'>
              site{summary.lightningSites === 1 ? '' : 's'}
            </span>
          </>
        }
        icon={Zap}
        tone={summary.lightningSites > 0 ? 'danger' : 'success'}
        hint={
          summary.lightningSites > 0 && nextAllClear > 0
            ? `Next all-clear in ${formatDuration(nextAllClear)}`
            : undefined
        }
      />
      <StatCard
        label='Active alerts'
        value={summary.activeAlerts}
        icon={Siren}
        tone={summary.critical > 0 ? 'danger' : 'default'}
        hint={
          <>
            <span className='font-medium'>{summary.critical} critical</span>
            <span className='text-muted-foreground'>
              {' '}
              · {summary.warning} warning · {summary.advisory} advisory
            </span>
          </>
        }
      />
      <StatCard
        label='Avg. hazard index'
        value={
          <span className={cn(RECOMMENDATION_TEXT[fleetCall])}>
            {summary.avgScore.toFixed(1)}
            <span className='ms-0.5 text-sm font-normal text-muted-foreground'>
              / 10
            </span>
          </span>
        }
        icon={Gauge}
      >
        <ScoreBar score={summary.avgScore} showValue={false} />
      </StatCard>
    </div>
  )
}
