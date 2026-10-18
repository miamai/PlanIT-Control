# Hazard severity, Hazard Index, Top Drivers, and decisions

This document describes the production data path and keeps four concepts separate:

1. A stored environmental measurement and its measurement severity.
2. A per-hazard model sub-score.
3. The aggregate 0–10 Hazard Index.
4. The operational risk decision. A dashboard decision is not work authorization.

## End-to-end data flow

The Supervisor Dashboard requests `GET /api/risk/rankings`. Core selects each site's latest row
from `risk_scores`, derives a live decision using unresolved `alerts`, and returns typed
`top_drivers`. `frontend/src/api/mappers.ts` maps that contract into `SiteRisk`; the ranked table
renders up to three drivers or **Insufficient data**.

The score originates in `ml/score.py`. The daily ML service builds forecast features for the same
ML site and prediction date, calculates calibrated hazard probabilities, and returns the index,
sub-scores, explanations, model version, and date. `core/app/services/briefing.py` validates the
site/date/version before storing the result. Core never substitutes another site's prediction.
Between evening briefings the worker refreshes each covered site's score for its operational day
(today until 6 PM site-local, then tomorrow) every `ML_SCORE_INTERVAL_SECONDS`, and on the next
tick after a new crew report (`core/app/services/live_scoring.py`). Each refresh updates that
day's row in place, so history keeps one score per day: the last one calculated.

Relevant Tiger Data tables are:

- `sites`: core site identity plus `ml_site_id` and `ml_model_version` coverage.
- `hazard_observations`: timestamped values, units, quality, source, and provider metadata.
- `risk_scores`: prediction date, calculation time (`generated_at`), model/source, 0–10 score, and
  the original explanation payload in `contributing_factors`.
- `alerts` and `alert_transitions`: current safety rules and their audit history.
- `safety_briefings`: generated narrative and provenance linked to the stored risk score.

## Top Drivers

For trained heat, convective, flood, and wildfire models, LightGBM TreeSHAP contributions are
calculated in log-odds space. For each positive feature, the scorer removes that contribution,
recalibrates the hazard probability, and reports the resulting change in that hazard's 0–10
sub-score. Hidden context features and impacts below 0.1 are omitted. Drivers are sorted by positive
sub-score impact and the API exposes the top three.

Wildlife has no trained incident model. Its score and explanations are explicitly `rule_based`,
using nearby historical sightings and recent crew reports. The API labels every explanation as
either `tree_shap` or `rule_based`. Unknown/manual reason payloads are not presented as ML
contributions. Driver impact is never described as a percentage of the overall Hazard Index.

Heat, convective storms/lightning, flood, wildfire, and wildlife can therefore appear as drivers.
Soil moisture/saturation is currently an input feature to applicable models, not its own trained
sub-score; it can appear in an ML explanation when TreeSHAP reports a valid positive impact.

If the model emits no valid positive explanation, the UI says **Insufficient data**. It does not
manufacture a contribution from a displayed observation or from the aggregate score.

## Measurement severity

`core/app/services/hazard_severity.py` is the authoritative classifier for stored observations.
The API returns `severity` and `severity_basis` with each observation. Missing values, invalid
units, and metrics without enough context return `UNKNOWN`, never `LOW`.

Configured demo defaults are:

| Measurement | Low | Moderate | High | Critical |
| --- | ---: | ---: | ---: | ---: |
| Calculated heat index | <91°F | 91–<103°F | 103–<125°F | ≥125°F |
| 24-hour rainfall flood indicator | <25.4 mm | 25.4–<50.8 mm | 50.8–<101.6 mm | ≥101.6 mm |

The rainfall row is only a monotonic rainfall indicator. It does not claim actual flooding. Raw
gage height and streamflow remain `UNKNOWN` unless station-specific flood stages or an official
warning provide the missing context. The antecedent-rainfall soil value is likewise labeled as a
proxy, not measured saturation.

These configurable defaults are demonstration thresholds, not OSHA, utility, or official safety
regulations. Production already rejects the `demo` threshold profile; reviewed deployments must
set an approved profile and values or disable threshold-generated alerts.

When the UI displays an observation, its severity comes from that exact value, unit, source, and
observation timestamp. A next-day model sub-score may still be shown in the detail text, but it no
longer supplies the severity label for a different current observation.

## Hazard Index

The numeric index is not a frontend formula or fixture. Trained hazards produce calibrated event
probabilities; wildlife produces a documented rule-based probability. The aggregate is:

`10 × (1 − Π(1 − p_hazard))`

The database enforces the 0–10 range. Core also validates finite sub-scores, site identity,
prediction date, and model version before persistence. The calculation timestamp, prediction date,
score source, and model version are returned by the API.

A high category can coexist with a lower aggregate depending on calibration and the other hazard
probabilities. The category sub-scores and Top Drivers explain that result; the aggregate is not
forced to equal the maximum category.

The former demo seed wrote indexes based on row order, unrelated to its displayed heat/rainfall
observations and without explanations. Migration `20261017_0005` removes those rows, and the seed
command no longer creates a numeric Hazard Index. Valid ML generation is the only bundled path that
populates explained daily scores.

## GO / CAUTION / NO-GO / REVIEW_REQUIRED

`core/app/services/decision.py` is the authoritative live policy:

- An unresolved STOP_WORK/no-go alert, or an alert at configured HIGH/CRITICAL severity, yields
  `NO_GO` even when the Hazard Index is low.
- With an available score, index bands are GO below 3.5, CAUTION from 3.5 to below 6.5, and NO-GO
  at 6.5 or above. A moderate/caution alert can raise GO to CAUTION.
- A missing, unsupported, or stale Hazard Index yields `REVIEW_REQUIRED` unless a stop condition
  already requires NO-GO.

The decision is recalculated from current alerts on every risk/rankings request. It does not reuse a
possibly stale alert override embedded in yesterday's ML payload. `operational_authorization` is
always `NOT_GRANTED`: supervisors must follow site procedures and authorization controls outside
this environmental assessment.
