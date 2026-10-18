# Precognition Core

## Background

- FastAPI + PostgreSQL (Tiger Cloud) backend for environmental monitoring at U.S. power-plant locations
- Hazard index and briefings come from a separate `ml` service
  - Only the `ml` container gets `GEMINI_API_KEY` (set it in `ml/.env`)
  - Without the key, briefings fall back to a deterministic template

### Architecture

- `api`: REST + SSE (`/api/stream`)
- `worker`: provider polling, alert evaluation, hazard index refresh, daily briefing after 6 PM
  site-local time
  - Every `ML_SCORE_INTERVAL_SECONDS` (default 900) it rescores each ML-covered site's operational
    day (today until 6 PM site-local, then tomorrow) with the newest forecast, active alerts and
    crew reports, updating that day's score in place; a site with a new crew report is rescored on
    the next tick
  - The narrative briefing is still written once per site and day
- `ml`: hazard index (0-10) and briefing text
- `bootstrap`: one-shot setup that runs before `api` and `worker` start

## Development

### Start (Docker)

```bash
cd core
cp .env.example .env
```

- Required: `DATABASE_URL`, `DOCKER_DATABASE_URL`, `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD`, `NWS_USER_AGENT`
- Recommended: `EIA_API_KEY` (free, https://www.eia.gov/opendata/register.php), otherwise sites load from the bundled snapshot
- Database URLs use the `postgresql+asyncpg://` scheme and `sslmode=require`
- Then start everything

```bash
docker compose up -d
```

- `bootstrap` runs once and is safe to re-run. It does the following in order:

1. Apply migrations
1. Create the first admin (skipped if any user exists)
1. Load sites (skipped if sites already exist)
   - From the EIA Open Data API when `EIA_API_KEY` is set, otherwise from the bundled snapshot
1. Sync ML site coverage
1. Schema check (also logs row counts and TimescaleDB availability)

- Check progress with `docker compose logs -f bootstrap`
- API: `http://localhost:8000`, docs: `/docs`, health: `/health`

### Start (local)

- Requires Python 3.12, [uv](https://docs.astral.sh/uv/) and a running `ml` service

```bash
uv sync
uv run setup # idempotent migrations, admin, sites, ML sync and checks
uv run dev   # API (hot reload) + worker
```

### Re-run part of bootstrap

- Prefix with `docker compose exec api` for Docker, or `uv run` for local
- Run one step only (`migrate`, `admin`, `sites`, `ml-sync`, `check`)

```bash
planit-bootstrap --only ml-sync
```

- Reload sites from the source (e.g. after changing the site filter)

```bash
planit-bootstrap --only sites --refresh-sites
```

### Frontend contract

- OpenAPI UI: `/docs`, schema: `/openapi.json`, checked-in copy: `docs/openapi.json`
- Regenerate after changing any route or schema

```bash
uv run python scripts/export_openapi.py
```

- Tests fail if the checked-in copy is stale

### Run tests and lint

```bash
uv run ruff check .
uv run pytest
```

- DB integration tests need a dedicated database

```bash
TEST_DATABASE_URL=postgresql+asyncpg://planit:planit@localhost:5432/planit_test uv run pytest
```

- Never point `TEST_DATABASE_URL` at production or shared Tiger Data (fixtures drop the schema)

## Production

- Set `ENVIRONMENT=production`, `JWT_SECRET_KEY`, `DB_REQUIRE_TLS=true`, an approved or disabled threshold profile, the real frontend origin and NWS contact
- `docker compose up -d` runs bootstrap before `api` and `worker`
- Bootstrap refuses to create an admin with the placeholder credentials from `.env.example`
- Keep secrets out of Git
- If the schema check reports TimescaleDB available, review and run `scripts/enable_timescale.sql` (converts only `hazard_observations`)
- Rollback: redeploy the previous image tag
  - Prefer forward DB fixes; take a Tiger backup before any `alembic downgrade`
