"""Phase 3: train one LightGBM model per hazard.

For each hazard:
  1. Baseline: site x month positive rate from 2019-2023.
  2. LightGBM with scale_pos_weight; early stopping with 2023 held out, then refit on 2019-2023.
  3. Isotonic calibration on 2024.
  4. Test on 2025: PR-AUC, ROC-AUC, Brier, reliability plot.
  5. SHAP: mean |SHAP| on 2025 to check the drivers make physical sense.
  6. Save models/{hazard}.txt, {hazard}_calibrator.pkl and metadata.json.

Usage: uv run python pipeline/08_train.py [heat convective ...]
"""

from __future__ import annotations

import json
import pickle
import sys
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import shap  # noqa: E402
from sklearn.isotonic import IsotonicRegression  # noqa: E402
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import CALIB_YEAR, HAZARDS, MODELS, PROCESSED, TEST_YEAR, TRAIN_YEARS  # noqa: E402
from features import CATEGORICAL, FEATURES  # noqa: E402

MODEL_VERSION = "v1"
LABEL_NOTES = {
    "heat": "Storm Events Heat/Excessive Heat (zone -> county), OSHA outdoor heat injury within 25 mi, "
            "or NWS Heat Advisory / Excessive or Extreme Heat Warning at the site",
    "convective": "Storm Events Thunderstorm Wind/Hail/Lightning within 25 mi, NWS Severe Thunderstorm or "
                  "Tornado Warning at the site, or 3+ hours of thunder at the nearest ASOS station (40 km); "
                  "trained and evaluated on sites that have a station",
    "flood": "Storm Events Flash Flood/Coastal Flood or first 3 days of a Flood event within 25 mi, or NWS "
             "Flash Flood/Flood/Coastal Flood Warning at the site (first 3 days); later days of long floods excluded",
    "wildfire": "Storm Events Wildfire, >= 3 FIRMS VIIRS vegetation-fire detections within 25 km "
                "(static hot spots and detections within 1 km of the site removed), or NWS Red Flag Warning",
}
PARAMS = {
    "objective": "binary",
    "metric": "average_precision",
    "learning_rate": 0.03,
    "num_leaves": 15,
    "min_data_in_leaf": 80,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 5.0,
    "verbose": -1,
    "seed": 7,
}


def metrics(y: np.ndarray, p: np.ndarray) -> dict:
    if y.sum() == 0 or y.sum() == len(y):
        return {"pr_auc": None, "roc_auc": None, "brier": float(brier_score_loss(y, p))}
    return {
        "pr_auc": round(float(average_precision_score(y, p)), 4),
        "roc_auc": round(float(roc_auc_score(y, p)), 4),
        "brier": round(float(brier_score_loss(y, p)), 5),
    }


