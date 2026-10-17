# PlanIT Control Core

FastAPI/PostgreSQL backend for environmental monitoring at demonstration U.S.
power-plant reference locations. Imported EIA plants are **not verified active
construction sites**. Synthetic records are marked `synthetic`, and rainfall
soil/flood indicators are marked as estimates or proxies.

## Local startup

Requirements: Docker with Compose, Python 3.12, and a Tiger Cloud service.

```bash
cd core
cp .env.example .env
docker compose build
docker compose run --rm init-admin
docker compose up -d
docker compose exec api planit-import-sites
docker compose exec api planit-ml-sync-sites
docker compose exec api planit-seed-demo
docker compose exec api planit-db-check
docker compose exec api planit-api-smoke --username <username>
```

Before running `init-admin`, supply `INITIAL_ADMIN_USERNAME` and
`INITIAL_ADMIN_PASSWORD` through the uncommitted `.env` file or deployment
secret injection. The command refuses to run if any user account already
exists. Remove those values from the environment after provisioning. The API is
at `http://localhost:8000`, OpenAPI at `/docs`, and health at `/health`.

Set both `DATABASE_URL` and `DOCKER_DATABASE_URL` in the ignored `.env` file to
the Tiger Cloud URL using the `postgresql+asyncpg://` scheme and
`sslmode=require`. Compose intentionally has no local PostgreSQL service; it
fails fast when `DOCKER_DATABASE_URL` is missing.

Without Docker:

```bash
cd core
uv sync --extra dev
uv run alembic upgrade head
INITIAL_ADMIN_USERNAME=<username> INITIAL_ADMIN_PASSWORD=<secret> uv run planit-init-admin
uv run planit-import-sites
uv run planit-seed-demo
uv run planit-db-check
uv run uvicorn app.main:app --reload
uv run planit-worker
```

In another terminal, verify the running API with:

```bash
cd core
uv run planit-api-smoke --username <username>
```

The smoke command prompts for a password without echoing it. Automation may
provide `PLANIT_SMOKE_USERNAME` and `PLANIT_SMOKE_PASSWORD` through secret
injection. It is read-only by default; pass `--write-checks` only against a
development database when you also want to verify report creation.

## Daily ML hazard index and briefing

The worker generates a next-day briefing after 6 PM in each site's timezone. For sites in the
checked-in model catalog it calls the internal `ml` service, stores the validated 0–10 hazard index,
and writes a checked Gemini briefing (or the deterministic template fallback). Active alerts may
raise the recommendation but never alter the numeric index. Sites outside the catalog receive a
deterministic report/alert briefing and expose `unsupported` risk status; the system never substitutes
a nearby modeled site.

Synchronize coverage after migrations and the regular EIA import:

```bash
docker compose exec api planit-ml-sync-sites
```

The sync is additive and does not delete existing sites. Core sends reports since the previous
briefing (24 hours for the first run), without reporter identity. All reports contribute to aggregate
counts. Wildlife is handled as one category without species filters or weights; animal metadata is
not forwarded to ML or used in briefing generation.

### Backfilling recent history

The worker only records forward: one next-day score per evening and one station reading per poll.
To fill the 14-day hazard index chart and the 24-hour weather chart right away, with the ML
service running:

```bash
uv run planit-backfill                   # every ML-covered site
uv run planit-backfill <site-uuid>       # one site
uv run planit-backfill --days 7 --weather-hours 72 --skip-weather
```

Each of the last `--days` site-local days (today included, at most 14) that has no score from the
current model version is scored through the ML service's `/score` and stored with
`score_source=ml_backfill` and `contributing_factors.backfilled=true`. These are model output for
a past date computed from observed weather, not forecasts made in advance, and no alerts or crew
reports are sent with them. They appear in `/risk/history` only; the current score and rankings
ignore them. Weather backfill stores one nearest-station NWS reading per hour (at most a week back,
which is what NWS keeps) without evaluating alert rules. Both parts skip data already stored, so
the command is safe to rerun.
The ML container alone receives `GEMINI_API_KEY`: copy `ml/.env.example` to the ignored `ml/.env`
and inject the key there (or through an equivalent deployment secret). Leave it unset to use the
deterministic template. Core's API and worker explicitly clear this variable, and no paid Gemini call
is made by the test suite.

