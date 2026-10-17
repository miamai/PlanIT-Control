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
| Sites (EIA-860M, 200 sites in 7 regions, timezone, county FIPS) | `01_sites.py` | `data/processed/sites.parquet` |
| Hourly weather, 2019–2025 (Open-Meteo archive, throttled, 8,500 calls/day cap) | `02_weather.py` | `data/raw/weather/{site}_{year}.parquet` |
| Storm Events details | `03_storm_events.py` | `data/raw/storm_events/` |
| NWS zone↔county lookup | `04_zone_county.py` | `data/raw/zone_county.dbx` |
| FIRMS VIIRS yearly US files | `05_firms.py` | `data/raw/firms/` |
| OSHA severe injury reports | `06_osha.py` | `data/raw/osha.csv` |
| FEMA flood zone per site | `09_fema.py` | columns in `sites.parquet` |
| Nearest gauge, NWS flood stage, daily stage | `10_gauges.py` | `data/raw/gauges/`, columns in `sites.parquet` |
| CO-OPS daily high water vs MHHW | `11_tides.py` | `data/raw/tides/`, columns in `sites.parquet` |
| GBIF alligator / venomous snake / bear sightings by month | `12_gbif.py` | `models/wildlife_sightings.parquet` |
| NWS warning archive at each site (Iowa Environmental Mesonet) | `14_iem_warnings.py` | `data/raw/iem_warnings/` |
| Thunder reports at the nearest ASOS station (Iowa Environmental Mesonet) | `15_asos_thunder.py` | `data/raw/asos/`, columns in `sites.parquet` |
| Features + labels → training table | `07_build_table.py` | `data/processed/train.parquet`, `models/baselines.parquet`, `climatology.parquet`, `sites.parquet` |
| Train, calibrate, test, SHAP | `08_train.py` | `models/{hazard}.txt`, `{hazard}_calibrator.pkl`, `{hazard}_reliability.png`, `metadata.json` |
| Backtest on a 2025 event | `13_backtest.py [--event-id N]` | `models/backtest_{event}.png`, `.json` |
| Briefing model bake-off | `16_briefing_bakeoff.py` | `models/briefing_bakeoff.md`, `.json` |
| Hourly thunder model (work windows) | `17_hourly_thunder.py` | `models/thunder_hourly.txt`, calibrator, reliability plot |

Shared code: `features.py` (used by training **and** live scoring), `labels.py`, `common.py`.

## API

`GET /score?site_id=EIA-56407[&date=YYYY-MM-DD]` returns tomorrow's (site-local) risk JSON.
`POST /score` takes A's live alerts and recent crew reports:

```json
{"site_id": "EIA-59145",
 "alerts": [{"type": "lightning", "action": "no-go", "message": "Strike within 10 mi"}],
 "crew_reports": [{"animal": "alligator", "reported_at": "2026-10-16T14:00:00"}]}
```

`GET /briefing?site_id=...` (and `POST`, same body) returns `{risk, briefing, source, facts, tried}`.
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

## Hourly work plan

`/score` and `/briefing` add a `work_plan`: for each hour from 5 AM to 8 PM local time, the heat index
with its OSHA risk band (lower < 91°F, moderate 91–103°F, high 103–115°F, very high 115°F+) and the
chance of thunder from a second, **hourly** model. Hours in the high heat band, or at or above the
thunder threshold, are marked "avoid". The rest are grouped into work windows of 2+ hours, e.g. "work
6 AM to 11 AM; heat index 103°F or higher from 12 PM to 4 PM; thunder likely from 2 PM to 5 PM".

The hourly thunder model (`pipeline/17_hourly_thunder.py`) is a LightGBM classifier on 2.6M site-hours
(43 sites with a thunder station). The label is thunder reported at the station during that hour; the
inputs are hourly rain (with neighbouring hours), gusts, temperature, dew point, humidity, solar
radiation, soil moisture, time of day, season and region, plus the day's peak rain rate, heat and
dew point. 2025 test year: **PR-AUC 0.17 vs 0.07** for the site × month × hour-of-day baseline,
ROC-AUC 0.92. The "avoid" threshold (0.13, best F1 on 2024) flags 2.8% of hours and catches 38% of
thunder hours. Skill is modest because the weather archive has no storm-energy (CAPE) data; real-time
lightning stop-work stays with the alert engine.

