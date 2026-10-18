# Precognition hazard index: model card (v1)

Trained 2026-10-18T02:21:49+00:00 on 96 power-plant sites, 2019-2023; calibrated on 2024; tested on 2025, a year the models never saw.

## Test-year skill (95% CI, whole sites resampled)

| Hazard | PR-AUC model | PR-AUC baseline | ROC-AUC | Brier model / baseline | New sites (held out): PR-AUC / ROC-AUC |
|---|---|---|---|---|---|
| heat | 0.61 (0.52-0.72) | 0.18 (0.12-0.22) | 0.98 (0.97-0.98) | 0.0153 / 0.0253 | 0.64 / 0.98 |
| convective | 0.48 (0.44-0.52) | 0.20 (0.17-0.23) | 0.93 (0.92-0.93) | 0.0487 / 0.0646 | 0.49 / 0.92 |
| flood | 0.33 (0.26-0.39) | 0.06 (0.04-0.08) | 0.90 (0.89-0.92) | 0.0181 / 0.0227 | 0.29 / 0.86 |
| wildfire | 0.34 (0.27-0.41) | 0.21 (0.12-0.31) | 0.88 (0.85-0.89) | 0.0310 / 0.0346 | 0.20 / 0.81 |

## Graded like a forecast (2025)

A warning = the index said caution or no-go. POD = share of hazard days warned; FAR = share of warnings with no recorded hazard; CSI = hits / (hits + misses + false alarms).

| Warning | POD | FAR | CSI | Days warned |
|---|---|---|---|---|
| caution or no-go | 0.56 | 0.47 | 0.37 | 15% |
| no-go only | 0.18 | 0.26 | 0.17 | 4% |
| heat sub-score 3.5+ | 0.62 | 0.39 | 0.44 | 3% |
| convective sub-score 3.5+ | 0.47 | 0.48 | 0.32 | 7% |
| flood sub-score 3.5+ | 0.18 | 0.33 | 0.16 | 1% |
| wildfire sub-score 3.5+ | 0.25 | 0.47 | 0.20 | 2% |

Damaging Storm Events within 25 miles of a site in 2025: 1272 event-site days; 70% got caution or no-go that day (28% no-go). By hazard: convective 70%, flood 75%, heat 82%, wildfire 61%.

Scores use reanalysis weather for each day (a perfect-forecast test); live forecasts add their own error.

## Hourly thunder (work windows)

PR-AUC 0.19 vs 0.07 baseline; ROC-AUC 0.93. At the 'avoid' threshold (0.13): 40% of thunder hours flagged, 22% of flagged hours had thunder.

## Briefing writer

- Qwen3-4B-Instruct-2507-4bit: 97% of drafts pass the checker first try, 100% after one retry; 6.35s per briefing; 2.91 GB.
- Qwen3.5-4B-MLX-4bit: 97% of drafts pass the checker first try, 100% after one retry; 6.58s per briefing; 3.26 GB.

## Limitations

- Labels are days something was recorded (report, injury, warning, thunder at a station), not every hazardous day.
- Weather is reanalysis in training and a forecast live; the archive has no storm-energy (CAPE) data.
- Wildlife is a heuristic from sightings and crew reports, not a trained model.
- Sites cover the continental US regions picked for hazards; Alaska, Hawaii and the Northeast are not covered.
