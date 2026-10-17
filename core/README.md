# PlanIT Control Core

FastAPI/PostgreSQL backend for environmental monitoring at demonstration U.S.
power-plant reference locations. Imported EIA plants are **not verified active
construction sites**. Synthetic records are marked `synthetic`, and rainfall
soil/flood indicators are marked as estimates or proxies.

## Local startup

Requirements: Docker with Compose, or Python 3.12 plus PostgreSQL 16.

```bash
cd core
cp .env.example .env
docker compose up --build -d
docker compose exec api planit-import-sites
docker compose exec api planit-seed-demo
docker compose exec api planit-db-check
docker compose exec api planit-api-smoke
```

The API is at `http://localhost:8000`, OpenAPI at `/docs`, and health at
`/health`. Development authentication accepts `X-PlanIT-Role` (`crew`,
`supervisor`, or `admin`) and `X-PlanIT-Subject`; it cannot be enabled when
`ENVIRONMENT=production`.

The example host `DATABASE_URL` uses `localhost`. Compose supplies its own
container URL using the `db` hostname, so the same `.env` works for both the
host CLI and the container stack. Set `DOCKER_DATABASE_URL` only when Compose
should use a different database, such as Tiger Data.

Without Docker:

```bash
cd core
uv sync --extra dev
uv run alembic upgrade head
uv run planit-import-sites
uv run planit-seed-demo
uv run planit-db-check
uv run uvicorn app.main:app --reload
uv run planit-worker
```

In another terminal, verify the running API with:

```bash
cd core
uv run planit-api-smoke
```

The smoke command is read-only by default. Pass `--write-checks` only against a
development database when you also want to verify report creation.

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

Production requires `AUTH_MODE=clerk`, a Clerk JWKS URL, issuer, optional
audience, and allowed `azp` origins. Configure a `planit_role` session claim
with one of:

- `crew`: operational reads and report submission.
- `supervisor`: crew access, report review, and alert acknowledgement/resolution.
- `admin`: supervisor access, ingestion, system status, and EIA refresh.

The API verifies RS256 signatures, issuer, expiration, audience when supplied,
and authorized party when configured. Report submissions are limited to 30 per
subject per minute using persisted report timestamps. Administrative provider
runs are limited to one per provider per minute.

## Providers and safety semantics

Scheduled external polling is opt-in. The default `ENABLED_PROVIDERS=[]` keeps
local startup deterministic and avoids contacting third parties. Enable only
configured providers using JSON, for example
`ENABLED_PROVIDERS=["weather","weather_alerts","usgs"]`. Manual admin runs
remain available to administrators.

- NWS: hourly forecasts, nearest-station observations, official point alerts,
  and NOAA-formula calculated heat index. Set an identifiable `NWS_USER_AGENT`.
- USGS: nearby stream gage height and streamflow. Measurements do not alone
  claim flooding; flood stages must be configured or an official warning used.
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
   `AUTH_MODE=clerk`, an approved or disabled alert-threshold profile, Clerk
   values, Tiger Data TLS `DATABASE_URL`, the real
   frontend origin, NWS contact, and optional FIRMS key.
3. In production Compose, omit the local `db` service and point both `api` and
   `worker` at Tiger Data. Run the one-shot migration service before rolling
   API/worker containers.
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
- The inference adapter intentionally raises until an actual trained model is
  configured. Seeded risk scores use `score_source=demo` and
  `model_version=demo-not-a-model-v1`.
- Tiger Data connectivity and extension availability must be verified with the
  actual deployment credentials using `planit-db-check`.