## Briefing

`briefing.py` / `GET|POST /briefing` turns the risk JSON into a 3–5 sentence next-day briefing. The
models decide; the language model only explains:

1. **Fact sheet**: everything the briefing may say (decision, index, scores, reasons, work windows,
   live alerts, recommended actions), built from the risk JSON.
2. **Writer**: a local open model on Apple Silicon (MLX, weights from Hugging Face), or Gemini over
   REST when `GEMINI_API_KEY` is set (`GEMINI_MODEL` picks the model; not tested here without a key).
3. **Checker**: rejects a draft if it uses any number not in the fact sheet, states a different
   decision, leaves out the main concern, or brings up a hazard the facts don't mention (tornado,
   snake, ...). A rejected draft gets one retry with the checker's feedback, then falls back to a
   template that always passes.

The response says which writer produced the text (`source`) and what the checker found (`tried`).
The local model needs Apple Silicon; on Linux (e.g. Vultr) `mlx-lm` isn't installed and `/briefing`
uses Gemini or the template. For the 6 PM run, call `/briefing` per site.

**Bake-off results pending** (`pipeline/16_briefing_bakeoff.py`; summary in `models/briefing_bakeoff.md`).

## Sites and labels (v2)

**200 sites.** The plan's four hazard regions grew from 50 to 145 sites (Gulf/FL 35, Mississippi 25,
CA/AZ 35, Plains 35), plus three regions for wider coverage: Southeast 25, Ohio Valley 20, Mountain West 25.
The original 50 sites are unchanged. The weather pull is capped at 8,500 Open-Meteo calls per UTC day
(the free tier is 10k, shared with live `/score`), so the 150 new sites take about three days to download.
`07_build_table.py` uses every site whose seven years are complete, so re-running `07` and `08` picks up
new sites as they land.

**Each label = observed near the site OR an NWS warning covering it.**

| Hazard | Observed | NWS warning (IEM archive) |
|---|---|---|
| heat | Storm Events Heat/Excessive Heat; OSHA outdoor heat injury within 25 mi | Heat Advisory, Excessive/Extreme Heat Warning |
| convective | Storm Events Thunderstorm Wind/Hail/Lightning within 25 mi; **thunder at the nearest ASOS station (40 km)** | Severe Thunderstorm, Tornado Warning |
| flood | Storm Events Flash/Coastal Flood, first 3 days of Flood | Flash Flood, Flood, Coastal Flood Warning (first 3 days) |
| wildfire | Storm Events Wildfire; ≥ 3 FIRMS detections within 25 km | Red Flag Warning |

Why: Storm Events only records what someone reported, usually because of damage. Warnings are issued
on fixed criteria, so they're more consistent across offices, and they roughly double the positive days.
On the original 50 sites, adding them raised 2025 PR-AUC against each label's own baseline for every
hazard (heat 0.25 → 0.59, convective 0.20 → 0.32, flood 0.17 → 0.26, wildfire 0.19 → 0.28). The
trade-off: the models now target "a day NWS flagged as hazardous", which is broader than "a day with a
damage report", so they score slightly lower against the old Storm Events-only labels.

ASOS thunder is the lightning record the plan was missing (Storm Events only logs damaging strikes,
and the archive has no thunderstorm weather codes). 168 of 200 sites have a station that reports
thunder (full ASOS, or an AWOS with thunder on 20+ days). The convective model trains only on those
sites and has no site-history feature, so it scores every site from the weather alone.

A thunder day needs **3+ hours of thunder** (`labels.THUNDER_MIN_HOURS`). Counting any thunder made the
index say no-go far too often. Three convective labels compared on 2025, original 50 sites:

| Convective label | PR-AUC (baseline) | No-go days | Gulf/FL summer no-go |
|---|---|---|---|
| Any thunder | 0.61 (0.38) | 9.1% | 45% |
| **3+ hours of thunder (used)** | 0.45 (0.21) | 4.0% | 16% |
| Severe storms only (no thunder) | 0.32 (0.09) | 3.1% | 12% |

## Where this differs from PLAN.md, and why