For a due site-specific operational retry, use `planit-ml-generate <core-site-uuid>`. The command
still enforces the site's local 6 PM cutoff. `GET /api/admin/system` reports ML health, model version,
catalog size, and the last successful stored generation.

## Frontend API contract

- Interactive OpenAPI: `http://localhost:8000/docs`
- Machine-readable runtime schema: `http://localhost:8000/openapi.json`
- Checked-in schema: [`docs/openapi.json`](docs/openapi.json)
- Frontend guide and endpoint examples: [`docs/frontend-api.md`](docs/frontend-api.md)
- Axios, TanStack Query, and SSE examples:
  [`docs/frontend-api.example.ts`](docs/frontend-api.example.ts)

Regenerate the checked-in contract after changing a route or schema:

```bash
cd core
uv run python scripts/export_openapi.py
```

The test suite fails when the checked-in contract is stale.

## Site data

The bundled cache contains 153 authentic operating plants from the official
August 2026 EIA-860M workbook. Refresh options are:

```bash
# Deterministic bundled snapshot
uv run planit-import-sites

# Download the pinned official release
uv run planit-import-sites --download

# Parse a supplied authentic workbook after inspecting its headers
uv run planit-import-sites --file /path/to/eia860m.xlsx
```

All modes upsert by EIA Plant ID. The administrative HTTP endpoint refreshes
only from the bundled snapshot; it cannot download an arbitrary URL.

## Authentication and authorization

Authentication is local and identical in development and production. Login at
`POST /api/auth/login`; keep the returned 15-minute access token in memory and
send it as `Authorization: Bearer ...`. The seven-day rotating refresh token is
an HttpOnly, SameSite=Lax cookie scoped to `/api/auth`. Call
`POST /api/auth/refresh` with browser credentials enabled. Production requires
a unique `JWT_SECRET_KEY` of at least 32 random bytes.

Roles are:

- `crew`: operational reads and report submission.
- `supervisor`: crew access, report review, and alert acknowledgement/resolution.
- `admin`: supervisor access, ingestion, system status, and EIA refresh.

Admins manage all roles through `/api/admin/users`; the last active admin cannot
be disabled, demoted, or deleted, and an admin cannot self-delete. Password
changes, disablement, role changes, and soft deletion revoke refresh sessions.
Report submissions are limited to 30 per user per minute, and provider runs to
one per provider per minute.

The frontend hazard feeds are stored-data reads and never call upstream services:
`/api/sites/weather`, `/api/sites/lightning`, `/api/sites/flood`,
`/api/sites/wildfire`, and `/api/sites/soil`. Filter any feed with repeated US
state parameters, for example `?state=TX&state=LA`; omitting `state` returns all
stored U.S. observations. Each row contains `{ "site": ..., "observation": ... }`.

## Providers and safety semantics

Scheduled external polling is opt-in. The default `ENABLED_PROVIDERS=[]` keeps
local startup deterministic and avoids contacting third parties. Enable only
configured providers using JSON, for example
`ENABLED_PROVIDERS=["weather","weather_alerts","usgs"]`. Manual admin runs
remain available to administrators.

- NWS: hourly forecasts, nearest-station observations, official point alerts,
  and NOAA-formula calculated heat index. Set an identifiable `NWS_USER_AGENT`.
- USGS: nearby stream gage height and streamflow from the modern Water Data OGC
  API (`api.waterdata.usgs.gov`), replacing the legacy service retiring in 2027.
  Measurements do not alone claim flooding; flood stages must be configured or
  an official warning used.
- NASA FIRMS: VIIRS active-fire detections. `NASA_FIRMS_MAP_KEY` is required.
  Detections are not evacuation orders.
- Soil: a 72-hour antecedent-rainfall proxy with uncertainty metadata, not a
  measured saturation value.
- Lightning: provider-neutral state machine. Only the fixture adapter exists;
  it produces no spontaneous events and must never be represented as live.
- Wildlife: crew reports are shared to reference sites inside the configured
  radius and retain their verification status.

All non-lightning thresholds default to the explicitly labeled `demo` profile.
They are not OSHA or utility standards. Replace
or disable them before operational use. Production startup rejects the `demo`
profile; set `ALERT_THRESHOLD_PROFILE=approved` only after configuring reviewed
threshold values, or set it to `disabled`.

