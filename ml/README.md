# PlanIT ML: hazard models

Implements [PLAN.md](PLAN.md): public data → daily features → one LightGBM model per hazard
(heat, convective, flood, wildfire) plus a rule-based wildlife score → 0–10 hazard index,
served as the agreed risk JSON.

## Quick start

```bash
cd ml
uv sync
./run_all.sh                         # full pipeline (~2.5 h, mostly the weather pull)
uv run python score.py EIA-56407     # tomorrow's risk JSON for one site
uv run uvicorn api:app --port 8000   # HTTP endpoint for A and C
```

Each script under `pipeline/` can be run on its own and skips work that is already on disk.

| Step | Script | Output |
|---|---|---|
| Sites (EIA-860M, 50 sites in 4 hazard regions, timezone, county FIPS) | `01_sites.py` | `data/processed/sites.parquet` |
| Hourly weather, 2019–2025 (Open-Meteo archive, throttled) | `02_weather.py` | `data/raw/weather/{site}_{year}.parquet` |
| Storm Events details | `03_storm_events.py` | `data/raw/storm_events/` |
| NWS zone↔county lookup | `04_zone_county.py` | `data/raw/zone_county.dbx` |
| FIRMS VIIRS yearly US files | `05_firms.py` | `data/raw/firms/` |
| OSHA severe injury reports | `06_osha.py` | `data/raw/osha.csv` |
| FEMA flood zone per site | `09_fema.py` | columns in `sites.parquet` |
| Nearest gauge, NWS flood stage, daily stage | `10_gauges.py` | `data/raw/gauges/`, columns in `sites.parquet` |
| CO-OPS daily high water vs MHHW | `11_tides.py` | `data/raw/tides/`, columns in `sites.parquet` |
| GBIF alligator / venomous snake / bear sightings by month | `12_gbif.py` | `models/wildlife_sightings.parquet` |
| Features + labels → training table | `07_build_table.py` | `data/processed/train.parquet`, `models/baselines.parquet`, `climatology.parquet`, `sites.parquet` |
| Train, calibrate, test, SHAP | `08_train.py` | `models/{hazard}.txt`, `{hazard}_calibrator.pkl`, `{hazard}_reliability.png`, `metadata.json` |
| Backtest on a 2025 event | `13_backtest.py [--event-id N]` | `models/backtest_{event}.png`, `.json` |

Shared code: `features.py` (used by training **and** live scoring), `labels.py`, `common.py`.

## API

`GET /score?site_id=EIA-56407[&date=YYYY-MM-DD]` returns tomorrow's (site-local) risk JSON.
`POST /score` takes A's live alerts and recent crew reports:

```json
{"site_id": "EIA-59145",
 "alerts": [{"type": "lightning", "action": "no-go", "message": "Strike within 10 mi"}],
 "crew_reports": [{"animal": "alligator", "reported_at": "2026-10-16T14:00:00"}]}
```

`GET /sites` lists the sites. Add `?mock=true` (or start the API before models exist) for a
deterministic placeholder in the same shape.

Response (the agreed shape, plus `hazard` on each reason and `overrides` when an alert applied):

```json
{
  "site_id": "EIA-59145", "date": "2026-10-17", "hazard_index": 5.8, "recommendation": "no-go",
  "sub_scores": {"heat": 0.0, "convective": 0.0, "flood": 0.0, "wildfire": 1.3, "wildlife": 5.2},
  "reasons": [{"hazard": "wildlife", "factor": "crew_report", "value": 0.4, "impact": 4.35,
               "text": "Crew reported alligator within the last day"}],
  "model_version": "v1",
  "overrides": [{"type": "lightning", "action": "no-go", "effect": "no-go"}]
}
```

- **Sub-scores** are calibrated probabilities × 10. **Index** = `10 × (1 − Π(1 − pᵢ))`.
- **Recommendation**: index rounded to a whole number, 0–3 go, 4–6 caution, 7–10 no-go
  (cut-offs 3.5 and 6.5). A's alerts with `action` `no-go`/`stop-work` force no-go, `caution`
  raises go to caution. Alerts never change the numbers.
- **Reasons**: per-feature LightGBM contributions (TreeSHAP), converted to "how many sub-score
  points this feature adds", top 5 across hazards. Seasonal/region context features are not shown.

## Where this differs from PLAN.md, and why

- **No thunderstorm weather codes in the archive.** Open-Meteo's archive never emits codes 95–99
  (checked: only 0–3, 51–55, 61–65, 71–75 appear), so "thunderstorm hours" would be all zeros in
  training. The convective model uses proxies from the same 10 hourly variables instead: heavy-rain
  hours, afternoon rain, peak rain rate, gust factor (gust − sustained), largest 1-hour temperature
  drop (outflow), dew point, heat. `ts_hours` is still computed for the briefing.
- **Forecast soil moisture layers differ.** The forecast API (best_match) returns no 0–7 / 7–28 cm
  soil moisture; `features.harmonize_forecast` maps its GFS layers (0–1, 1–3, 3–9, 9–27 cm) onto them.
  Expect some bias between ERA5 and GFS soil moisture.
- **Site history feature (`{hazard}_climo`).** Each model gets "how often this hazard was logged at
  this site in this month, 2019–2023", the same number as the plan's baseline. The model then learns
  what today's weather adds on top. Training rows use leave-one-year-out rates so a row's own label
  never feeds its feature. Without it, wildfire and flood could not beat the baseline, because fire
  and river-flood activity follow site and season more than daily weather.
