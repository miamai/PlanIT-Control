import { describe, expect, it } from 'vitest'
import {
  type AlertDTO,
  type BriefingDTO,
  type ObservationDTO,
  type RiskDTO,
  type SiteDTO,
  type SiteObservationDTO,
  buildBriefingHistory,
  buildDomains,
  buildFleetBriefing,
  buildTimeline,
  hazardFromReportType,
  toAlert,
  toCaptureFeedback,
  toCaptureSession,
  toHazardReport,
  toSite,
  toSiteRisk,
  toStrikes,
  trendFromHistory,
} from './mappers'

const SITE_ID = '11111111-1111-1111-1111-111111111111'

const siteDto: SiteDTO = {
  id: SITE_ID,
  eia_plant_id: 6145,
  name: 'Comanche Peak',
  latitude: 32.3,
  longitude: -97.8,
  state: 'TX',
  county: null,
  plant_type: null,
  primary_energy_source: 'NUC',
  operator_name: null,
  timezone: 'America/Chicago',
  source_release: 'test',
  source_url: 'test',
  is_reference_location: true,
  created_at: '2026-10-17T00:00:00Z',
  updated_at: '2026-10-17T00:00:00Z',
  ml_supported: true,
  ml_site_id: 'EIA-6145',
  ml_model_version: 'v3',
}

function risk(overrides: Partial<RiskDTO> = {}): RiskDTO {
  return {
    id: 'risk-1',
    site_id: SITE_ID,
    score: 7.2,
    generated_at: '2026-10-17T23:00:00Z',
    prediction_date: '2026-10-18',
    valid_for_seconds: 86400,
    model_version: 'v3',
    score_source: 'ml_service',
    contributing_factors: {
      recommendation: 'caution',
      sub_scores: { heat: 6.1, convective: 3.4, wildlife: 1.2 },
      reasons: [
        {
          hazard: 'heat',
          factor: 'hi_max',
          impact: 3,
          text: 'Heat index peaks at 108°F',
        },
        {
          hazard: 'convective',
          factor: 'cape',
          impact: 1,
          text: 'Unstable air',
        },
        { hazard: 'heat', factor: 'zero', impact: 0, text: 'ignored' },
      ],
      work_plan: {
        work_windows: [
          { start: '06:00', end: '11:00', hours: 5, text: '06:00 to 11:00' },
        ],
        avoid: [{ start: '13:00', end: '17:00', why: 'heat' }],
      },
    },
    top_drivers: [
      {
        hazard: 'heat',
        severity: 'HIGH',
        impact: 3,
        explanation: 'Heat index peaks at 108°F',
        value: 108,
        explanation_method: 'tree_shap',
      },
      {
        hazard: 'convective',
        severity: 'MODERATE',
        impact: 1,
        explanation: 'Unstable air',
        explanation_method: 'tree_shap',
      },
    ],
    ...overrides,
  }
}

function observation(overrides: Partial<ObservationDTO>): ObservationDTO {
  return {
    id: 'obs-1',
    site_id: SITE_ID,
    hazard_type: 'heat',
    source: 'nws',
    source_event_id: 'evt-1',
    observed_at: '2026-10-17T15:10:00Z',
    valid_until: null,
    ingested_at: '2026-10-17T15:11:00Z',
    metric_name: 'calculated_heat_index',
    numeric_value: 101.4,
    unit: 'degF',
    latitude: null,
    longitude: null,
    quality_status: 'verified',
    is_estimated: false,
    severity: 'MODERATE',
    severity_basis: 'Configured heat-index bands (91/103/125°F)',
    metadata: {},
    ...overrides,
  }
}

function alert(overrides: Partial<AlertDTO> = {}): AlertDTO {
  return {
    id: 'alert-1',
    site_id: SITE_ID,
    hazard_type: 'lightning',
    severity: 'CRITICAL',
    status: 'ACTIVE',
    action_code: 'STOP_WORK',
    title: 'Lightning stop-work condition',
    message: 'Lightning detected 2.07 miles from Comanche Peak.',
    recommended_action: 'Stop exposed work.',
    triggered_at: '2026-10-17T15:00:00Z',
    updated_at: '2026-10-17T15:00:00Z',
    resolved_at: null,
    expires_at: '2026-10-17T15:30:00Z',
    source_reference: null,
    details: { distance_miles: 2.071 },
    ...overrides,
  }
}

describe('toSite', () => {
  it('maps backend fields and fills gaps without inventing numbers', () => {
    const site = toSite(siteDto)
    expect(site).toMatchObject({
      id: SITE_ID,
      eiaPlantId: '6145',
      lat: 32.3,
      lon: -97.8,
      plantType: 'NUC',
      utility: 'Unknown operator',
      county: 'Unknown',
      mlSupported: true,
    })
    expect(site.capacityMw).toBeUndefined()
  })
})

