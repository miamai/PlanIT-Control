"""Pick the local briefing model on our own task, not a leaderboard.

Each candidate writes briefings for the same 2025 site-days (an even mix of go / caution / no-go,
the two backtest storm days, some with a live lightning alert or a crew wildlife report). The
checker in briefing.py grades every draft; we record first-try and after-retry pass rates,
seconds per briefing, generation speed and peak GPU memory.

Usage:  uv run python pipeline/16_briefing_bakeoff.py [--n 60]
Output: models/briefing_bakeoff.json (all drafts and checks), models/briefing_bakeoff.md (summary)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import briefing as B  # noqa: E402
from common import MODELS, PROCESSED  # noqa: E402
from common import RAW  # noqa: E402
from score import HazardModels, recommendation, work_plan  # noqa: E402

CANDIDATES = [
    "mlx-community/Qwen3-4B-Instruct-2507-4bit",
    "mlx-community/Qwen3.5-4B-MLX-4bit",
]
BACKTEST_DAYS = [("EIA-50118", "2025-07-05"), ("EIA-3559", "2025-03-27")]


def build_cases(m: HazardModels, n: int, seed: int = 0) -> list[dict]:
    t = pd.read_parquet(PROCESSED / "train.parquet")
    t = t[t["year"] == 2025]
    scored = []
    for sid, g in t.groupby("site_id"):
        sc = m.score_frame(m.site(sid), g.set_index("date"))
        scored.append(pd.DataFrame({"site_id": sid, "date": sc.index, "index": sc["hazard_index"].to_numpy()}))
    scored = pd.concat(scored, ignore_index=True)
    scored["rec"] = [recommendation(round(x, 1)) for x in scored["index"]]
    rng = np.random.default_rng(seed)
    picks = []
    for rec in ["go", "caution", "no-go"]:
        pool = scored[scored["rec"] == rec]
        pool = pool.groupby("site_id").sample(n=1, random_state=seed)  # spread across sites
        picks += pool.sample(n=min(n // 3, len(pool)), random_state=seed)[["site_id", "date"]].values.tolist()
    picks += [(s, pd.Timestamp(d)) for s, d in BACKTEST_DAYS]

    cases = []
    for i, (sid, day) in enumerate(picks):
        alerts, crew = None, None
        if i % 7 == 3:
            alerts = [{"type": "lightning", "action": "no-go", "message": "Strike within 10 mi"}]
        if i % 6 == 1:
            crew = [{"animal": rng.choice(["alligator", "snake"]),
                     "reported_at": (day - pd.Timedelta(hours=16)).isoformat()}]
        site = m.site(sid)
        feats = t[t["site_id"] == sid].set_index("date")
        risk = m.risk_json(site, feats, day.date(), alerts, crew)
        hourly = pd.read_parquet(RAW / "weather" / f"{sid}_{day.year}.parquet")
        plan = work_plan(m, site, hourly, day.date())  # same hourly plan the live endpoint adds
        if plan:
            risk["work_plan"] = plan
        cases.append({"site": site, "risk": risk, "crew": crew})
    return cases


def peak_memory_gb() -> float:
    import mlx.core as mx
    f = getattr(mx, "get_peak_memory", None) or mx.metal.get_peak_memory
    return f() / 1e9


def reset_peak() -> None:
    import mlx.core as mx
    f = getattr(mx, "reset_peak_memory", None) or mx.metal.reset_peak_memory
    f()


def run_model(repo: str, cases: list[dict]) -> dict:
    t0 = time.time()
    reset_peak()
    llm = B.LocalLLM(repo)
    load_s = time.time() - t0
    rows = []
    for c in cases:
        f = B.build_facts(c["risk"], c["site"], c["crew"])
        t1 = time.time()
        first = llm(B.SYSTEM_PROMPT, B._user_prompt(f))
        first_s = time.time() - t1
        first_problems = B.check_briefing(first, f)
        final, final_problems, retry_s = first, first_problems, 0.0
        if first_problems:
            t2 = time.time()
            final = llm(B.SYSTEM_PROMPT, B._user_prompt(f, first_problems))
            retry_s = time.time() - t2
            final_problems = B.check_briefing(final, f)
        rows.append({
            "site_id": c["risk"]["site_id"], "date": c["risk"]["date"], "decision": f.decision,
            "has_alert": bool(c["risk"].get("overrides")), "has_crew_report": bool(c["crew"]),
            "first_draft": first, "first_problems": first_problems,
            "final_draft": final, "final_problems": final_problems,
            "seconds_first": round(first_s, 2), "seconds_retry": round(retry_s, 2),
            "tokens_first": len(llm.tokenizer.encode(first)), "words_final": len(final.split()),
        })
        status = "ok" if not first_problems else ("fixed" if not final_problems else "FAIL")
        print(f"  {repo.split('/')[-1]:30s} {c['risk']['site_id']:10s} {c['risk']['date']} {f.decision:8s} "
              f"{status:5s} {first_s:4.1f}s {first_problems[:2] if first_problems else ''}", flush=True)
    df = pd.DataFrame(rows)
    problems = pd.Series([p.split(" ")[0] + " " + p.split(" ")[1] for ps in df["first_problems"] for p in ps])
    return {
        "model": repo,
        "load_seconds": round(load_s, 1),
        "peak_gpu_memory_gb": round(peak_memory_gb(), 2),
        "n": len(df),
        "pass_first_try": round(float((df["first_problems"].str.len() == 0).mean()), 3),
        "pass_after_retry": round(float((df["final_problems"].str.len() == 0).mean()), 3),
        "template_fallback_rate": round(float((df["final_problems"].str.len() > 0).mean()), 3),
        "seconds_per_briefing_median": round(float(df["seconds_first"].median()), 2),
        "tokens_per_second": round(float(df["tokens_first"].sum() / df["seconds_first"].sum()), 1),
        "words_median": int(df["words_final"].median()),
        "pass_by_decision": df.assign(ok=df["final_problems"].str.len() == 0).groupby("decision")["ok"].mean().round(3).to_dict(),
        "pass_with_alert": round(float((df[df["has_alert"]]["final_problems"].str.len() == 0).mean()), 3),
        "first_try_problem_types": problems.value_counts().to_dict(),
        "rows": rows,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--models", nargs="*", default=CANDIDATES)
    ap.add_argument("--tag", default="", help="suffix for the output files, e.g. _final")
    args = ap.parse_args()

    m = HazardModels()
    cases = build_cases(m, args.n)
    print(f"{len(cases)} cases: " + ", ".join(f"{k} {v}" for k, v in
          pd.Series([c["risk"]["recommendation"] for c in cases]).value_counts().items()))
    results = []
    for repo in args.models:
        try:
            results.append(run_model(repo, cases))
        except Exception as e:  # noqa: BLE001  (e.g. architecture not supported by mlx-lm)
            print(f"  {repo} failed: {type(e).__name__}: {e}")
            results.append({"model": repo, "error": f"{type(e).__name__}: {e}"[:300]})

    (MODELS / f"briefing_bakeoff{args.tag}.json").write_text(json.dumps(results, indent=1, default=str))
    keys = ["pass_first_try", "pass_after_retry", "template_fallback_rate", "seconds_per_briefing_median",
            "tokens_per_second", "peak_gpu_memory_gb", "load_seconds", "words_median", "pass_with_alert"]
    lines = ["# Briefing model bake-off", "",
             f"{len(cases)} real 2025 site-days (go / caution / no-go mix, two backtest storm days, some with a "
             "live lightning alert or crew wildlife report). Greedy decoding, thinking off, one retry with the "
             "checker's feedback before falling back to the template.", "",
             "| metric | " + " | ".join(r["model"].split("/")[-1] for r in results) + " |",
             "|---|" + "---|" * len(results)]
    for k in keys:
        lines.append(f"| {k} | " + " | ".join(str(r.get(k, r.get("error", "")))[:60] for r in results) + " |")
    lines.append("| first-try problems | " + " | ".join(
        ", ".join(f"{k} ({v})" for k, v in r.get("first_try_problem_types", {}).items()) or "none" for r in results) + " |")
    (MODELS / f"briefing_bakeoff{args.tag}.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
