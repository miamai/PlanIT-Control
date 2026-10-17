import { AlertTriangle, Gauge, MapPin, ShieldAlert } from 'lucide-react'
import { StatCard } from '@/components/planit/stat-card'

export interface Summary {
  sites: number
  noGo: number
  caution: number
  go: number
  activeAlerts: number
  lightningAlerts: number
  crewReports24h: number
  avgScore: number
}

export function SummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
      <StatCard
        label='Sites monitored'
        value={summary.sites}
        icon={MapPin}
        hint={`${summary.go} GO · ${summary.caution} CAUTION · ${summary.noGo} NO-GO`}
        tone={summary.noGo > 0 ? 'warning' : 'success'}
      />
      <StatCard
        label='NO-GO right now'
        value={summary.noGo}
        icon={ShieldAlert}
        hint={
          summary.noGo > 0
            ? 'Stand-down crews before mobilizing'
            : 'No stand-downs'
        }
        tone={summary.noGo > 0 ? 'danger' : 'success'}
      />
      <StatCard
        label='Active alerts'
        value={summary.activeAlerts}
        icon={AlertTriangle}
        hint={`${summary.lightningAlerts} lightning stop-work`}
        tone={summary.lightningAlerts > 0 ? 'warning' : 'default'}
      />
      <StatCard
        label='Fleet hazard index'
        value={`${summary.avgScore.toFixed(1)}/10`}
        icon={Gauge}
        hint={`${summary.crewReports24h} crew report${summary.crewReports24h === 1 ? '' : 's'} in 24h`}
        tone='default'
      />
    </div>
  )
}