describe('toSiteRisk', () => {
  it('never turns a missing score into zero', () => {
    const result = toSiteRisk(SITE_ID, 'unsupported', null)
    expect(result.score).toBeNull()
    expect(result.recommendation).toBeNull()
    expect(result.status).toBe('unsupported')
  })

  it('uses the live decision, typed drivers, sub-scores and work plan', () => {
    const result = toSiteRisk(SITE_ID, 'available', risk())
    expect(result.score).toBe(7.2)
    expect(result.recommendation).toBe('NO-GO')
    expect(result.reasons.map((r) => [r.domain, r.contribution])).toEqual([
      ['heat', 0.75],
      ['storm', 0.25],
    ])
    expect(result.subScores).toEqual({ heat: 6.1, storm: 3.4, wildlife: 1.2 })
    expect(result.workPlan).toEqual([
      'Avoid 13:00 to 17:00 (heat)',
      'Work window 06:00 to 11:00',
    ])
  })

  it('falls back to the score band without a model recommendation', () => {
    const result = toSiteRisk(
      SITE_ID,
      'available',
      risk({
        score: 2.5,
        contributing_factors: { synthetic_notice: true },
        top_drivers: [],
      })
    )
    expect(result.recommendation).toBe('GO')
    expect(result.reasons).toEqual([])
  })
})

describe('toAlert', () => {
  it('maps lightning alerts with the all-clear time and distance', () => {
    expect(toAlert(alert())).toMatchObject({
      type: 'lightning',
      severity: 'critical',
      status: 'active',
      action: 'Stop exposed work.',
      allClearAt: '2026-10-17T15:30:00Z',
      distanceMi: 2.1,
    })
  })

  it('maps weather alerts and backend severities and statuses', () => {
    const mapped = toAlert(
      alert({
        hazard_type: 'weather',
        severity: 'MODERATE',
        status: 'ALL_CLEAR_ELIGIBLE',
      })
    )
    expect(mapped.type).toBe('storm')
    expect(mapped.severity).toBe('warning')
    expect(mapped.status).toBe('all-clear')
    expect(mapped.allClearAt).toBeUndefined()
  })
})

describe('observations', () => {
  it('builds one domain per hazard with evidence, worst severity first', () => {
    const domains = buildDomains(
      [
        observation({ hazard_type: 'heat' }),
        observation({
          id: 'obs-2',
          hazard_type: 'flood',
          metric_name: 'gage_height',
          numeric_value: 3.21,
          unit: 'ft',
          severity: 'UNKNOWN',
          severity_basis: 'No configured flood stage for this station',
        }),
      ],
      { heat: 6.1 },
      [toAlert(alert())]
    )
    expect(domains.map((d) => [d.domain, d.severity, d.display])).toEqual([
      ['lightning', 'extreme', 'Alert'],
      ['heat', 'moderate', '101°F'],
      ['flood', 'unknown', '3.21 ft'],
    ])
  })

  it('buckets weather into hourly points with unit conversion', () => {
    const timeline = buildTimeline([
      observation({ observed_at: '2026-10-17T15:10:00Z', numeric_value: 99 }),
      observation({
        id: 'newer',
        observed_at: '2026-10-17T15:50:00Z',
        numeric_value: 100,
      }),
      observation({
        id: 'wind',
        hazard_type: 'weather',
        metric_name: 'wind_speed',
        numeric_value: 16.09344,
        unit: 'km_h-1',
        observed_at: '2026-10-17T16:05:00Z',
      }),
      observation({
        id: 'rain',
        hazard_type: 'weather',
        metric_name: 'precipitation_accumulation',
        numeric_value: 25.4,
        unit: 'mm',
        observed_at: '2026-10-17T16:05:00Z',
      }),
    ])
    expect(timeline).toEqual([
      { t: '2026-10-17T15:00:00.000Z', heatIndex: 100 },
      { t: '2026-10-17T16:00:00.000Z', windMph: 10, precipIn: 1 },
    ])
  })

  it('collapses one strike seen by several sites into one marker', () => {
    const rows: SiteObservationDTO[] = [4.2, 1.5].map((distance, index) => ({
      site: siteDto,
      observation: observation({
        id: `strike-${index}`,
        hazard_type: 'lightning',
        metric_name: 'lightning_strike_distance',
        source: 'fixture',
        source_event_id: 'strike-1',
        numeric_value: distance,
        latitude: 32.31,
        longitude: -97.8,
      }),
    }))
    const strikes = toStrikes(rows)
    expect(strikes).toHaveLength(1)
    expect(strikes[0].distanceMi).toBe(1.5)
  })
})

describe('reports', () => {
  it('maps crew reports and the storm/weather vocabulary both ways', () => {
    expect(
      toHazardReport({
        id: 'r1',
        site_id: SITE_ID,
        hazard_type: 'weather',
        description: 'Gusts over 40 mph',
        latitude: 32.3,
        longitude: -97.8,
        image_reference: null,
        image_metadata: {},
        reported_at: '2026-10-17T15:00:00Z',
        reporter_subject: 'dana',
        verification_status: 'unverified',
      })
    ).toMatchObject({ type: 'storm', status: 'new', reportedBy: 'dana' })
    expect(hazardFromReportType('storm')).toBe('weather')
    expect(hazardFromReportType('soil')).toBe('soil')
  })
})

