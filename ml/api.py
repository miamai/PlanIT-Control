"""FastAPI endpoint around score.py.

    uv run uvicorn api:app --reload --port 8000

GET  /sites                         site list for the map / picker
GET  /briefing?site_id=EIA-56407    next-day safety briefing (risk JSON + text); POST takes alerts and
                                    crew reports like /score. ?backend=template|local|gemini|auto
GET  /score?site_id=EIA-56407       tomorrow's risk JSON (site-local "tomorrow")
POST /score                         same, with A's live alerts and recent crew reports:
     {"site_id": "...", "date": "2026-10-17",
      "alerts": [{"type": "lightning", "action": "no-go", "message": "Strike within 10 mi"}],
      "crew_reports": [{"animal": "alligator", "reported_at": "2026-10-16T14:00:00"}]}

Add ?mock=true (or run before models exist) to get a placeholder in the same shape.
"""

from __future__ import annotations

from datetime import date as Date

import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from common import MODELS
import briefing
import score

app = FastAPI(title="PlanIT hazard scoring", version="v1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def models_ready() -> bool:
    return (MODELS / "metadata.json").exists() and (MODELS / "sites.parquet").exists()


class ScoreRequest(BaseModel):
    site_id: str
    date: Date | None = None
    alerts: list[dict] | None = None
    crew_reports: list[dict] | None = None


@app.get("/health")
def health() -> dict:
    return {"ok": True, "models_ready": models_ready()}


@app.get("/sites")
def sites() -> list[dict]:
    path = MODELS / "sites.parquet"
    if not path.exists():
        raise HTTPException(503, "sites not built yet; run pipeline/01_sites.py and 07_build_table.py")
    cols = ["site_id", "name", "state", "county", "lat", "lon", "timezone", "region", "technology", "capacity_mw"]
    df = pd.read_parquet(path)[cols]
    return df.astype(object).where(df.notna(), None).to_dict(orient="records")


def _score(req: ScoreRequest, mock: bool) -> dict:
    if mock or not models_ready():
        return score.mock_score(req.site_id, req.date)
    try:
        return score.score_site(req.site_id, req.date, req.alerts, req.crew_reports)
    except KeyError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except requests.RequestException as e:
        raise HTTPException(503, "Weather forecast provider unavailable or rate-limited; try again in a minute") from e


@app.get("/score")
def score_get(site_id: str, date: Date | None = None, mock: bool = False) -> dict:
    return _score(ScoreRequest(site_id=site_id, date=date), mock)


@app.post("/score")
def score_post(req: ScoreRequest, mock: bool = False) -> dict:
    return _score(req, mock)


def _briefing(req: ScoreRequest, mock: bool, backend: str) -> dict:
    risk = _score(req, mock)
    site = (score.get_models().site(req.site_id) if not risk.get("mock")
            else {"site_id": req.site_id, "name": req.site_id})
    out = briefing.write_briefing(risk, site, backend="template" if risk.get("mock") else backend,
                                  crew_reports=req.crew_reports)
    return {"risk": risk, **out}


@app.get("/briefing")
def briefing_get(site_id: str, date: Date | None = None, mock: bool = False, backend: str = "auto") -> dict:
    return _briefing(ScoreRequest(site_id=site_id, date=date), mock, backend)


@app.post("/briefing")
def briefing_post(req: ScoreRequest, mock: bool = False, backend: str = "auto") -> dict:
    return _briefing(req, mock, backend)
