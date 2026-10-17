# ML Plan: Data Download and Model Training

Owner: Person B (ML and AI). This covers getting historical data from public sources and training the hazard models behind the 0–10 hazard index.

## How it fits together

- We **train** small gradient-boosted tree models (LightGBM) from scratch, one per hazard: heat, convective (lightning and thunderstorm wind), flood and wildfire. Wildlife is a rule-based score because there's no good historical incident data to train on.
- Each evening, tomorrow's forecast runs through the same feature code. Each model outputs a calibrated probability, scaled to a 0–10 sub-score, and they are combined into the overall index with `10 × (1 − Π(1 − pᵢ))`.
- The risk JSON (scores, top SHAP reasons, A's live alerts, recent crew reports) is sent to Gemini, which writes the briefing. **The models decide; Gemini only explains.** It must never change a number. If Gemini fails or its output doesn't validate, a plain template briefing goes out instead.
- Recommendation thresholds: **0–3 go, 4–6 caution, 7–10 no-go**. A's rule-based alerts always override the model; for example, an active lightning stop-work means no-go.

## Setup

- **Language and tools:** Python 3.12 with `uv`. Libraries: `pandas`, `pyarrow`, `requests-cache`, `lightgbm`, `scikit-learn`, `shap`, `timezonefinder`, `dataretrieval`.
- **Years:** 2019–2025. Train on 2019–2023, calibrate on 2024, test on 2025.

```
ml/
  data/raw/        # untouched downloads (HTTP caches, logs and weather_budget.json stay local)
  data/processed/  # sites.parquet, weather_daily.parquet, labels.parquet, train.parquet
  pipeline/        # 01_sites.py … 08_train.py
  features.py      # shared by training AND the live endpoint
  models/          # heat.txt, heat_calibrator.pkl, metadata.json …
```

## Phase 1: Downloads

Start the weather pull (row 2) first; it's the slowest.

| # | Source | What to pull | How | Output |
|---|---|---|---|---|
| 1 | **EIA-860M** (latest monthly Excel file) | "Operating" sheet: Plant ID, name, state, county, lat/lon, technology | Remove duplicates by Plant ID (the file lists each generator separately). **Pick 50 sites spread across hazard regions:** Gulf/FL (heat, flood, gators), the Mississippi corridor (river flood), CA/AZ (wildfire, heat) and the Plains (storms), so every model gets positive examples. Add timezone (`timezonefinder`) and county FIPS (FCC Area API). | `sites.parquet` |
| 2 | **Open-Meteo archive** | Hourly, **≤10 variables**: temperature, humidity, precipitation, weather code, wind speed, wind gusts, soil moisture (0–7 cm and 7–28 cm), VPD, solar radiation | One request per site per year, cached and resumable. **Budget:** about 183 calls per site, so 50 sites ≈ 9.2k calls. That fits the 10k/day free limit if throttled under 5k/hour, about 2 hours in total. | `raw/weather/{site}_{year}.parquet` |
| 3 | **NOAA Storm Events** | `StormEvents_details-ftp_v1.0_d{YEAR}_c*.csv.gz` for 2019–2025 | Download straight from NCEI's `stormevents/csvfiles/` | `raw/storm_events/` |
| 4 | **NWS zone↔county lookup** | Pipe-delimited lookup file | One download from weather.gov/gis/ZoneCounty | `raw/zone_county.dbx` |
| 5 | **NASA FIRMS** | VIIRS yearly USA country files, 2019–2025 | Keep `type == 0` (vegetation fire). This removes power plants and other fixed heat sources. | `raw/firms/` |
| 6 | **OSHA Severe Injury Reports** | Full CSV, which includes lat/lon | Filter to heat-related injuries | `raw/osha.csv` |
| 7 | **FEMA flood zones** | Flood hazard layer of the NFHL ArcGIS service | One point query per site, 50 requests | columns in `sites.parquet` |
| 8 | **USGS gauges and NWS flood stage** | Nearest gauge within about 10 km; daily gauge height; flood stage from the NWS NWPS API | `dataretrieval` package. River sites only. | `raw/gauges/` |
| 9 | **NOAA Tides** | Daily high/low water levels for coastal sites | CO-OPS API, one year per request | `raw/tides/` |
| 10 | **GBIF** | Alligator, venomous snake and bear sightings within 25 km of each site, by month | Occurrence API with the `geoDistance` filter. Look up species keys with the species-match API rather than hardcoding them. | `raw/gbif/` |

Rows 1–6 are needed for the core models. Rows 7–10 make the flood and wildlife scores stronger; do them after the heat model works end to end.

**Open-Meteo caveats:**
- **No CAPE in the archive.** The convective model relies on thunderstorm weather codes, rain intensity, gusts, heat and humidity instead.
- **Gusts can be blank.** Wind gusts aren't in the plain ERA5 source, so keep the default `best_match` model and check gusts aren't empty after the first pull.

## Phase 2: Build the training table

1. **Daily features** (`features.py`): hourly UTC → local day, then the per-model features below. Compute "normal for this site" baselines from 2019–2023 only.
2. **Labels** (`labels.py`):
   - Clean Storm Events: convert event times to local dates, spread multi-day events across each day, and turn damage text like `"10.00K"` into numbers.
   - Events with `CZ_TYPE='Z'` use NWS forecast zones, not counties (heat, wildfire and coastal flood mostly do). Convert them with the zone↔county lookup.
   - Match events to sites by county or zone, or within 25 miles when the event has lat/lon.
   - Add FIRMS detections within 25 km (also drop detections within about 1 km of a site and ones that repeat at the same spot daily) and OSHA heat injuries within 25 miles.
   - Output one 0/1 column per hazard.
3. **Join** into `train.parquet`: about 50 sites × 2,557 days ≈ 128k rows.
4. **Check the positive counts.** Print how many positive days each hazard has. Below about 200, widen the radius or merge more event types before training.

### Features and labels per model

| Model | Features | Label | Watch out |
|---|---|---|---|
| **Heat** | Daily max heat index (NWS formula from temperature + humidity); work-hour (6a–6p) hours with heat index ≥ 103°F; overnight low; hot-day streak; difference from the site's normal for that time of year | Storm Events "Heat"/"Excessive Heat" (zone-based); OSHA heat injuries | NWS offices report heat inconsistently by region; the "difference from normal" feature reduces that bias |
| **Convective** | Thunderstorm weather-code hours (95–99); peak hourly rain rate; max gust; heat and humidity; day of year as sin/cos | Storm Events "Lightning", "Thunderstorm Wind", "Hail" within 25 miles | Lightning is only logged when it causes damage, so merge it with thunderstorm wind. Real-time stop-work stays with A's rule engine. |
| **Flood** | Rain totals over 24h/72h/7d/14d; decayed rain sum (antecedent precipitation index); soil moisture mean and 7-day change; gauge height as % of flood stage and 3-day rise (river sites); max water level above MHHW (coastal sites); FEMA zone; log distance to river | Storm Events "Flood", "Flash Flood", "Coastal Flood" | River floods peak days after the rain, so include lagged features. Leave gauge values blank for sites without one and add a `has_gauge` flag. |
| **Wildfire** | Min afternoon humidity; max VPD; max wind; days since rain ≥ 0.1 in; 30-day rain shortfall vs normal; Fosberg Fire Weather Index | FIRMS detections within 25 km (nominal/high confidence); Storm Events "Wildfire" | Power plants show up as hot spots (handled by the filters above). Fire days are rare and concentrated in the West and Florida, so add a region feature. |
| **Wildlife** (rule-based) | GBIF sightings per animal group, weighted by month; temperature boost above about 80°F; distance to wetland; recent crew reports with time decay | none | Be upfront in the demo that this is a heuristic, not a trained model |

## Phase 3: Train (repeat for each hazard)

1. **Baseline first:** a simple "how often this happens at this site in this month" rate. If the model can't beat it, something is wrong.
2. **LightGBM:** train on 2019–2023 with `scale_pos_weight` (for rare events). Use early stopping, holding out 2023 by time, then refit on all of 2019–2023.
3. **Calibrate:** fit isotonic calibration on 2024 so a 0.3 really means a 30% chance.
4. **Test on 2025:** PR-AUC, ROC-AUC, Brier score and a reliability plot. Write these into `metadata.json`; they are the demo numbers.
5. **SHAP:** check the top features make physical sense (heat index should drive heat, not "site ID").
6. **Save:** `models/{hazard}.txt`, `{hazard}_calibrator.pkl`, and the feature list and version.

## Phase 4: Backtest

Pick the event from the **2025 test year**, so it's data the model never saw and the demo is honest. To find candidates, sort the 2025 Storm Events by damage and keep those within 25 miles of one of our sites. Then plot the daily index for the 7 days before and after the event.

## Phase 5: Hand-off

`score.py` loads all models and calibrators and runs the shared `features.py` on Open-Meteo **forecast** data. It returns the agreed risk JSON. The FastAPI endpoint and the Gemini briefing build on top of this.

Draft risk JSON (to confirm with A and C):

```json
{
  "site_id": "EIA-12345",
  "date": "2026-10-17",
  "hazard_index": 7.2,
  "recommendation": "no-go",
  "sub_scores": { "heat": 8.1, "convective": 6.5, "flood": 3.0, "wildfire": 0.4, "wildlife": 2.0 },
  "reasons": [
    { "factor": "heat_index_max", "value": 112, "impact": 2.4, "text": "Heat index peaks at 112°F" },
    { "factor": "soil_moisture_7d", "value": 0.41, "impact": 1.1, "text": "Ground saturated after 7 days of rain" }
  ],
  "model_version": "v1"
}
```

## Order for the hackathon

1. **Start immediately:** steps 1 and 2, with the weather download running in the background. Ship a mock `/score` endpoint in the agreed JSON shape so A and C aren't blocked.
2. **While weather downloads:** Storm Events, the lookup file, FIRMS and OSHA, plus label cleaning.
3. **Heat model end to end** (features → labels → train → SHAP).
4. **Convective, flood, wildfire**, reusing the same pipeline.
5. **Enrichment** (rows 7–10), the backtest, then the hand-off to the endpoint.
