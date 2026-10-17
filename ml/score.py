"""Phase 5: load the hazard models and score a site for a day using the Open-Meteo forecast.

The models decide; nothing downstream (Gemini briefing, UI) may change these numbers.

    uv run python score.py EIA-56407                 # tomorrow, local to the site
    uv run python score.py EIA-56407 --date 2026-10-18
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pickle
from datetime import date as Date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import lightgbm as lgb
import numpy as np
import pandas as pd
import requests

from common import HAZARDS, MODELS, UA
from features import (
    FEATURES, FORECAST_SOIL_VARS, HOURLY_VARS, OPEN_METEO_UNITS, REASON_TEXT, build_features,
    harmonize_forecast,
)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
NWPS = "https://api.water.noaa.gov/nwps/v1/gauges"
COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
PAST_DAYS = 45  # covers 30-day rain, the 14-day API spin-up and streaks

# 0-3 go, 4-6 caution, 7-10 no-go, applied to the index rounded to a whole number.
GO_BELOW = 3.5
CAUTION_BELOW = 6.5

# Features that are context rather than something a crew can act on; never shown as reasons.
HIDDEN_REASONS = {"doy_sin", "doy_cos", "region", "has_gauge", "has_tide"}

# Wildlife heuristic (no trained model: there is no usable incident history).
WILDLIFE_WEIGHT = {"alligator": 1.0, "venomous_snake": 1.0, "bear": 0.8}
WILDLIFE_LABEL = {"alligator": "Alligator", "venomous_snake": "Venomous snake", "bear": "Bear"}
WILDLIFE_BASE_P = 0.08          # max chance contribution of one animal group from sightings alone
WILDLIFE_SATURATE = 20          # sightings in that calendar month (2015-2025) that count as "common"
CREW_REPORT_P = 0.5             # a same-day crew report
CREW_REPORT_DECAY_DAYS = 3.0
REPTILES = {"alligator", "venomous_snake"}


def recommendation(index: float) -> str:
    if index < GO_BELOW:
        return "go"
    if index < CAUTION_BELOW:
        return "caution"
    return "no-go"


def combine(probs: dict[str, float]) -> float:
    """Overall index: 10 x (1 - prod(1 - p_i))."""
    return 10 * (1 - math.prod(1 - p for p in probs.values()))


def apply_alerts(rec: str, alerts: list[dict] | None) -> tuple[str, list[dict]]:
    """A's rule-based alerts always override the model (e.g. lightning stop-work -> no-go)."""
    applied = []
    order = {"go": 0, "caution": 1, "no-go": 2}
    for a in alerts or []:
        action = str(a.get("action") or a.get("level") or "").lower().replace("_", "-")
        if action in ("no-go", "stop-work", "stop"):
            target = "no-go"
        elif action == "caution":
            target = "caution"
        else:
            continue
        if order[target] > order[rec]:
            rec = target
        applied.append({**a, "effect": target})
    return rec, applied


