"""Phase 4: backtest on a 2025 event the models never saw.

Candidates: 2025 Storm Events within 25 miles of a site (lat/lon match), sorted by damage.
For the chosen event, plot the daily index and sub-scores for 7 days either side.

Weather here is the reanalysis for those days, i.e. a "perfect forecast" backtest: it shows
whether the models react to the right conditions, not forecast skill.

Usage: uv run python pipeline/13_backtest.py [--event-id N] [--hazard flood]
Output: models/backtest_{event_id}.png / .json, printed candidate list
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import HAZARDS, MODELS, PROCESSED, TEST_YEAR  # noqa: E402
from score import HazardModels  # noqa: E402

WINDOW_DAYS = 7


def candidates(hazard: str | None) -> pd.DataFrame:
    ev = pd.read_parquet(PROCESSED / "events_matched.parquet")
    ev = ev[(ev["date"].dt.year == TEST_YEAR) & (ev["match"] == "radius")]
    if hazard:
        ev = ev[ev["hazard"] == hazard]
    g = (ev.groupby(["EVENT_ID", "site_id"])
           .agg(hazard=("hazard", "first"), event_type=("EVENT_TYPE", "first"), start=("date", "min"),
                end=("date", "max"), damage_usd=("damage_usd", "first"), state=("STATE", "first"),
                place=("CZ_NAME", "first"), narrative=("EVENT_NARRATIVE", "first"))
           .reset_index())
    return g.sort_values("damage_usd", ascending=False)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--event-id", type=int, default=None)
    ap.add_argument("--hazard", choices=HAZARDS, default=None)
    args = ap.parse_args()

    cand = candidates(args.hazard)
    print("Top 2025 events within 25 miles of a site, by damage:")
    print(cand.head(12)[["EVENT_ID", "site_id", "hazard", "event_type", "start", "damage_usd", "state", "place"]]
          .to_string(index=False))
    if cand.empty:
        raise SystemExit("no candidates")
    pick = cand[cand["EVENT_ID"] == args.event_id].iloc[0] if args.event_id else cand.iloc[0]

    m = HazardModels()
    site = m.site(pick["site_id"])
    feats = pd.read_parquet(PROCESSED / "train.parquet")
    feats = feats[feats["site_id"] == site["site_id"]].set_index("date").sort_index()
    lo = pick["start"] - pd.Timedelta(days=WINDOW_DAYS)
    hi = pick["end"] + pd.Timedelta(days=WINDOW_DAYS)
    window = feats.loc[lo:hi]
    scores = m.score_frame(site, window)

    labels = feats.loc[lo:hi, HAZARDS]

    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.axvspan(pick["start"] - pd.Timedelta(hours=12), pick["end"] + pd.Timedelta(hours=12),
               color="#f4c7c3", alpha=0.6, label=f"{pick['event_type']} (event)")
    ax.plot(scores.index, scores["hazard_index"], color="black", lw=2.5, marker="o", label="hazard index")
    for h in [*HAZARDS, "wildlife"]:
        ax.plot(scores.index, scores[h], lw=1.2, alpha=0.8, label=h)
    ax.axhspan(0, 3.5, color="#e6f4ea", alpha=0.5, zorder=0)
    ax.axhspan(3.5, 6.5, color="#fef7e0", alpha=0.5, zorder=0)
    ax.axhspan(6.5, 10, color="#fce8e6", alpha=0.5, zorder=0)
    ax.set_ylim(0, 10)
    ax.set_ylabel("score (0-10)")
    ax.set_title(f"Backtest: {site['name']} ({site['state']}), {pick['event_type']} "
                 f"{pick['start']:%b %d %Y}, ${pick['damage_usd']:,.0f} damage")
    ax.legend(fontsize=7, ncol=4, loc="upper left")
    fig.autofmt_xdate()
    fig.tight_layout()
    stem = MODELS / f"backtest_{int(pick['EVENT_ID'])}"
    fig.savefig(stem.with_suffix(".png"), dpi=130)

    out = {
        "event": {k: (v.isoformat() if hasattr(v, "isoformat") else (None if pd.isna(v) else v))
                  for k, v in pick.drop(labels=["narrative"]).to_dict().items()},
        "narrative": pick["narrative"],
        "site": {"site_id": site["site_id"], "name": site["name"], "state": site["state"]},
        "note": "Scores use reanalysis weather for each day (perfect-forecast backtest).",
        "days": [
            {"date": d.date().isoformat(), "hazard_index": round(float(r["hazard_index"]), 1),
             "sub_scores": {h: round(float(r[h]), 1) for h in [*HAZARDS, "wildlife"]},
             "labels": {h: int(labels.loc[d, h]) for h in HAZARDS} if d in labels.index else None}
            for d, r in scores.iterrows()
        ],
    }
    stem.with_suffix(".json").write_text(json.dumps(out, indent=2, default=str))
    print(f"\nPicked event {pick['EVENT_ID']} at {site['name']}:")
    print(scores.round(1).to_string())
    print(f"\nwrote {stem}.png and .json")


if __name__ == "__main__":
    main()
