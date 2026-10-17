import { format, formatDistanceToNowStrict } from 'date-fns'
import {
  CloudLightning,
  Flame,
  Layers,
  PawPrint,
  Thermometer,
  Waves,
  Wind,
  Zap,
} from 'lucide-react'
import {
  type AlertSeverity,
  type AlertType,
  type HazardDomain,
  type HazardReportType,
  type Recommendation,
  type SeverityLevel,
  type Trend,
} from '@/api/types'

export const DOMAIN_ICON: Record<HazardDomain, typeof Zap> = {
  heat: Thermometer,
  lightning: Zap,
  flood: Waves,
  storm: Wind,
  wildfire: Flame,
  soil: Layers,
  wildlife: PawPrint,
}

export const ALERT_TYPE_ICON: Record<AlertType, typeof Zap> = {
  lightning: CloudLightning,
  flood: Waves,
  heat: Thermometer,
  wildfire: Flame,
  storm: Wind,
  wildlife: PawPrint,
}

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  lightning: 'Lightning',
  flood: 'Flood',
  heat: 'Heat',
  wildfire: 'Wildfire',
  storm: 'Wind',
  wildlife: 'Wildlife',
}

export const REPORT_TYPE_ICON: Record<HazardReportType, typeof Zap> = {
  ...ALERT_TYPE_ICON,
  soil: Layers,
}

export const REPORT_TYPE_LABEL: Record<HazardReportType, string> = {
  ...ALERT_TYPE_LABEL,
  soil: 'Ground / soil',
}

export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  extreme: 'Extreme',
}

export const SEVERITY_BADGE: Record<SeverityLevel, string> = {
  low: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  moderate:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  extreme: 'border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300',
}

export const SEVERITY_DOT: Record<SeverityLevel, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-orange-500',
  extreme: 'bg-red-600',
}

export const SEVERITY_TEXT: Record<SeverityLevel, string> = {
  low: 'text-emerald-600 dark:text-emerald-400',
  moderate: 'text-amber-600 dark:text-amber-400',
  high: 'text-orange-600 dark:text-orange-400',
  extreme: 'text-red-600 dark:text-red-400',
}

export const RECOMMENDATION_BADGE: Record<Recommendation, string> = {
  GO: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  CAUTION:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'NO-GO': 'border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300',
}

export const RECOMMENDATION_TEXT: Record<Recommendation, string> = {
  GO: 'text-emerald-600 dark:text-emerald-400',
  CAUTION: 'text-amber-600 dark:text-amber-400',
  'NO-GO': 'text-red-600 dark:text-red-400',
}

export const SEVERITY_ALERT_BADGE: Record<AlertSeverity, string> = {
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  warning:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  critical: 'border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300',
}

export const ALERT_TYPE_BADGE: Record<AlertType, string> = {
  lightning:
    'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  flood: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  heat: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  wildfire: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  storm: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  wildlife:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}

export function severityFromScore(score: number): SeverityLevel {
  if (score >= 7) return 'extreme'
  if (score >= 5) return 'high'
  if (score >= 3) return 'moderate'
  return 'low'
}

export function severityFromAlert(severity: AlertSeverity): SeverityLevel {
  if (severity === 'critical') return 'extreme'
  if (severity === 'warning') return 'high'
  return 'low'
}

export function recommendationFromScore(score: number): Recommendation {
  if (score >= 6.5) return 'NO-GO'
  if (score >= 3.5) return 'CAUTION'
  return 'GO'
}

export const RECOMMENDATION_DESCRIPTION: Record<Recommendation, string> = {
  GO: 'Conditions normal — proceed with the standard work plan.',
  CAUTION: 'Hazard exposure elevated — brief crews and adjust the work plan.',
  'NO-GO': 'Hard stand-down — do not mobilize until the hazard clears.',
}

export function trendLabel(trend: Trend): string {
  return trend === 'rising'
    ? 'Rising'
    : trend === 'falling'
      ? 'Falling'
      : 'Steady'
}

export function formatClock(iso: string | number | Date): string {
  return format(new Date(iso), 'HH:mm')
}

export function formatDateTime(iso: string | number | Date): string {
  return format(new Date(iso), 'MMM d, HH:mm')
}

export function formatDay(iso: string | number | Date): string {
  return format(new Date(iso), 'EEE, MMM d')
}

export function relativeTime(iso: string): string {
  return `${formatDistanceToNowStrict(new Date(iso))} ago`
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatCountdownTo(
  target: string | number | Date,
  now: number
): string {
  const diff = Math.max(
    0,
    Math.floor((new Date(target).getTime() - now) / 1000)
  )
  const hours = Math.floor(diff / 3600)
  const minutes = Math.floor((diff % 3600) / 60)
  const seconds = diff % 60
  return [hours, minutes, seconds]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

export function siteLabel(name: string, state: string): string {
  return `${name} (${state})`
}
