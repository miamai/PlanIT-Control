"""Hourly thunder model for safe work windows.

Label: thunder (TS / VCTS) reported at the site's ASOS station during that UTC hour. Features: the
same hourly weather as the daily models (features.hourly_features). Trained on sites that have both
complete weather and a thunder-reporting station. Train 2019-2023, calibrate 2024, test 2025;
baseline = how often thunder is reported at this site in this month at this hour of day.

Output: models/thunder_hourly.txt, thunder_hourly_calibrator.pkl, thunder_hourly_reliability.png,
        "hourly_thunder" section in models/metadata.json
"""

from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path

import lightgbm as lgb
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.isotonic import IsotonicRegression  # noqa: E402
from sklearn.metrics import average_precision_score, brier_score_loss, f1_score, roc_auc_score  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import CALIB_YEAR, MODELS, RAW, TEST_YEAR, TRAIN_YEARS, YEARS  # noqa: E402
from features import HOURLY_FEATURES, hourly_features  # noqa: E402

PARAMS = {"objective": "binary", "metric": "average_precision", "learning_rate": 0.05, "num_leaves": 63,
          "min_data_in_leaf": 200, "feature_fraction": 0.8, "bagging_fraction": 0.7, "bagging_freq": 1,
          "lambda_l2": 5.0, "verbose": -1, "seed": 7}


def thunder_hours(station: str) -> pd.DatetimeIndex:
    a = pd.read_csv(RAW / "asos" / f"{station}.csv", usecols=["valid", "wxcodes"], dtype=str)
    a = a[a["wxcodes"].fillna("").str.contains("TS")]
    return pd.DatetimeIndex(pd.to_datetime(a["valid"], utc=True).dt.floor("h").unique())


def build() -> pd.DataFrame:
    sites = pd.read_parquet(MODELS / "sites.parquet")  # sites with complete weather
    sites = sites[sites["asos_station"].notna()]
    frames = []
    for s in sites.itertuples():
        files = [RAW / "weather" / f"{s.site_id}_{y}.parquet" for y in YEARS]
        w = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
        f = hourly_features(w, s._asdict())
        f["thunder"] = f["time"].isin(thunder_hours(s.asos_station)).astype(np.int8)
        f["site_id"] = s.site_id
        f["year"] = f["local_date"].dt.year
        f["month"] = f["local_date"].dt.month
        frames.append(f)
    df = pd.concat(frames, ignore_index=True)
    float_cols = [c for c in HOURLY_FEATURES if c != "region"]
    df[float_cols] = df[float_cols].astype(np.float32)
    print(f"{len(df):,} site-hours, {df['site_id'].nunique()} sites, thunder in {df['thunder'].mean():.2%} of hours")
    return df


def main() -> None:
    df = build()
    tr = df[df["year"].isin(TRAIN_YEARS)]
    fit, es = tr[tr["year"] < max(TRAIN_YEARS)], tr[tr["year"] == max(TRAIN_YEARS)]
    cal, te = df[df["year"] == CALIB_YEAR], df[df["year"] == TEST_YEAR]
    spw = float((len(tr) - tr["thunder"].sum()) / tr["thunder"].sum())
    params = {**PARAMS, "scale_pos_weight": spw}
    cats = ["region"]

    d_fit = lgb.Dataset(fit[HOURLY_FEATURES], fit["thunder"], categorical_feature=cats, free_raw_data=False)
    b = lgb.train(params, d_fit, 2000, valid_sets=[lgb.Dataset(es[HOURLY_FEATURES], es["thunder"], reference=d_fit,
                                                               categorical_feature=cats)],
                  callbacks=[lgb.early_stopping(100, verbose=False)])
    best = max(50, b.best_iteration)
    b = lgb.train(params, lgb.Dataset(tr[HOURLY_FEATURES], tr["thunder"], categorical_feature=cats), best)

    iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(b.predict(cal[HOURLY_FEATURES]), cal["thunder"])
    p_cal = iso.predict(b.predict(cal[HOURLY_FEATURES]))
    # Threshold for "avoid this hour": best F1 on the calibration year.
    grid = np.arange(0.05, 0.8, 0.01)
    f1s = [f1_score(cal["thunder"], p_cal >= g) for g in grid]
    threshold = float(round(grid[int(np.argmax(f1s))], 2))

    y = te["thunder"].to_numpy()
    p = iso.predict(b.predict(te[HOURLY_FEATURES]))
    # Baseline: site x month x local-hour thunder rate, 2019-2023.
    rate = tr.groupby(["site_id", "month", "local_hour"])["thunder"].mean()
    base = rate.reindex(pd.MultiIndex.from_frame(te[["site_id", "month", "local_hour"]])).fillna(tr["thunder"].mean()).to_numpy()

    def m(prob):
        return {"pr_auc": round(float(average_precision_score(y, prob)), 4), "roc_auc": round(float(roc_auc_score(y, prob)), 4),
                "brier": round(float(brier_score_loss(y, prob)), 5)}

    flagged = p >= threshold
    metrics = {
        "model": m(p), "baseline_site_month_hour": m(base),
        "at_threshold": {"threshold": threshold, "hit_rate": round(float(flagged[y == 1].mean()), 3),
                         "precision": round(float(y[flagged].mean()), 3) if flagged.any() else None,
                         "hours_flagged": round(float(flagged.mean()), 4)},
    }
    imp = pd.Series(b.feature_importance("gain"), index=HOURLY_FEATURES).sort_values(ascending=False)

    fig, ax = plt.subplots(figsize=(4.5, 4.5))
    ax.plot([0, 1], [0, 1], ls="--", c="grey", lw=1)
    qs = [0, 0.5, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 1.0]
    for probs, name in ((p, "model (calibrated)"), (base, "site×month×hour baseline")):
        edges = np.unique(np.quantile(probs, qs))
        idx = np.clip(np.searchsorted(edges, probs, side="right") - 1, 0, len(edges) - 2)
        g = pd.DataFrame({"p": probs, "y": y, "b": idx}).groupby("b").agg(p=("p", "mean"), y=("y", "mean"))
        ax.plot(g["p"], g["y"], marker="o", label=name)
    ax.set_xlabel("predicted probability"); ax.set_ylabel("observed frequency")
    ax.set_title(f"hourly thunder: reliability on {TEST_YEAR}"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(MODELS / "thunder_hourly_reliability.png", dpi=120); plt.close(fig)

    b.save_model(str(MODELS / "thunder_hourly.txt"))
    with open(MODELS / "thunder_hourly_calibrator.pkl", "wb") as f:
        pickle.dump(iso, f)
    meta_path = MODELS / "metadata.json"
    meta = json.loads(meta_path.read_text())
    meta["hourly_thunder"] = {
        "features": HOURLY_FEATURES, "best_iteration": int(best), "scale_pos_weight": round(spw, 2),
        "sites": int(df["site_id"].nunique()), "rows": {"train": len(tr), "calib": len(cal), "test": len(te)},
        "thunder_hour_rate_test": round(float(y.mean()), 4), "test_2025": metrics,
        "feature_importance_gain": {k: round(float(v), 1) for k, v in imp.head(12).items()},
        "label": "Thunder (TS/VCTS) reported at the site's ASOS station during the UTC hour",
    }
    meta_path.write_text(json.dumps(meta, indent=2))
    print(json.dumps(metrics, indent=1))
    print("top features:", ", ".join(imp.index[:8]))


if __name__ == "__main__":
    main()
