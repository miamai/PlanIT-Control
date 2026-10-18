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
  soil: Layers,
}

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  lightning: 'Lightning',
  flood: 'Flood',
  heat: 'Heat',
  wildfire: 'Wildfire',
  storm: 'Weather',
  wildlife: 'Wildlife',
  soil: 'Ground / soil',
}

export const REPORT_TYPE_ICON: Record<HazardReportType, typeof Zap> = {
  ...ALERT_TYPE_ICON,
}

export const REPORT_TYPE_LABEL: Record<HazardReportType, string> = {
  ...ALERT_TYPE_LABEL,
}

/** Lightning stop-work rule enforced by the core API (LIGHTNING_RADIUS_MILES). */
export const LIGHTNING_RADIUS_MI = 10
/** Minutes after the latest qualifying strike before all-clear eligibility. */
export const ALL_CLEAR_MINUTES = 30

export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  extreme: 'Extreme',
  unknown: 'Unknown',
}

export const SEVERITY_DOT: Record<SeverityLevel, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-orange-500',
  extreme: 'bg-red-600',
  unknown: 'bg-slate-400',
}

export const SEVERITY_TEXT: Record<SeverityLevel, string> = {
  low: 'text-emerald-700 dark:text-emerald-300',
  moderate: 'text-amber-700 dark:text-amber-300',
  high: 'text-orange-700 dark:text-orange-300',
  extreme: 'text-red-700 dark:text-red-300',
  unknown: 'text-muted-foreground',
}

/** Decision text reinforces the score without adding another colored container. */
export const RECOMMENDATION_TEXT: Record<Recommendation, string> = {
  GO: 'text-emerald-700 dark:text-emerald-300',
  CAUTION: 'text-amber-700 dark:text-amber-300',
  'NO-GO': 'text-red-700 dark:text-red-300',
  'REVIEW REQUIRED': 'text-slate-700 dark:text-slate-300',
}

/** Hex colors for SVG, charts and map markers (same scale as the risk indicators). */
export const RECOMMENDATION_HEX: Record<Recommendation, string> = {
  GO: '#10b981',
  CAUTION: '#f59e0b',
  'NO-GO': '#dc2626',
  'REVIEW REQUIRED': '#64748b',
}

export const RECOMMENDATION_BG: Record<Recommendation, string> = {
  GO: 'bg-emerald-500',
  CAUTION: 'bg-amber-500',
  'NO-GO': 'bg-red-600',
  'REVIEW REQUIRED': 'bg-slate-500',
}

/** Score cut-offs shared with the ML service (index rounded: 0-3 GO, 4-6 CAUTION, 7-10 NO-GO). */
export const GO_BELOW = 3.5
export const CAUTION_BELOW = 6.5

export const RISK_BANDS: {
  recommendation: Recommendation
  from: number
  to: number
}[] = [
  { recommendation: 'GO', from: 0, to: GO_BELOW },
  { recommendation: 'CAUTION', from: GO_BELOW, to: CAUTION_BELOW },
  { recommendation: 'NO-GO', from: CAUTION_BELOW, to: 10 },
]

export function recommendationFromScore(score: number): Recommendation {
  if (score >= CAUTION_BELOW) return 'NO-GO'
  if (score >= GO_BELOW) return 'CAUTION'
  return 'GO'
}

export const ALERT_SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info: 'Advisory',
  warning: 'Warning',
  critical: 'Critical',
}

/** A single tinted label carries alert severity; hazard type icons stay neutral. */
export const ALERT_SEVERITY_STYLE: Record<AlertSeverity, string> = {
  info: 'bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  warning:
    'bg-amber-500/10 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
  critical: 'bg-red-600/10 text-red-700 dark:bg-red-400/15 dark:text-red-300',
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

export function siteLabel(name: string, state: string): string {
  return `${name} (${state})`
}
