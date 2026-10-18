"""Model card: how good the hazard index is, graded the way forecasters grade forecasts.

1. Test-year scores with 95% confidence intervals (site-level bootstrap: whole sites are resampled,
   because days at one site are not independent).
2. Operational verification on 2025: treating "caution or no-go" as a warning, how many hazard days
   were warned (probability of detection), how many warnings were false alarms (false alarm ratio),
   and the critical success index, overall and per hazard. Also: share of the damaging Storm Events
   near a site that got caution or no-go that day.
3. Unseen locations: 5-fold cross-validation that holds out whole sites. Held-out sites get their
   region's average site history instead of their own, so this measures a brand-new job site.

Usage:  uv run python pipeline/18_model_card.py
Output: models/model_card.json, models/MODEL_CARD.md
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import HAZARDS, MODELS, PROCESSED, TEST_YEAR, TRAIN_YEARS  # noqa: E402
from features import CATEGORICAL, FEATURES  # noqa: E402
from score import HazardModels, recommendation  # noqa: E402

N_BOOT = 300
RNG = np.random.default_rng(0)


def eval_rows(df: pd.DataFrame, hazard: str) -> pd.DataFrame:
    if hazard == "flood":
        df = df[df["flood_ongoing"] == 0]
    if hazard == "convective":
        df = df[df["has_thunder_obs"] == 1]
    return df


def bootstrap_ci(df: pd.DataFrame, y: str, p: str, metric) -> tuple[float, float, float]:
    sites = df["site_id"].unique()
    groups = {s: g for s, g in df.groupby("site_id")}
    vals = []
    for _ in range(N_BOOT):
        pick = RNG.choice(sites, size=len(sites), replace=True)
        b = pd.concat([groups[s] for s in pick])
        if b[y].nunique() == 2:
            vals.append(metric(b[y], b[p]))
    return float(metric(df[y], df[p])), float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))


def verification(flag: np.ndarray, event: np.ndarray) -> dict:
    hits = int((flag & event).sum())
    misses = int((~flag & event).sum())
    false_alarms = int((flag & ~event).sum())
    return {
        "pod": round(hits / max(hits + misses, 1), 3),
        "far": round(false_alarms / max(hits + false_alarms, 1), 3),
        "csi": round(hits / max(hits + misses + false_alarms, 1), 3),
        "warned_share_of_days": round(float(flag.mean()), 3),
    }


def unseen_sites_cv(df: pd.DataFrame, hazard: str, sites: pd.DataFrame) -> dict:
    feats = FEATURES[hazard]
    cats = [c for c in CATEGORICAL if c in feats]
    climo = f"{hazard}_climo"
    df = eval_rows(df, hazard).copy()
    df["region_name"] = df["site_id"].map(sites.set_index("site_id")["region"])
    df["month"] = df["date"].dt.month
    preds = pd.Series(np.nan, index=df.index)
    for train_idx, test_idx in GroupKFold(n_splits=5).split(df, groups=df["site_id"]):
        tr, te = df.iloc[train_idx], df.iloc[test_idx].copy()
        tr = tr[tr["year"].isin(TRAIN_YEARS)]
        te = te[te["year"] == TEST_YEAR]
        if climo in feats:
            # A new site has no history of its own: use its region's average for that month.
            reg = tr.groupby(["region_name", "month"])[climo].mean()
            te[climo] = reg.reindex(pd.MultiIndex.from_frame(te[["region_name", "month"]])).fillna(tr[climo].mean()).to_numpy()
        spw = (len(tr) - tr[hazard].sum()) / max(tr[hazard].sum(), 1)
        params = {"objective": "binary", "learning_rate": 0.03, "num_leaves": 15, "min_data_in_leaf": 80,
                  "feature_fraction": 0.8, "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 5.0,
                  "verbose": -1, "seed": 7, "scale_pos_weight": spw}
        b = lgb.train(params, lgb.Dataset(tr[feats], tr[hazard], categorical_feature=cats), 300)
        preds.loc[te.index] = b.predict(te[feats])
    te_all = df.loc[preds.dropna().index]
    y, p = te_all[hazard], preds.dropna()
    return {"pr_auc": round(float(average_precision_score(y, p)), 3), "roc_auc": round(float(roc_auc_score(y, p)), 3),
            "baseline_rate": round(float(y.mean()), 4)}


def main() -> None:
    m = HazardModels()
    meta = m.meta
    t = pd.read_parquet(PROCESSED / "train.parquet")
    sites = pd.read_parquet(MODELS / "sites.parquet")
    te = t[t["year"] == TEST_YEAR].copy()

    # Model probabilities and the full index for every 2025 site-day.
    parts = []
    for sid, g in te.groupby("site_id"):
        sc = m.score_frame(m.site(sid), g.set_index("date"))
        parts.append(sc.reset_index().assign(site_id=sid))
    sc = pd.concat(parts, ignore_index=True)
    te = te.merge(sc.rename(columns={h: f"s_{h}" for h in [*HAZARDS, "wildlife"]}), on=["site_id", "date"])
    te["rec"] = [recommendation(round(x, 1)) for x in te["hazard_index"]]

    card = {"model_version": meta.get("model_version"), "trained_at": meta.get("trained_at"),
            "n_sites": int(t["site_id"].nunique()), "test_year": TEST_YEAR, "hazards": {}}

    for h in HAZARDS:
        d = eval_rows(te, h).assign(p=lambda x: x[f"s_{h}"] / 10)
        pr = bootstrap_ci(d, h, "p", average_precision_score)
        pr_b = bootstrap_ci(d, h, f"{h}_climo", average_precision_score)
        roc = bootstrap_ci(d, h, "p", roc_auc_score)
        flag = (d[f"s_{h}"] >= 3.5).to_numpy()
        card["hazards"][h] = {
            "label": meta["hazards"][h].get("label"),
            "test_positive_days": int(d[h].sum()), "test_days": len(d),
            "pr_auc": {"model": [round(x, 3) for x in pr], "baseline": [round(x, 3) for x in pr_b]},
            "roc_auc": [round(x, 3) for x in roc],
            "brier": {"model": round(float(brier_score_loss(d[h], d["p"])), 4),
                      "baseline": round(float(brier_score_loss(d[h], d[f"{h}_climo"])), 4)},
            "sub_score_3.5_plus_as_warning": verification(flag, d[h].astype(bool).to_numpy()),
            "top_drivers": list(meta["hazards"][h]["shap_mean_abs"])[:5],
            "unseen_sites_cv": unseen_sites_cv(t, h, sites),
        }
        print(h, card["hazards"][h]["pr_auc"], card["hazards"][h]["unseen_sites_cv"], flush=True)

    # Any hazard vs the overall go / caution / no-go call.
    any_h = te[HAZARDS].max(axis=1).astype(bool).to_numpy()
    card["overall"] = {
        "caution_or_no_go_as_warning": verification(te["rec"].isin(["caution", "no-go"]).to_numpy(), any_h),
        "no_go_as_warning": verification((te["rec"] == "no-go").to_numpy(), any_h),
        "recommendation_mix": te["rec"].value_counts(normalize=True).round(3).to_dict(),
    }
    ev = pd.read_parquet(PROCESSED / "events_matched.parquet")
    ev = ev[(ev["date"].dt.year == TEST_YEAR) & (ev["damage_usd"] > 0)]
    ev = ev.merge(te[["site_id", "date", "rec", "hazard_index"]], on=["site_id", "date"], how="inner")
    big = ev.drop_duplicates(["EVENT_ID", "site_id"])
    card["damaging_events"] = {
        "n_event_site_days": len(big),
        "share_caution_or_no_go": round(float(big["rec"].isin(["caution", "no-go"]).mean()), 3),
        "share_no_go": round(float((big["rec"] == "no-go").mean()), 3),
        "by_hazard": big.groupby("hazard")["rec"].apply(lambda r: round(float(r.isin(["caution", "no-go"]).mean()), 3)).to_dict(),
    }
    if "hourly_thunder" in meta:
        card["hourly_thunder"] = meta["hourly_thunder"]["test_2025"]
    bake = MODELS / "briefing_bakeoff.json"
    if bake.exists():
        card["briefing_bakeoff"] = [{k: v for k, v in r.items() if k != "rows"} for r in json.loads(bake.read_text())]

    (MODELS / "model_card.json").write_text(json.dumps(card, indent=2, default=str))

    L = [f"# Precognition hazard index: model card ({card['model_version']})", "",
         f"Trained {card['trained_at']} on {card['n_sites']} power-plant sites, 2019-2023; calibrated on 2024; "
         f"tested on {TEST_YEAR}, a year the models never saw.", "",
         "## Test-year skill (95% CI, whole sites resampled)", "",
         "| Hazard | PR-AUC model | PR-AUC baseline | ROC-AUC | Brier model / baseline | New sites (held out): PR-AUC / ROC-AUC |",
         "|---|---|---|---|---|---|"]
    for h, c in card["hazards"].items():
        pm, pb, r = c["pr_auc"]["model"], c["pr_auc"]["baseline"], c["roc_auc"]
        u = c["unseen_sites_cv"]
        L.append(f"| {h} | {pm[0]:.2f} ({pm[1]:.2f}-{pm[2]:.2f}) | {pb[0]:.2f} ({pb[1]:.2f}-{pb[2]:.2f}) | "
                 f"{r[0]:.2f} ({r[1]:.2f}-{r[2]:.2f}) | {c['brier']['model']:.4f} / {c['brier']['baseline']:.4f} | "
                 f"{u['pr_auc']:.2f} / {u['roc_auc']:.2f} |")
    o = card["overall"]
    L += ["", "## Graded like a forecast (2025)", "",
          "A warning = the index said caution or no-go. POD = share of hazard days warned; FAR = share of "
          "warnings with no recorded hazard; CSI = hits / (hits + misses + false alarms).", "",
          "| Warning | POD | FAR | CSI | Days warned |", "|---|---|---|---|---|"]
    for name, v in [("caution or no-go", o["caution_or_no_go_as_warning"]), ("no-go only", o["no_go_as_warning"])]:
        L.append(f"| {name} | {v['pod']:.2f} | {v['far']:.2f} | {v['csi']:.2f} | {v['warned_share_of_days']:.0%} |")
    for h, c in card["hazards"].items():
        v = c["sub_score_3.5_plus_as_warning"]
        L.append(f"| {h} sub-score 3.5+ | {v['pod']:.2f} | {v['far']:.2f} | {v['csi']:.2f} | {v['warned_share_of_days']:.0%} |")
    e = card["damaging_events"]
    L += ["", f"Damaging Storm Events within 25 miles of a site in {TEST_YEAR}: {e['n_event_site_days']} event-site days; "
          f"{e['share_caution_or_no_go']:.0%} got caution or no-go that day ({e['share_no_go']:.0%} no-go). "
          "By hazard: " + ", ".join(f"{k} {v:.0%}" for k, v in e["by_hazard"].items()) + ".",
          "", "Scores use reanalysis weather for each day (a perfect-forecast test); live forecasts add their own error."]
    if "hourly_thunder" in card:
        ht = card["hourly_thunder"]
        L += ["", "## Hourly thunder (work windows)", "",
              f"PR-AUC {ht['model']['pr_auc']:.2f} vs {ht['baseline_site_month_hour']['pr_auc']:.2f} baseline; ROC-AUC "
              f"{ht['model']['roc_auc']:.2f}. At the 'avoid' threshold ({ht['at_threshold']['threshold']}): "
              f"{ht['at_threshold']['hit_rate']:.0%} of thunder hours flagged, {ht['at_threshold']['precision']:.0%} of flagged hours had thunder."]
    if "briefing_bakeoff" in card:
        L += ["", "## Briefing writer", ""]
        for r in card["briefing_bakeoff"]:
            if "error" in r:
                continue
            L.append(f"- {r['model'].split('/')[-1]}: {r['pass_first_try']:.0%} of drafts pass the checker first try, "
                     f"{r['pass_after_retry']:.0%} after one retry; {r['seconds_per_briefing_median']}s per briefing; "
                     f"{r['peak_gpu_memory_gb']} GB.")
    L += ["", "## Limitations", "",
          "- Labels are days something was recorded (report, injury, warning, thunder at a station), not every hazardous day.",
          "- Weather is reanalysis in training and a forecast live; the archive has no storm-energy (CAPE) data.",
          "- Wildlife is a heuristic from sightings and crew reports, not a trained model.",
          "- Sites cover the continental US regions picked for hazards; Alaska, Hawaii and the Northeast are not covered."]
    (MODELS / "MODEL_CARD.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))


if __name__ == "__main__":
    main()
