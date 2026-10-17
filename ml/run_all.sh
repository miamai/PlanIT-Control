#!/usr/bin/env bash
# Full pipeline, in dependency order. Every step is resumable / skips finished downloads.
# The weather pull (02) takes ~2 h on the free Open-Meteo tier; start it first.
set -euo pipefail
cd "$(dirname "$0")"
run() { echo "== $1"; uv run python -u "pipeline/$1.py" "${@:2}"; }

run 01_sites
run 02_weather          # ~2 h, throttled
run 03_storm_events
run 04_zone_county
run 05_firms
run 06_osha
run 09_fema             # enrichment: adds columns to sites.parquet
run 10_gauges           # USGS rate-limits anonymous use; set API_USGS_PAT to speed up
run 11_tides
run 12_gbif
run 07_build_table
run 08_train
run 13_backtest