Lightning strikes at or within 10 miles activate `STOP_WORK`. Only a newer,
unique qualifying strike resets the server-side 30-minute window. When the
window elapses the state becomes `ALL_CLEAR_ELIGIBLE`; it never authorizes work
to resume. Alert changes are persisted with transition history and sent through
authenticated SSE at `/api/stream`. Clients reconnect with `Last-Event-ID` and
must recover current state through REST.

## Testing

```bash
cd core
uv run ruff check .
uv run pytest
```

Unit and provider-normalization tests run without a database. Database,
lightning, concurrency, briefing, and API integration tests require a dedicated
PostgreSQL database:

```bash
TEST_DATABASE_URL=postgresql+asyncpg://planit:planit@localhost:5432/planit_test \
  uv run pytest
```

Never point integration tests at production or a shared Tiger Data database;
the fixtures create and drop the application schema.

## Tiger Data and TimescaleDB

The application uses PostgreSQL by default; SQLite is limited to isolated unit
tests. PostgreSQL is retained because ingestion relies on conflict-safe upserts,
advisory locks, and concurrency behavior that SQLite cannot reproduce safely.

For Tiger Data, copy the service connection string, change its scheme from
`postgresql://` to `postgresql+asyncpg://`, and retain `sslmode=require`. Do not
commit the resulting URL. A production configuration should include:

```dotenv
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
DB_REQUIRE_TLS=true
```

Then apply and verify the exact application schema:

```bash
cd core
uv run alembic upgrade head
uv run planit-db-check
```

For a new Tiger Data database, create the first administrator exactly once after
the migration, with the connection URL and credentials supplied by secret
management:

```bash
DATABASE_URL=<tiger-asyncpg-url> INITIAL_ADMIN_USERNAME=<username> \
INITIAL_ADMIN_PASSWORD=<secret> uv run planit-init-admin
```

`planit-db-check` reports the sanitized host/database, TLS state, current and
expected migration revisions, required tables, row counts, and TimescaleDB
availability without printing credentials. The authenticated
`GET /api/admin/system` endpoint exposes the same deployment check.

Tiger Data services support TimescaleDB, but this application treats standard
PostgreSQL as the baseline. If the check reports the extension as available,
review and run `scripts/enable_timescale.sql`; it converts only
`hazard_observations`, whose compound primary/unique keys include the partition
timestamp. Lightning remains a regular table to preserve global provider event
uniqueness.

## Vultr deployment and rollback

1. Create a Vultr host, install Docker/Compose, restrict inbound access to the
   reverse proxy and administration addresses, and copy the repository.
2. Store production secrets outside Git (Vultr secret/user-data mechanism or a
   root-readable environment file). Set `ENVIRONMENT=production`,
   a unique `JWT_SECRET_KEY`, an approved or disabled alert-threshold profile,
   Tiger Data TLS `DATABASE_URL`, the real
   frontend origin, NWS contact, and optional FIRMS key.
3. Point both `api` and `worker` at Tiger Data. Run the one-shot migration
   service before rolling API/worker containers.
4. Build immutable, version-tagged images, start one worker plus the desired API
   replicas, verify `/health`, then exercise authenticated REST and SSE reads.
5. Roll back by redeploying the previous image tag. Prefer forward database
   fixes; run `alembic downgrade <revision>` only after reviewing its data-loss
   impact and taking a Tiger Data backup.

No infrastructure is provisioned by this repository, and no paid service is
contacted without explicit credentials.

## Known integration limits

- A licensed production strike-level lightning provider is not selected.
- Soil moisture uses a rainfall proxy; SMAP ingestion is not implemented.
- River flood-stage thresholds require site-specific configuration; USGS values
  are stored without declaring a flood otherwise.
- ML coverage is deliberately partial and explicitly exposed per site. Unsupported sites receive a
  deterministic briefing but no fabricated numeric score. Seeded risk scores remain labeled
  `score_source=demo` and `model_version=demo-not-a-model-v1`.
- Tiger Data connectivity and extension availability must be verified with the
  actual deployment credentials using `planit-db-check`.
