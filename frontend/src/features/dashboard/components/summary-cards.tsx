import { Gauge, MapPin, Siren, Zap } from 'lucide-react'
import { type Recommendation } from '@/api/types'
import { RECOMMENDATION_BG, recommendationFromScore } from '@/lib/planit'
import { StatCard } from '@/components/planit/stat-card'

export interface Summary {
  sites: number
  calls: Record<Recommendation, number>
  activeAlerts: number
  critical: number
  warning: number
  advisory: number
  lightningSites: number
  scoredSites: number
  /** Mean over scored sites only; null when no site has a hazard index. */
  avgScore: number | null
}

export function SummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
      <StatCard
        label='Sites monitored'
        value={summary.sites}
        icon={MapPin}
        to='/sites'
        segments={[
          {
            value: summary.calls['NO-GO'],
            label: 'NO-GO',
            color: RECOMMENDATION_BG['NO-GO'],
          },
          {
            value: summary.calls.CAUTION,
            label: 'CAUTION',
            color: RECOMMENDATION_BG.CAUTION,
          },
          { value: summary.calls.GO, label: 'GO', color: RECOMMENDATION_BG.GO },
        ]}
      />
      <StatCard
        label='Lightning stop-work'
        value={summary.lightningSites}
        icon={Zap}
        to='/alerts'
        max={summary.sites}
        segments={[
          {
            value: summary.lightningSites,
            label: `of ${summary.sites} sites stopped`,
            color: 'bg-red-600',
          },
        ]}
      />
      <StatCard
        label='Active alerts'
        value={summary.activeAlerts}
        icon={Siren}
        to='/alerts'
        segments={[
          { value: summary.critical, label: 'critical', color: 'bg-red-600' },
          { value: summary.warning, label: 'warning', color: 'bg-amber-500' },
          { value: summary.advisory, label: 'advisory', color: 'bg-sky-500' },
        ]}
      />
      <StatCard
        label='Avg. hazard index'
        value={summary.avgScore === null ? '—' : summary.avgScore.toFixed(1)}
        icon={Gauge}
        to='/sites'
        max={10}
        segments={[
          {
            value: summary.avgScore ?? 0,
            label: `of 10 · ${summary.scoredSites} of ${summary.sites} sites scored`,
            color:
              summary.avgScore === null
                ? 'bg-muted'
                : RECOMMENDATION_BG[recommendationFromScore(summary.avgScore)],
          },
        ]}
      />
    </div>
  )
}
