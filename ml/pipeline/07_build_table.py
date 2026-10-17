"""Phase 2: daily features + labels -> train.parquet.

Reads whatever weather is on disk, so it can be run on a partial download for testing.
Enrichment (FEMA columns in sites.parquet, raw/gauges, raw/tides) is used when present.

Outputs:
  data/processed/weather_daily.parquet  daily features for every site-day
  data/processed/labels.parquet         positive site-days per hazard
  data/processed/events_matched.parquet Storm Events matched to sites (for the backtest)
  data/processed/train.parquet          features + 0/1 labels
  models/baselines.parquet              per-site day-of-year normals (2019-2023 only)
  models/sites.parquet                  site table (with enrichment) for the live endpoint
  models/climatology.parquet            site x month hazard rates, 2019-2023 ({hazard}_climo)
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import HAZARDS, MODELS, PROCESSED, RAW, TRAIN_YEARS  # noqa: E402
from features import (  # noqa: E402
    BASELINE_VARS, add_baseline_features, add_gauge_features, add_history_features,
    add_site_features, add_tide_features, climatology_rates, compute_baselines, daily_from_hourly,
)
from labels import build_labels  # noqa: E402


def load_weather(site_id: str) -> pd.DataFrame | None:
    files = sorted((RAW / "weather").glob(f"{site_id}_*.parquet"))
    if not files:
        return None
    return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True).sort_values("time")


def load_optional(kind: str, site_id: str, value_col: str) -> pd.DataFrame | None:
    path = RAW / kind / f"{site_id}.parquet"
    if not path.exists():
        return None
    df = pd.read_parquet(path)
    if df.empty:
        return None
    return df.assign(date=pd.to_datetime(df["date"])).set_index("date")[[value_col]]


def add_climatology(train: pd.DataFrame) -> pd.DataFrame:
    """{hazard}_climo columns, plus the table the live endpoint uses.

    Rates come from 2019-2023 only. Training-year rows get leave-one-year-out rates so a row's
    own label never feeds its feature; 2024/2025 rows get the full 2019-2023 rates.
    """
    month = train["date"].dt.month
    key = pd.MultiIndex.from_arrays([train["site_id"], month])
    tables = []
    for h in HAZARDS:
        learn = train[train["year"].isin(TRAIN_YEARS)]
        if h == "flood":
            learn = learn[learn["flood_ongoing"] == 0]
        overall = learn[h].mean()
        full = climatology_rates(learn, h)
        tables.append(full)
        col = f"{h}_climo"
        train[col] = full[col].reindex(key).fillna(overall).to_numpy()
        for y in TRAIN_YEARS:
            rows = (train["year"] == y).to_numpy()
            loyo = climatology_rates(learn[learn["year"] != y], h)[col]
            train.loc[rows, col] = loyo.reindex(key[rows]).fillna(overall).to_numpy()
    pd.concat(tables, axis=1).reset_index().to_parquet(MODELS / "climatology.parquet", index=False)
    return train


def main() -> None:
    sites = pd.read_parquet(PROCESSED / "sites.parquet")
    sites.to_parquet(MODELS / "sites.parquet", index=False)

    # Pass 1: hourly -> daily with history features.
    daily: dict[str, pd.DataFrame] = {}
    for s in sites.itertuples():
        w = load_weather(s.site_id)
        if w is None:
            print(f"  no weather yet for {s.site_id}; skipping")
            continue
        daily[s.site_id] = add_history_features(daily_from_hourly(w, s.timezone))
    print(f"{len(daily)}/{len(sites)} sites with weather")

    # Baselines from training years only, so 2024/2025 don't leak into "normal".
    base_in = pd.concat(
        [d.loc[d.index.year.isin(TRAIN_YEARS), ["doy", *BASELINE_VARS]].assign(site_id=sid)
         for sid, d in daily.items()],
        ignore_index=True,
    )
    baselines = compute_baselines(base_in)
    baselines.to_parquet(MODELS / "baselines.parquet", index=False)

    # Pass 2: baseline, site and enrichment features.
    frames = []
    site_rows = sites.set_index("site_id")
    for sid, d in daily.items():
        site = site_rows.loc[sid].to_dict()
        d = add_baseline_features(d, baselines[baselines["site_id"] == sid])
        d = add_site_features(d, site)
        d = add_gauge_features(d, load_optional("gauges", sid, "gage_height_ft"), site.get("flood_stage_ft"))
        d = add_tide_features(d, load_optional("tides", sid, "max_above_mhhw_ft"))
        frames.append(d.reset_index().assign(site_id=sid))
    feats = pd.concat(frames, ignore_index=True)
    feats["year"] = feats["date"].dt.year
    feats.to_parquet(PROCESSED / "weather_daily.parquet", index=False)

    labels, matched = build_labels(sites)
    labels.to_parquet(PROCESSED / "labels.parquet", index=False)
    matched.to_parquet(PROCESSED / "events_matched.parquet", index=False)

    label_cols = [*HAZARDS, "flood_ongoing"]
    train = feats.merge(labels[["site_id", "date", *label_cols]], on=["site_id", "date"], how="left")
    train[label_cols] = train[label_cols].fillna(0).astype(int)
    train = add_climatology(train)
    train.to_parquet(PROCESSED / "train.parquet", index=False)

    print(f"train.parquet: {len(train):,} rows, {train['site_id'].nunique()} sites")
    split = pd.cut(train["year"], [2018, 2023, 2024, 2025], labels=["train 2019-23", "calib 2024", "test 2025"])
    counts = train.groupby(split, observed=True)[[*HAZARDS, "flood_ongoing"]].sum()
    counts.loc["total"] = counts.sum()
    print("Positive days per hazard:")
    print(counts.to_string())
    low = [h for h in HAZARDS if counts.loc["total", h] < 200]
    if low:
        print(f"WARNING: fewer than 200 positive days for {low}; widen the radius or merge event types")


if __name__ == "__main__":
    main()