def reliability_plot(y: np.ndarray, p: np.ndarray, base: np.ndarray, hazard: str, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(4.5, 4.5))
    ax.plot([0, 1], [0, 1], ls="--", c="grey", lw=1, label="perfect")
    # Rare events: equal-count bins put nearly everything near 0, so bin finer in the upper tail.
    qs = [0, 0.5, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 1.0]
    for probs, name in ((p, "model (calibrated)"), (base, "site×month baseline")):
        edges = np.unique(np.quantile(probs, qs))
        idx = np.clip(np.searchsorted(edges, probs, side="right") - 1, 0, len(edges) - 2)
        b = pd.DataFrame({"p": probs, "y": y, "bin": idx}).groupby("bin").agg(p=("p", "mean"), y=("y", "mean"), n=("y", "size"))
        b = b[b["n"] >= 30]
        ax.plot(b["p"], b["y"], marker="o", label=name)
    hi = float(max(0.05, np.quantile(np.r_[p, base], 0.999) * 1.1))
    ax.set_xlim(0, min(1, hi))
    ax.set_ylim(0, min(1, hi * 1.3))
    ax.set_xlabel("predicted probability")
    ax.set_ylabel("observed frequency")
    ax.set_title(f"{hazard}: reliability on {TEST_YEAR}")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def train_hazard(df: pd.DataFrame, hazard: str) -> dict:
    feats = FEATURES[hazard]
    cats = [c for c in CATEGORICAL if c in feats]
    if hazard == "flood":
        # Later days of multi-week river floods: not predictable from local weather, so neither
        # positive nor negative. Gauges and live alerts cover them.
        df = df[df["flood_ongoing"] == 0]
    if hazard == "convective":
        # The label includes ASOS thunder; train and evaluate only where a station reports it.
        df = df[df["has_thunder_obs"] == 1]
    tr = df[df["year"].isin(TRAIN_YEARS)]
    fit, es = tr[tr["year"] < max(TRAIN_YEARS)], tr[tr["year"] == max(TRAIN_YEARS)]
    cal = df[df["year"] == CALIB_YEAR]
    te = df[df["year"] == TEST_YEAR]

    def ds(part, ref=None):
        return lgb.Dataset(part[feats], part[hazard], categorical_feature=cats, reference=ref, free_raw_data=False)

    pos = tr[hazard].sum()
    spw = float((len(tr) - pos) / max(pos, 1))
    params = {**PARAMS, "scale_pos_weight": spw}

    # Early stopping on the held-out year, then refit on all training years.
    d_fit = ds(fit)
    booster = lgb.train(params, d_fit, num_boost_round=3000, valid_sets=[ds(es, d_fit)],
                        callbacks=[lgb.early_stopping(150, verbose=False)])
    best_iter = max(50, booster.best_iteration)
    booster = lgb.train(params, ds(tr), num_boost_round=best_iter)

    # Isotonic calibration on 2024 so 0.3 means ~30%.
    raw_cal = booster.predict(cal[feats])
    calibrator = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip").fit(raw_cal, cal[hazard])

    y = te[hazard].to_numpy()
    p_raw = booster.predict(te[feats])
    p = calibrator.predict(p_raw)
    # Baseline: how often this happens at this site in this month, 2019-2023 (same as {hazard}_climo).
    base = te[f"{hazard}_climo"].to_numpy()

    m_model = metrics(y, p)
    m_raw = metrics(y, p_raw)
    m_base = metrics(y, base)
    reliability_plot(y, p, base, hazard, MODELS / f"{hazard}_reliability.png")

    # SHAP on the test year (subsample for speed).
    sample = te[feats].sample(min(len(te), 8000), random_state=0)
    sv = shap.TreeExplainer(booster).shap_values(sample)
    sv = sv[1] if isinstance(sv, list) else sv
    shap_rank = (pd.Series(np.abs(sv).mean(axis=0), index=feats).sort_values(ascending=False))

    booster.save_model(str(MODELS / f"{hazard}.txt"))
    with open(MODELS / f"{hazard}_calibrator.pkl", "wb") as f:
        pickle.dump(calibrator, f)

    beats = (m_model["pr_auc"] or 0) > (m_base["pr_auc"] or 0)
    print(f"\n== {hazard}: {int(pos)} train positives, best_iter={best_iter}, scale_pos_weight={spw:.1f}")
    print(f"   2025 model    {m_model}")
    print(f"   2025 baseline {m_base}" + ("" if beats else "   <-- model does NOT beat baseline"))
    print("   top SHAP: " + ", ".join(f"{k} {v:.3f}" for k, v in shap_rank.head(6).items()))

    return {
        "features": feats,
        "categorical": cats,
        "best_iteration": int(best_iter),
        "scale_pos_weight": round(spw, 2),
        "positives": {
            "train_2019_2023": int(pos),
            "calib_2024": int(cal[hazard].sum()),
            "test_2025": int(y.sum()),
        },
        "rows": {"train": len(tr), "calib": len(cal), "test": len(te)},
        "label": LABEL_NOTES[hazard],
        "base_rate_test": round(float(y.mean()), 5),
        "test_2025": {"model_calibrated": m_model, "model_uncalibrated": m_raw, "baseline_site_month": m_base},
        "beats_baseline": bool(beats),
        "shap_mean_abs": {k: round(float(v), 4) for k, v in shap_rank.items()},
        "reliability_plot": f"{hazard}_reliability.png",
    }


def main() -> None:
    hazards = sys.argv[1:] or HAZARDS
    df = pd.read_parquet(PROCESSED / "train.parquet")
    meta_path = MODELS / "metadata.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta.update({
        "model_version": MODEL_VERSION,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "splits": {"train": TRAIN_YEARS, "calibrate": CALIB_YEAR, "test": TEST_YEAR},
        "n_sites": int(df["site_id"].nunique()),
        "lightgbm_params": PARAMS,
    })
    meta.setdefault("hazards", {})
    for h in hazards:
        meta["hazards"][h] = train_hazard(df, h)
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"\nwrote {meta_path}")


if __name__ == "__main__":
    main()
