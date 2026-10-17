"""Daily 0/1 hazard labels per site from Storm Events, FIRMS and OSHA.

Output (via build_labels): one row per (site_id, date) that has any positive, with columns
heat, convective, flood, wildfire, plus the matched Storm Events table for the backtest.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd

from common import MILES_25_KM, RAW, YEARS, haversine_km

EVENT_TYPES = {
    "heat": ["Heat", "Excessive Heat"],
    "convective": ["Lightning", "Thunderstorm Wind", "Hail"],
    "flood": ["Flood", "Flash Flood", "Coastal Flood"],
    "wildfire": ["Wildfire"],
}
MAX_EVENT_DAYS = 31
# Long "Flood" events (river flooding) can run for weeks; local weather only explains their onset.
# Days after the first few are marked flood_ongoing and left out of flood training/evaluation;
# ongoing floods are covered by the gauge features and A's live alerts.
FLOOD_ONSET_DAYS = 3
FIRMS_RADIUS_KM = 25.0
FIRMS_SITE_EXCLUDE_KM = 1.0
FIRMS_STATIC_DAYS = 15     # a ~1 km cell lit on more days than this in a year is a fixed heat source
FIRMS_CELL_DEG = 0.01
# Single hot pixels near a site are mostly small agricultural/prescribed burns that track the
# calendar, not fire weather. Require a few detections that day to count it as a fire day.
FIRMS_MIN_DETECTIONS = 3


# ---------------------------------------------------------------------------
# Storm Events
# ---------------------------------------------------------------------------

def parse_damage(s: pd.Series) -> pd.Series:
    """'10.00K' -> 10000.0, '1.5M' -> 1.5e6, '' -> 0."""
    mult = {"K": 1e3, "M": 1e6, "B": 1e9, "H": 1e2}
    s = s.fillna("").astype(str).str.strip().str.upper()
    num = pd.to_numeric(s.str.rstrip("KMBH"), errors="coerce")
    num = num.where(s.str[:-1] != "", 1.0)  # bare "K" means 1K
    factor = s.str[-1:].map(mult).fillna(1.0)
    return (num * factor).fillna(0.0)


def _tz_offset_hours(tz: pd.Series) -> pd.Series:
    """'CST-6' -> -6, 'EST-5' -> -5, 'GST10' -> 10."""
    m = tz.fillna("").str.extract(r"(-?\d+)$")[0]
    return pd.to_numeric(m, errors="coerce").fillna(-6)


def load_storm_events() -> pd.DataFrame:
    wanted = sum(EVENT_TYPES.values(), [])
    frames = []
    for year in YEARS:
        path = sorted((RAW / "storm_events").glob(f"StormEvents_details-ftp_v1.0_d{year}_c*.csv.gz"))[-1]
        df = pd.read_csv(path, low_memory=False)
        frames.append(df[df["EVENT_TYPE"].isin(wanted)])
    se = pd.concat(frames, ignore_index=True)

    off = pd.to_timedelta(_tz_offset_hours(se["CZ_TIMEZONE"]), unit="h")

    def to_utc(ym, day, hhmm):
        s = (ym.astype(int).astype(str) + day.astype(int).astype(str).str.zfill(2)
             + hhmm.fillna(0).astype(int).astype(str).str.zfill(4))
        local = pd.to_datetime(s, format="%Y%m%d%H%M", errors="coerce")
        return (local - off).dt.tz_localize("UTC")

    se["begin_utc"] = to_utc(se["BEGIN_YEARMONTH"], se["BEGIN_DAY"], se["BEGIN_TIME"])
    se["end_utc"] = to_utc(se["END_YEARMONTH"], se["END_DAY"], se["END_TIME"])
    se["end_utc"] = se["end_utc"].where(se["end_utc"] >= se["begin_utc"], se["begin_utc"])
    se["damage_usd"] = parse_damage(se["DAMAGE_PROPERTY"]) + parse_damage(se["DAMAGE_CROPS"])
    se["hazard"] = se["EVENT_TYPE"].map({t: h for h, ts in EVENT_TYPES.items() for t in ts})
    return se


def load_zone_county() -> pd.DataFrame:
    cols = ["state", "zone", "cwa", "name", "state_zone", "county", "fips", "time_zone", "fe_area", "lat", "lon"]
    z = pd.read_csv(RAW / "zone_county.dbx", sep="|", header=None, names=cols, dtype=str)
    z["state_fips"] = z["fips"].str[:2].astype(int)
    z["zone"] = z["zone"].astype(int)
    z["county_fips"] = z["fips"].str.zfill(5)
    return z[["state_fips", "zone", "county_fips"]].drop_duplicates()


def match_events_to_sites(se: pd.DataFrame, sites: pd.DataFrame) -> pd.DataFrame:
    """Return one row per (event, site) match.

    Events with a lat/lon match sites within 25 miles of the begin or end point; others
    match by county (CZ_TYPE='C') or by forecast zone converted to counties (CZ_TYPE='Z').
    """
    zc = load_zone_county()
    zone_to_counties = zc.groupby(["state_fips", "zone"])["county_fips"].apply(set).to_dict()
    site_by_county: dict[str, list[str]] = sites.groupby("county_fips")["site_id"].apply(list).to_dict()

    s_lat = sites["lat"].to_numpy()
    s_lon = sites["lon"].to_numpy()
    s_ids = sites["site_id"].to_numpy()

    rows = []
    has_pt = se["BEGIN_LAT"].notna() & se["BEGIN_LON"].notna()

    pt = se[has_pt]
    d_begin = haversine_km(pt["BEGIN_LAT"].to_numpy()[:, None], pt["BEGIN_LON"].to_numpy()[:, None], s_lat, s_lon)
    end_lat = pt["END_LAT"].fillna(pt["BEGIN_LAT"]).to_numpy()[:, None]
    end_lon = pt["END_LON"].fillna(pt["BEGIN_LON"]).to_numpy()[:, None]
    d_end = haversine_km(end_lat, end_lon, s_lat, s_lon)
    hit_i, hit_j = np.nonzero(np.minimum(d_begin, d_end) <= MILES_25_KM)
    for i, j in zip(hit_i, hit_j):
        rows.append((pt.index[i], s_ids[j], "radius"))

    for idx, ev in se[~has_pt].iterrows():
        if ev["CZ_TYPE"] == "C":
            counties = {f"{int(ev['STATE_FIPS']):02d}{int(ev['CZ_FIPS']):03d}"}
        else:
            counties = zone_to_counties.get((int(ev["STATE_FIPS"]), int(ev["CZ_FIPS"])), set())
        for c in counties:
            for sid in site_by_county.get(c, []):
                rows.append((idx, sid, "county" if ev["CZ_TYPE"] == "C" else "zone"))

    m = pd.DataFrame(rows, columns=["idx", "site_id", "match"]).drop_duplicates(["idx", "site_id"])
    keep = ["EVENT_ID", "EVENT_TYPE", "hazard", "begin_utc", "end_utc", "damage_usd",
            "STATE", "CZ_NAME", "BEGIN_LAT", "BEGIN_LON", "EPISODE_NARRATIVE", "EVENT_NARRATIVE"]
    return m.join(se[keep], on="idx").drop(columns="idx")


def expand_to_site_days(matches: pd.DataFrame, sites: pd.DataFrame) -> pd.DataFrame:
    """Spread each matched event across every local day it covers at that site."""
    tz = sites.set_index("site_id")["timezone"]
    out = []
    for sid, g in matches.groupby("site_id"):
        b = g["begin_utc"].dt.tz_convert(tz[sid]).dt.tz_localize(None).dt.normalize()
        e = g["end_utc"].dt.tz_convert(tz[sid]).dt.tz_localize(None).dt.normalize()
        e = e.where(e - b <= pd.Timedelta(days=MAX_EVENT_DAYS - 1), b + pd.Timedelta(days=MAX_EVENT_DAYS - 1))
        n = ((e - b).dt.days + 1).to_numpy()
        rep = g.loc[g.index.repeat(n)].copy()
        offsets = np.concatenate([np.arange(k) for k in n])
        rep["date"] = np.repeat(b.to_numpy(), n) + pd.to_timedelta(offsets, unit="D")
        out.append(rep)
    return pd.concat(out, ignore_index=True)


# ---------------------------------------------------------------------------
# FIRMS
# ---------------------------------------------------------------------------

def load_firms() -> pd.DataFrame:
    cache = RAW / "firms" / "veg_fires.parquet"
    if cache.exists():
        return pd.read_parquet(cache)
    frames = []
    for year in YEARS:
        f = pd.read_csv(RAW / "firms" / f"viirs-snpp_{year}_United_States.csv",
                        usecols=["latitude", "longitude", "acq_date", "acq_time", "confidence", "type"],
                        dtype={"acq_time": str})
        f = f[(f["type"] == 0) & f["confidence"].isin(["n", "h"])]
        frames.append(f)
    f = pd.concat(frames, ignore_index=True)
    f["utc"] = pd.to_datetime(f["acq_date"] + f["acq_time"].str.zfill(4), format="%Y-%m-%d%H%M", utc=True)

    # Drop cells that light up on many separate days in a year: flares, kilns, plants.
    f["cell"] = (np.round(f["latitude"] / FIRMS_CELL_DEG).astype(int).astype(str) + "_"
                 + np.round(f["longitude"] / FIRMS_CELL_DEG).astype(int).astype(str))
    f["year"] = f["utc"].dt.year
    days_lit = f.groupby(["cell", "year"])["acq_date"].nunique()
    static = days_lit[days_lit > FIRMS_STATIC_DAYS].index
    f = f.set_index(["cell", "year"]).drop(index=static, errors="ignore").reset_index()
    f = f[["latitude", "longitude", "utc"]]
    f.to_parquet(cache, index=False)
    return f


def firms_site_days(sites: pd.DataFrame) -> pd.DataFrame:
    f = load_firms()
    out = []
    for s in sites.itertuples():
        box = f[(f["latitude"].sub(s.lat).abs() < 0.3) & (f["longitude"].sub(s.lon).abs() < 0.4)]
        d = haversine_km(s.lat, s.lon, box["latitude"].to_numpy(), box["longitude"].to_numpy())
        near = box[(d <= FIRMS_RADIUS_KM) & (d > FIRMS_SITE_EXCLUDE_KM)]
        if near.empty:
            continue
        dates = near["utc"].dt.tz_convert(s.timezone).dt.tz_localize(None).dt.normalize()
        counts = dates.value_counts().rename("firms_count").rename_axis("date").reset_index()
        out.append(counts.assign(site_id=s.site_id))
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame(columns=["date", "firms_count", "site_id"])


# ---------------------------------------------------------------------------
# OSHA
# ---------------------------------------------------------------------------

def osha_heat_site_days(sites: pd.DataFrame) -> pd.DataFrame:
    o = pd.read_csv(RAW / "osha.csv", encoding="latin1", low_memory=False)
    title = o["EventTitle"].fillna("").str.strip().str.lower()
    o = o[title.str.contains("environmental heat") & ~title.str.contains("indoor")]
    o = o.dropna(subset=["Latitude", "Longitude"])
    o["date"] = pd.to_datetime(o["EventDate"], errors="coerce").dt.normalize()
    o = o[o["date"].dt.year.isin(YEARS)]
    d = haversine_km(o["Latitude"].to_numpy()[:, None], o["Longitude"].to_numpy()[:, None],
                     sites["lat"].to_numpy(), sites["lon"].to_numpy())
    i, j = np.nonzero(d <= MILES_25_KM)
    hits = pd.DataFrame({"date": o["date"].to_numpy()[i], "site_id": sites["site_id"].to_numpy()[j]})
    return hits.value_counts().rename("osha_heat_count").reset_index()


# ---------------------------------------------------------------------------
# Assemble
# ---------------------------------------------------------------------------

def build_labels(sites: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    se = load_storm_events()
    matches = match_events_to_sites(se, sites)
    days = expand_to_site_days(matches, sites)
    first = days.groupby(["EVENT_ID", "site_id"])["date"].transform("min")
    days["day_n"] = (days["date"] - first).dt.days
    ongoing = (days["EVENT_TYPE"] == "Flood") & (days["day_n"] >= FLOOD_ONSET_DAYS)
    days["label"] = np.where(ongoing, "flood_ongoing", days["hazard"])

    lab = (days.assign(v=1).pivot_table(index=["site_id", "date"], columns="label", values="v",
                                        aggfunc="max", fill_value=0))
    lab.columns = [f"se_{c}" for c in lab.columns]
    lab = lab.reset_index()

    firms = firms_site_days(sites)
    osha = osha_heat_site_days(sites)
    lab = lab.merge(firms, on=["site_id", "date"], how="outer").merge(osha, on=["site_id", "date"], how="outer")
    lab = lab.fillna(0)

    for h in [*EVENT_TYPES, "flood_ongoing"]:
        if f"se_{h}" not in lab:
            lab[f"se_{h}"] = 0
    lab["heat"] = ((lab["se_heat"] > 0) | (lab["osha_heat_count"] > 0)).astype(int)
    lab["convective"] = (lab["se_convective"] > 0).astype(int)
    lab["flood"] = (lab["se_flood"] > 0).astype(int)
    lab["flood_ongoing"] = ((lab["se_flood_ongoing"] > 0) & (lab["flood"] == 0)).astype(int)
    lab["wildfire"] = ((lab["se_wildfire"] > 0) | (lab["firms_count"] >= FIRMS_MIN_DETECTIONS)).astype(int)
    lab["date"] = pd.to_datetime(lab["date"])
    return lab, days