describe('briefings', () => {
  const rows: BriefingDTO[] = [
    {
      id: 'b1',
      site_id: SITE_ID,
      briefing_date: '2026-10-18',
      generated_at: '2026-10-17T23:00:00Z',
      summary: 'Hot afternoon expected. Start early and hydrate.',
      hazard_details: { briefing_source: 'gemini:flash', active_alert_ids: [] },
    },
    {
      id: 'b2',
      site_id: 'other-site',
      briefing_date: '2026-10-18',
      generated_at: '2026-10-17T23:05:00Z',
      summary: 'Next-day safety briefing for Other.',
      hazard_details: { briefing_source: 'template' },
    },
    {
      id: 'b3',
      site_id: SITE_ID,
      briefing_date: '2026-10-17',
      generated_at: '2026-10-16T23:00:00Z',
      summary: 'Older.',
      hazard_details: {
        generation_status: 'fallback',
        active_alert_ids: ['a1'],
      },
    },
  ]

  it('builds the fleet view for the latest shift date', () => {
    const risks = new Map([[SITE_ID, toSiteRisk(SITE_ID, 'available', risk())]])
    const briefing = buildFleetBriefing(rows, risks, [toAlert(alert())])
    expect(briefing?.shiftDate).toBe('2026-10-18')
    expect(briefing?.generatedAt).toBe('2026-10-17T23:05:00Z')
    expect(briefing?.sites.map((s) => [s.siteId, s.score])).toEqual([
      [SITE_ID, 7.2],
      ['other-site', null],
    ])
    expect(briefing?.sites[0].headline).toBe('Hot afternoon expected.')
    expect(briefing?.sites[0].generator).toBe('gemini')
    expect(briefing?.headline).toBe(
      '1 NO-GO · 0 CAUTION · 0 REVIEW · 0 GO'
    )
    expect(
      briefing?.watchlist.find((item) => item.type === 'lightning')?.count
    ).toBe(1)
  })

  it('does not score a briefing with a risk for a different date', () => {
    const risks = new Map([
      [
        SITE_ID,
        toSiteRisk(
          SITE_ID,
          'available',
          risk({ prediction_date: '2026-10-17' })
        ),
      ],
    ])
    expect(buildFleetBriefing(rows, risks, [])?.sites[0].score).toBeNull()
  })

  it('summarises earlier shift dates', () => {
    expect(buildBriefingHistory(rows.slice(2))).toEqual([
      { shiftDate: '2026-10-17', sites: 1, fallback: 1, withAlerts: 1 },
    ])
  })
})

describe('trendFromHistory', () => {
  it('compares the two most recent prediction dates', () => {
    expect(trendFromHistory([{ date: '2026-10-17', score: 3 }])).toBeUndefined()
    expect(
      trendFromHistory([
        { date: '2026-10-17', score: 3 },
        { date: '2026-10-18', score: 4 },
      ])
    ).toBe('rising')
    expect(
      trendFromHistory([
        { date: '2026-10-17', score: 3 },
        { date: '2026-10-18', score: 3.1 },
      ])
    ).toBe('steady')
  })
})

describe('guided photo reports', () => {
  it('maps a session, turning weather into storm and nulls into absent fields', () => {
    const session = toCaptureSession({
      id: 'c1',
      site_id: SITE_ID,
      hazard_type: 'weather',
      status: 'active',
      guided: false,
      next_step: null,
      checklist: [],
      draft: '',
      danger: null,
      report_id: null,
    })
    expect(session.type).toBe('storm')
    expect(session.nextStep).toBeUndefined()
    expect(session.danger).toBeUndefined()
    expect(session.reportId).toBeUndefined()
  })

  it('keeps the checklist order and what each photo showed', () => {
    const session = toCaptureSession({
      id: 'c2',
      site_id: SITE_ID,
      hazard_type: 'flood',
      status: 'active',
      guided: true,
      next_step: { item: 'depth', instruction: 'Frame a post.', frames: 1 },
      checklist: [
        {
          item: 'extent',
          instruction: 'Step back.',
          frames: 1,
          status: 'done',
          text: 'Water covers part of the road',
        },
        {
          item: 'depth',
          instruction: 'Frame a post.',
          frames: 1,
          status: 'pending',
        },
      ],
      draft: 'Water covers part of the road.',
      danger: null,
      report_id: null,
    })
    expect(session.nextStep?.item).toBe('depth')
    expect(session.checklist.map((s) => s.status)).toEqual(['done', 'pending'])
    expect(session.checklist[1].text).toBeUndefined()
  })

  it('maps the hazard guess from a photo check', () => {
    const feedback = toCaptureFeedback({
      item: 'identify',
      satisfied: true,
      text: 'Looks like storm damage',
      hint: null,
      hazard_guess: 'weather',
      confidence: 0.8,
    })
    expect(feedback.typeGuess).toBe('storm')
    expect(feedback.hint).toBeUndefined()
  })
})