- **No thunderstorm weather codes in the archive.** Open-Meteo's archive never emits codes 95–99
  (checked: only 0–3, 51–55, 61–65, 71–75 appear), so "thunderstorm hours" would be all zeros in
  training. The convective model uses proxies from the same 10 hourly variables instead: heavy-rain
  hours, afternoon rain, peak rain rate, gust factor (gust − sustained), largest 1-hour temperature
  drop (outflow), dew point, heat. `ts_hours` is still computed for the briefing.
- **Forecast soil moisture layers differ.** The forecast API (best_match) returns no 0–7 / 7–28 cm
  soil moisture; `features.harmonize_forecast` maps its GFS layers (0–1, 1–3, 3–9, 9–27 cm) onto them.
  Expect some bias between ERA5 and GFS soil moisture.
- **Site history feature (`{hazard}_climo`).** Heat, flood and wildfire get "how often this hazard was logged at
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

Current models: the **50 sites whose weather is complete** (the other 150 are still downloading; re-run
`07_build_table.py` and `08_train.py` when they land). 50 sites × 2,556 days = 127,800 rows; convective
uses the 43 of them with a thunder station. Train 2019–2023, calibrate 2024, test 2025. Baseline = "how
often this happens at this site in this month" (2019–2023). Full numbers in `models/metadata.json`.

| Hazard | Positive days (train / test) | PR-AUC model | PR-AUC baseline | ROC-AUC model | ROC-AUC baseline | Brier model | Brier baseline | Test base rate | Top SHAP drivers |
|---|---|---|---|---|---|---|---|---|---|
| heat | 3,644 / 541 | **0.574** | 0.176 | **0.974** | 0.895 | **0.0170** | 0.0268 | 3.0% | heat_climo, t_min, hi_max, hi_max_anom |
| convective | 5,605 / 1,200 | **0.449** | 0.207 | **0.923** | 0.782 | **0.0507** | 0.0654 | 7.7% | region, precip_max_hr, doy_cos, td_max |
| flood | 2,941 / 382 | **0.261** | 0.053 | **0.905** | 0.746 | **0.0177** | 0.0215 | 2.1% | flood_climo, api, region, log_dist_stream_km |
| wildfire | 3,699 / 731 | **0.280** | 0.127 | **0.837** | 0.768 | **0.0330** | 0.0370 | 4.0% | wildfire_climo, vpd_max, t_max, rh_min_afternoon |

All four beat the baseline on every metric (PR-AUC 2.2–4.9× the baseline). v1 (Storm Events-only
labels) scored 0.23 / 0.19 / 0.19 / 0.21; the numbers aren't directly comparable because the labels
changed (see "Sites and labels"). Convective's top driver is `region`, a regional thunder-frequency
prior (Florida really is the thunder capital), followed by rain rate, season and dew point.

Reliability plots (`models/{hazard}_reliability.png`): all four track the diagonal. With the denser
labels, heat is no longer overconfident at the top end. 2025 recommendation mix across the 50 sites:
go 83%, caution 13%, no-go 4%.

### Backtest

`models/backtest_1288021.png`: **July 5 2025 flash flood**, Williamson County TX ($25M), whose track
ends within 25 miles of Hal C Weaver Power Plant (Austin). Thunderstorms keep the index at caution
(4–6) through the stormy stretch; it goes **no-go on July 3–5** as about 4 in of rain falls on July 2–4,
peaking at 9.5 on the day (flood 9.1; 5.0 in of rain, the gauge at 172% of flood stage), then drops
back to caution.

`models/backtest_1249939.png`: the largest 2025 event near a site (Rio Grande Valley flash flood,
Mar 27, $105M). The reanalysis has only 1.2 in of rain that day, an order of magnitude below what fell,
so flood stays low (1.2). The thunder signal still lifts the index to **caution (6.2)** on the day.
Extreme local rain is a grid-scale limit for live forecasts too.

Backtests use reanalysis weather for each day, i.e. a "perfect forecast" test of whether the models
react to the right conditions, not of forecast skill.

### Caveats for the demo

- Labels are days something was *recorded* (a report, an injury, a warning, thunder at a station),
  not every hazardous day.
- 47 of 200 sites have a usable river gauge and 19 have tide data; elsewhere those features are blank.
- Wildlife is a heuristic. Say so.
- The weather pull shares the Open-Meteo free tier with live `/score`; it stops at 8,500 calls per
  UTC day to leave room for the demo.