class HazardModels:
    def __init__(self, model_dir: Path = MODELS):
        self.dir = model_dir
        self.meta = json.loads((model_dir / "metadata.json").read_text())
        self.hazards = [h for h in HAZARDS if h in self.meta.get("hazards", {})]
        self.boosters = {h: lgb.Booster(model_file=str(model_dir / f"{h}.txt")) for h in self.hazards}
        self.calibrators = {}
        for h in self.hazards:
            with open(model_dir / f"{h}_calibrator.pkl", "rb") as f:
                self.calibrators[h] = pickle.load(f)
        self.baselines = pd.read_parquet(model_dir / "baselines.parquet")
        self.climatology = pd.read_parquet(model_dir / "climatology.parquet")
        self.sites = pd.read_parquet(model_dir / "sites.parquet").set_index("site_id")
        wl = model_dir / "wildlife_sightings.parquet"
        self.sightings = pd.read_parquet(wl) if wl.exists() else pd.DataFrame(columns=["site_id", "group", "month", "count"])

    @property
    def version(self) -> str:
        return self.meta.get("model_version", "v1")

    def site(self, site_id: str) -> dict:
        if site_id not in self.sites.index:
            raise KeyError(f"Unknown site_id {site_id}")
        return {"site_id": site_id, **self.sites.loc[site_id].to_dict()}

    # -- model scores ---------------------------------------------------------

    def _calibrate(self, hazard: str, raw_margin: np.ndarray) -> np.ndarray:
        return self.calibrators[hazard].predict(1 / (1 + np.exp(-raw_margin)))

    def predict(self, feats: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
        """Calibrated probability per hazard for each row, plus per-feature contributions (log-odds)."""
        probs, contribs = {}, {}
        for h in self.hazards:
            X = feats[FEATURES[h]].astype(float)
            c = self.boosters[h].predict(X, pred_contrib=True)  # last column is the bias
            contribs[h] = c
            probs[h] = self._calibrate(h, c.sum(axis=1))
        return pd.DataFrame(probs, index=feats.index), contribs

    def reasons(self, feats_row: pd.Series, contribs: dict[str, np.ndarray], row: int, top: int = 4) -> list[dict]:
        """Top drivers, as the change in the hazard's 0-10 sub-score each feature is responsible for."""
        out = []
        for h in self.hazards:
            c = contribs[h][row]
            margin = c.sum()
            p = float(self._calibrate(h, np.array([margin]))[0])
            for name, ci in zip(FEATURES[h], c[:-1]):
                if ci <= 0 or name in HIDDEN_REASONS:
                    continue
                p_without = float(self._calibrate(h, np.array([margin - ci]))[0])
                impact = 10 * (p - p_without)
                if impact < 0.1:
                    continue
                value = feats_row.get(name)
                value = None if value is None or pd.isna(value) else float(value)
                text = REASON_TEXT.get(name, name)
                try:
                    text = text.format(v=value) if value is not None else text
                except (ValueError, TypeError):
                    pass
                out.append({"hazard": h, "factor": name, "value": None if value is None else round(value, 2),
                            "impact": round(impact, 2), "text": text})
        out.sort(key=lambda r: r["impact"], reverse=True)
        # One reason per factor, and at most one "this site's history" reason so today's
        # conditions aren't crowded out.
        seen, uniq, climo_shown = set(), [], False
        for r in out:
            is_climo = r["factor"].endswith("_climo")
            if r["factor"] in seen or (is_climo and climo_shown):
                continue
            seen.add(r["factor"])
            climo_shown |= is_climo
            uniq.append(r)
        return uniq[:top]

    # -- wildlife (rule-based) --------------------------------------------------

    def wildlife(self, site: dict, day: Date, t_max_f: float | None,
                 crew_reports: list[dict] | None = None) -> tuple[float, list[dict]]:
        s = self.sightings[(self.sightings["site_id"] == site["site_id"]) & (self.sightings["month"] == day.month)]
        wet = bool(site.get("fema_sfha") == 1.0 or pd.notna(site.get("tide_station")))
        parts, reasons = [], []
        for group, weight in WILDLIFE_WEIGHT.items():
            n = int(s.loc[s["group"] == group, "count"].sum())
            if n == 0:
                continue
            presence = min(1.0, math.log1p(n) / math.log1p(WILDLIFE_SATURATE))
            factor = 1.0
            if group in REPTILES and t_max_f is not None and not math.isnan(t_max_f):
                if t_max_f < 60:
                    factor = 0.2
                elif t_max_f < 80:
                    factor = 0.5 + 0.5 * (t_max_f - 60) / 20
                else:
                    factor = 1 + min(0.5, (t_max_f - 80) / 20)  # reptiles more active above ~80°F
                if wet:
                    factor *= 1.2
            p = WILDLIFE_BASE_P * weight * presence * factor
            parts.append(p)
            reasons.append({"hazard": "wildlife", "factor": f"gbif_{group}", "value": n,
                            "impact": round(10 * p, 2),
                            "text": f"{WILDLIFE_LABEL[group]} sightings recorded nearby in {day:%B} ({n} since 2015)"})
        now = datetime.combine(day, datetime.min.time())
        for r in crew_reports or []:
            try:
                when = datetime.fromisoformat(str(r.get("reported_at")).replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                continue
            age = max(0.0, (now - when).total_seconds() / 86400)
            p = CREW_REPORT_P * math.exp(-age / CREW_REPORT_DECAY_DAYS)
            parts.append(p)
            reasons.append({"hazard": "wildlife", "factor": "crew_report", "value": round(age, 1),
                            "impact": round(10 * p, 2),
                            "text": f"Crew reported {r.get('animal', 'wildlife')} " + (
                                "within the last day" if age < 1 else f"{age:.0f} days ago")})
        p_total = 1 - math.prod(1 - p for p in parts) if parts else 0.0
        reasons.sort(key=lambda r: r["impact"], reverse=True)
        return 10 * p_total, reasons[:2]

    # -- assembling the risk JSON ------------------------------------------------

    def score_frame(self, site: dict, feats: pd.DataFrame) -> pd.DataFrame:
        """Sub-scores and index for every row of a feature frame (used by the backtest)."""
        probs, _ = self.predict(feats)
        out = probs.mul(10)
        out["wildlife"] = [self.wildlife(site, d.date(), t)[0] for d, t in zip(feats.index, feats["t_max"])]
        all_p = out.div(10)
        out["hazard_index"] = [combine(r.to_dict()) for _, r in all_p.iterrows()]
        return out

    def risk_json(self, site: dict, feats: pd.DataFrame, day: Date, alerts: list[dict] | None = None,
                  crew_reports: list[dict] | None = None) -> dict:
        key = pd.Timestamp(day)
        if key not in feats.index:
            raise ValueError(f"No forecast features for {day}")
        probs, contribs = self.predict(feats.loc[[key]])
        row = feats.loc[key]
        sub = {h: float(probs[h].iloc[0]) * 10 for h in self.hazards}
        sub["wildlife"], wl_reasons = self.wildlife(site, day, float(row["t_max"]), crew_reports)
        index = combine({h: v / 10 for h, v in sub.items()})
        rec, applied = apply_alerts(recommendation(round(index, 1)), alerts)
        reasons = self.reasons(row, contribs, 0)
        reasons = sorted(reasons + wl_reasons, key=lambda r: r["impact"], reverse=True)[:5]
        out = {
            "site_id": site["site_id"],
            "date": day.isoformat(),
            "hazard_index": round(index, 1),
            "recommendation": rec,
            "sub_scores": {h: round(v, 1) for h, v in sub.items()},
            "reasons": reasons,
            "model_version": self.version,
        }
        if applied:
            out["overrides"] = applied
        return out


# ---------------------------------------------------------------------------
# Live data
# ---------------------------------------------------------------------------

def fetch_forecast(lat: float, lon: float, forecast_days: int) -> pd.DataFrame:
    hourly = [v for v in HOURLY_VARS if not v.startswith("soil_moisture")] + FORECAST_SOIL_VARS
    r = requests.get(FORECAST_URL, params={
        "latitude": lat, "longitude": lon, "hourly": ",".join(hourly), "timezone": "GMT",
        "past_days": PAST_DAYS, "forecast_days": forecast_days, **OPEN_METEO_UNITS,
    }, timeout=60, headers={"User-Agent": UA})
    r.raise_for_status()
    df = pd.DataFrame(r.json()["hourly"])
    df["time"] = pd.to_datetime(df.pop("time"), utc=True)
    return harmonize_forecast(df)


def fetch_gauge(site: dict, tz: str) -> pd.DataFrame | None:
    """Observed + NWS forecast stage as a daily max, extended to the target day by persistence."""
    lid = site.get("gauge_lid")
    if not lid or pd.isna(lid):
        return None
    try:
        r = requests.get(f"{NWPS}/{lid}/stageflow", timeout=30, headers={"User-Agent": UA})
        r.raise_for_status()
        d = r.json()
    except (requests.RequestException, ValueError):
        return None
    pts = []
    for part in ("observed", "forecast"):
        for p in ((d.get(part) or {}).get("data") or []):
            if p.get("primary") is not None and p["primary"] > -999:
                pts.append((p["validTime"], p["primary"]))
    if not pts:
        return None
    g = pd.DataFrame(pts, columns=["time", "gage_height_ft"])
    g["date"] = pd.to_datetime(g["time"], utc=True).dt.tz_convert(tz).dt.tz_localize(None).dt.normalize()
    return g.groupby("date")[["gage_height_ft"]].max()


def fetch_tide(site: dict, start: Date, end: Date) -> pd.DataFrame | None:
    """Predicted high water relative to MHHW (astronomical tide only; no surge)."""
    station = site.get("tide_station")
    if not station or pd.isna(station):
        return None
    try:
        r = requests.get(COOPS, params={
            "product": "predictions", "interval": "hilo", "station": station, "datum": "MHHW",
            "units": "english", "time_zone": "lst_ldt", "format": "json", "application": "PlanIT",
            "begin_date": start.strftime("%Y%m%d"), "end_date": end.strftime("%Y%m%d"),
        }, timeout=30)
        r.raise_for_status()
        rows = r.json().get("predictions", [])
    except (requests.RequestException, ValueError):
        return None
    if not rows:
        return None
    t = pd.DataFrame(rows)
    t["date"] = pd.to_datetime(t["t"]).dt.normalize()
    t["v"] = pd.to_numeric(t["v"], errors="coerce")
    return t.groupby("date")["v"].max().rename("max_above_mhhw_ft").to_frame()


def tomorrow(tz: str) -> Date:
    return (datetime.now(ZoneInfo(tz)) + timedelta(days=1)).date()


_MODELS: HazardModels | None = None


def get_models() -> HazardModels:
    global _MODELS
    if _MODELS is None:
        _MODELS = HazardModels()
    return _MODELS


def score_site(site_id: str, day: Date | None = None, alerts: list[dict] | None = None,
               crew_reports: list[dict] | None = None) -> dict:
    m = get_models()
    site = m.site(site_id)
    tz = site["timezone"]
    day = day or tomorrow(tz)
    today = datetime.now(ZoneInfo(tz)).date()
    ahead = (day - today).days
    if ahead < -PAST_DAYS + 31 or ahead > 15:
        raise ValueError("date must be within the last ~2 weeks or the next 15 days")
    hourly = fetch_forecast(site["lat"], site["lon"], forecast_days=max(2, ahead + 2))

    gauge = fetch_gauge(site, tz)
    if gauge is not None:
        idx = pd.date_range(gauge.index.min(), pd.Timestamp(day), freq="D")
        gauge = gauge.reindex(idx).ffill()
    tide = fetch_tide(site, today - timedelta(days=PAST_DAYS), day + timedelta(days=1))

    feats = build_features(hourly, site, m.baselines[m.baselines["site_id"] == site_id], gauge, tide,
                           m.climatology[m.climatology["site_id"] == site_id])
    # With only PAST_DAYS of history, "no rain in the window" is a lower bound, not unknown.
    feats["days_since_rain"] = feats["days_since_rain"].fillna(float(PAST_DAYS))
    return m.risk_json(site, feats, day, alerts, crew_reports)


def mock_score(site_id: str, day: Date | None = None) -> dict:
    """Deterministic placeholder in the agreed shape, for front-end work before models exist."""
    day = day or (Date.today() + timedelta(days=1))
    seed = int.from_bytes(hashlib.sha256(f"{site_id}|{day.isoformat()}".encode()).digest()[:4], "big")
    rng = np.random.default_rng(seed)
    sub = {h: round(float(rng.uniform(0, 2.5)), 1) for h in [*HAZARDS, "wildlife"]}
    index = round(combine({h: v / 10 for h, v in sub.items()}), 1)
    return {
        "site_id": site_id, "date": day.isoformat(), "hazard_index": index,
        "recommendation": recommendation(index), "sub_scores": sub,
        "reasons": [{"hazard": "heat", "factor": "hi_max", "value": 104, "impact": 2.1,
                     "text": "Heat index peaks at 104°F"}],
        "model_version": "mock", "mock": True,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("site_id")
    ap.add_argument("--date", type=Date.fromisoformat, default=None)
    args = ap.parse_args()
    print(json.dumps(score_site(args.site_id, args.date), indent=2))


if __name__ == "__main__":
    main()