- **Flood label = onset.** Storm Events "Flood" (river/areal) events can run for weeks; 172 events of
  10+ days made up most flood days (2019 Mississippi/Plains). Local weather only explains their start,
  so each one counts for its first 3 days (`labels.FLOOD_ONSET_DAYS`), and later days are left out
  of flood training and evaluation (not labelled 0). Ongoing river floods are covered by the gauge
  features and A's live alerts. Flash Flood and Coastal Flood are unchanged.
- **Heat drops `region`; flood drops day-of-year.** With site history in, `region` mostly stood in for
  regional differences in NWS heat reporting (the plan's "not site ID" check), and day-of-year was
  crowding out rain in the flood model. Removing them improved flood (PR-AUC 0.10 → 0.14) and left
  heat driven by temperature and heat-index anomaly.
- **Wildfire label threshold.** A single FIRMS pixel within 25 km is mostly small agricultural or
  prescribed burns (≈10k positive days spread evenly over the year). A day counts as a fire day when
  there are ≥ 3 vegetation-fire detections (or a Storm Events "Wildfire"); see `labels.FIRMS_MIN_DETECTIONS`.
- **USGS gauges** come from the new USGS Water Data API (`dataretrieval.waterdata`); the legacy
  NWIS services time out. Many gauges publish stage only as instantaneous values, which are reduced
  to a local-day max. The anonymous quota is 1,000 requests/hour; set `API_USGS_PAT` to go faster.
- **FEMA**: `hazards.fema.gov` resets connections from some networks; `09_fema.py` falls back to
  Esri's Living Atlas copy of the NFHL. Points with no polygon are recorded as `unmapped/X`.
- **Distance to river** is approximated by distance to the nearest USGS stream monitoring location.
- **Wetland distance** for the wildlife score isn't available; FEMA flood-hazard area or a tide
  station nearby is used as a "wet site" proxy.
- **Live gauge and tide inputs**: gauge stage uses NWS observed + forecast stage (persisted to the
  target day); tides use CO-OPS predicted high water vs MHHW (astronomical only, no surge), whereas
  training used observed water levels.

## Wildlife score (heuristic, not a trained model)

Per animal group (alligator, venomous snake, bear): GBIF sightings within 25 km in that calendar
month (2015–2025) → presence 0–1 (saturates at 20). Reptiles are scaled by temperature (×0.2 below
60°F, up to ×1.5 above 80°F) and ×1.2 at wet sites. Each group contributes up to ~8% chance; a crew
report adds 50%, decaying with a 3-day time constant. Be upfront in the demo that this is a heuristic.

## Results (2025 test year, never seen in training or calibration)

50 sites × 2,556 days = 127,800 rows. Train 2019–2023, calibrate 2024, test 2025. Baseline =
"how often this happens at this site in this month" (2019–2023). Full numbers in `models/metadata.json`.

| Hazard | Positive days (train / test) | PR-AUC model | PR-AUC baseline | ROC-AUC model | ROC-AUC baseline | Brier model | Brier baseline | Test base rate | Top SHAP drivers |
|---|---|---|---|---|---|---|---|---|---|
| heat | 1,735 / 156 | **0.226** | 0.091 | **0.964** | 0.931 | **0.0076** | 0.0098 | 0.9% | heat_climo, t_min, hi_max_anom, t_max |
| convective | 1,402 / 309 | **0.189** | 0.059 | **0.919** | 0.805 | **0.0147** | 0.0163 | 1.7% | td_max, precip_max_hr, gust_factor_max, hi_max |
| flood | 1,050 / 141 | **0.190** | 0.018 | **0.909** | 0.710 | **0.0069** | 0.0081 | 0.8% | api, log_dist_stream_km, flood_climo, region |
| wildfire | 2,771 / 535 | **0.206** | 0.118 | **0.807** | 0.761 | **0.0257** | 0.0273 | 2.9% | wildfire_climo, vpd_max, region, rh_min_afternoon |

All four beat the baseline on every metric. PR-AUC is the honest headline for rare events: 2–10× the
baseline, against base rates of 1–3%.

Reliability plots: `models/{hazard}_reliability.png`. Convective, flood and wildfire track the diagonal.
Heat is overconfident in its top bin (predicted ~0.5, observed ~0.3) because 2025 was a mild heat year
(156 positive days vs 329 in the 2024 calibration year).

### Backtest

`models/backtest_1288021.png`: **July 5 2025 flash flood**, Williamson County TX ($25M), whose track
ends within 25 miles of Hal C Weaver Power Plant (Austin). The index sits around 1.5 (go), reaches 3.5
(caution) two days ahead as about 4 in of rain falls on July 2–4, peaks at **7.0 (no-go)** on the day
(5.0 in, the gauge at 172% of flood stage) with flood at 6.7, and drops back to 1.8 the next day.

`models/backtest_1249939.png`: an honest miss. The largest 2025 event near a site (Rio Grande Valley
flash flood, Mar 27, $105M) only reaches 2.3. The reanalysis has 1.2 in of rain that day at the site,
an order of magnitude below what fell, so the model never saw the storm. Live forecasts have the same
kind of grid-scale limit for extreme local rain.

Backtests use reanalysis weather for each day, i.e. a "perfect forecast" test of whether the models
react to the right conditions, not of forecast skill.

### Caveats for the demo

- Labels are what NWS offices and OSHA *recorded*, not every hazardous day; "1%" means 1% of days
  got an official report near the site.
- Only 10 of 50 sites have a usable river gauge, and 7 have tide data; elsewhere those features are blank.
- Wildlife is a heuristic. Say so.
