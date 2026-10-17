# PlanIT Control frontend API guide

## Connection and authentication

Set the frontend base URL:

```env
VITE_API_BASE_URL=http://localhost:8000
```

All `/api/*` routes require authentication. During local development, send:

```http
X-PlanIT-Role: crew
X-PlanIT-Subject: frontend-developer
```

Valid roles are `crew`, `supervisor`, and `admin`; higher roles include lower-role access.
Production uses a Clerk session token instead:

```http
Authorization: Bearer <token returned by Clerk getToken()>
```

`GET /health`, `/docs`, and `/openapi.json` are public. The checked-in contract is
[`openapi.json`](openapi.json); regenerate it with:

```bash
cd core
.venv/bin/python scripts/export_openapi.py
```

## Common response and error shapes

Successful application responses use an envelope:

```ts
type Envelope<T> = {
  data: T
  meta?: { limit: number; offset: number; total: number } | Record<string, unknown> | null
}
```

List endpoints accept `limit` and `offset` where documented. All timestamps are ISO-8601 UTC
strings. A site's `timezone` is an IANA name for local display and briefing-date logic.

Errors use `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Site not found",
  "status": 404,
  "detail": "Site not found",
  "instance": "/api/sites/00000000-0000-0000-0000-000000000000"
}
```

Validation errors also contain an `errors` array. Treat `401` as unauthenticated, `403` as
insufficient role, `422` as invalid input, `429` as rate limited, and `503` as database unavailable.

## Endpoint index

| Method | Path | Minimum role | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Public | API and database readiness |
| GET | `/api/sites` | Crew | Paginated sites; filters: `state`, `county` |
| GET | `/api/sites/{site_id}` | Crew | Site details |
| GET | `/api/sites/{site_id}/hazards` | Crew | Recent observations; filters: `hazard_type`, `since`, pagination |
| GET | `/api/sites/{site_id}/alerts` | Crew | Site alerts; filters: type, severity, status, pagination |
| GET | `/api/alerts` | Crew | Cross-site alert feed with the same filters |
| PATCH | `/api/alerts/{alert_id}` | Supervisor | Acknowledge or resolve an alert |
| POST | `/api/reports` | Crew | Submit a crew hazard report |
| GET | `/api/reports` | Supervisor | Review submitted reports |
| GET | `/api/sites/{site_id}/risk` | Crew | Latest risk score or explicit `missing` status |
| GET | `/api/risk/rankings` | Crew | Sites sorted by latest risk; missing scores are last |
| GET | `/api/sites/{site_id}/briefings` | Crew | Stored next-day safety briefings |
| GET | `/api/stream` | Crew | SSE alert and risk events |
| GET | `/api/risk/features` | Admin | Normalized historical feature window |
| POST | `/api/risk/predictions` | Admin | Store a trained-model prediction |
| GET | `/api/admin/system` | Admin | Sanitized database/Tiger readiness |
| POST | `/api/admin/ingestion/{provider}` | Admin | Run one configured provider manually |
| POST | `/api/admin/sites/import-eia` | Admin | Refresh from the bundled EIA snapshot |

Hazard types are `weather`, `heat`, `lightning`, `flood`, `wildfire`, `soil`, and `wildlife`.
Severities are `LOW`, `MODERATE`, `HIGH`, and `CRITICAL`. Alert statuses are `ACTIVE`,
`ACKNOWLEDGED`, `ALL_CLEAR_ELIGIBLE`, and `RESOLVED`.

## Common calls

Load sites and a selected site's dashboard data:

```ts
const sites = await api.get<Envelope<Site[]>>('/api/sites', {
  params: { state: 'TX', limit: 50, offset: 0 },
})
const siteId = sites.data.data[0].id
const [hazards, alerts, risk, briefings] = await Promise.all([
  api.get<Envelope<HazardObservation[]>>(`/api/sites/${siteId}/hazards`, {
    params: { limit: 100 },
  }),
  api.get<Envelope<Alert[]>>(`/api/sites/${siteId}/alerts`),
  api.get<Envelope<RiskResult>>(`/api/sites/${siteId}/risk`),
  api.get<Envelope<Briefing[]>>(`/api/sites/${siteId}/briefings`),
])
```

Submit a report:

```json
POST /api/reports
{
  "site_id": "<uuid>",
  "hazard_type": "wildlife",
  "description": "Snake observed beside the east access road",
  "latitude": 30.123,
  "longitude": -90.456,
  "observed_at": "2026-10-17T19:15:00Z",
  "image_reference": "photos/report-123.jpg",
  "image_metadata": { "content_type": "image/jpeg" }
}
```

Risk endpoints intentionally return `score: null` with `status: "missing"` when no trained-model or
demo score exists. Never interpret a missing score as zero risk.

## Real-time stream

Use authenticated streaming `fetch`, not native `EventSource`, because cross-origin Clerk sessions
need an `Authorization` header. Events contain `id`, `event`, and JSON `data`. Reconnect with the last
received ID in `Last-Event-ID`, then refresh current REST state because SSE is a notification channel,
not the source of truth.

```ts
await streamPlanitEvents({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  getToken,
  lastEventId,
  onEvent: ({ id, event, data }) => {
    lastEventId = id
    queryClient.invalidateQueries({ queryKey: ['site', data.site_id] })
  },
})
```

The complete TypeScript reference is [`frontend-api.example.ts`](frontend-api.example.ts).
