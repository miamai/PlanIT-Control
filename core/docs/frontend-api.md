# PlanIT Control frontend API guide

## Connection and authentication

Set the frontend base URL:

```env
VITE_API_BASE_URL=http://localhost:8000
```

All `/api/*` routes except login and refresh require a bearer access token. Login with:

```json
POST /api/auth/login
{ "username": "<configured username>", "password": "<configured password>" }
```

The JSON response contains a 15-minute `access_token` and the user. The response also sets a
rotating seven-day HttpOnly refresh cookie. Keep the access token in memory and send:

```http
Authorization: Bearer <access_token>
```

Use `withCredentials: true` and `POST /api/auth/refresh` after a `401`; it returns a new access
token and rotates the cookie. Do not put either token in localStorage. Users may voluntarily change
their own password with `PATCH /api/auth/me/password`.

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
| POST | `/api/auth/login` | Public | Create access and refresh tokens |
| POST | `/api/auth/refresh` | Refresh cookie | Rotate tokens |
| POST | `/api/auth/logout` | Any user | Revoke the current refresh token |
| GET | `/api/auth/me` | Any user | Current account details |
| PATCH | `/api/auth/me/password` | Any user | Change own password and revoke old sessions |
| GET | `/api/sites` | User | Paginated sites; filters: `state`, `county` |
| GET | `/api/sites/weather` | User | Stored weather and heat observations; repeated `state` filter |
| GET | `/api/sites/lightning` | User | Stored qualifying strike observations; repeated `state` filter |
| GET | `/api/sites/flood` | User | Stored USGS/NWS flood observations; repeated `state` filter |
| GET | `/api/sites/wildfire` | User | Stored FIRMS observations; repeated `state` filter |
| GET | `/api/sites/soil` | User | Stored soil proxy observations; repeated `state` filter |
| GET | `/api/sites/{site_id}` | User | Site details |
| GET | `/api/sites/{site_id}/hazards` | User | Recent observations; filters: `hazard_type`, `since`, pagination |
| GET | `/api/sites/{site_id}/alerts` | User | Site alerts; filters: type, severity, status, pagination |
| GET | `/api/alerts` | User | Cross-site alert feed with the same filters |
| PATCH | `/api/alerts/{alert_id}` | Admin | Acknowledge or resolve an alert |
| POST | `/api/reports` | User | Submit a crew hazard report |
| GET | `/api/reports` | Admin | Review submitted reports |
| GET | `/api/sites/{site_id}/risk` | User | Latest score with available/missing/stale/unsupported status |
| GET | `/api/sites/{site_id}/risk/history` | User | Latest score per day over `days` site-local calendar dates through today (default 14); excludes future forecasts; returns only stored scores |
| GET | `/api/risk/rankings` | User | Sites sorted by latest risk; missing scores are last |
| GET | `/api/sites/{site_id}/briefings` | User | Stored next-day safety briefings |
| GET | `/api/briefings` | User | Briefings across all sites; filters: `briefing_date`, `since`, pagination |
| GET | `/api/stream` | User | SSE alert and risk events |
| GET | `/api/risk/features` | Admin | Normalized historical feature window |
| POST | `/api/risk/predictions` | Admin | Store a trained-model prediction |
| GET | `/api/admin/system` | Admin | Sanitized database/Tiger readiness |
| POST | `/api/admin/ingestion/{provider}` | Admin | Run one configured provider manually |
| POST | `/api/admin/sites/import-eia` | Admin | Refresh from the bundled EIA snapshot |
| GET/POST | `/api/admin/users` | Admin | List/filter users or create one |
| GET/PATCH/DELETE | `/api/admin/users/{user_id}` | Admin | Inspect, update, or soft-delete a user |

Hazard types are `weather`, `heat`, `lightning`, `flood`, `wildfire`, `soil`, and `wildlife`.
Severities are `LOW`, `MODERATE`, `HIGH`, and `CRITICAL`. Alert statuses are `ACTIVE`,
`ACKNOWLEDGED`, `ALL_CLEAR_ELIGIBLE`, and `RESOLVED`.

Feed responses are flat and paginated:

```json
{
  "data": [{ "site": { "state": "TX" }, "observation": { "hazard_type": "weather" } }],
  "meta": {
    "limit": 100,
    "offset": 0,
    "total": 1,
    "states": ["TX", "LA"],
    "data_mode": "stored-live",
    "last_successful_ingestion": "2026-10-17T19:15:00Z",
    "last_run_status": "success"
  }
}
```

Axios must serialize repeated states as `state=TX&state=LA` (not a country filter). These routes
read only the database. Trigger upstream fetching separately with the admin ingestion endpoint,
which accepts the same repeated `state` parameters and records its scope.

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

Every site includes `ml_supported`, `ml_site_id`, and `ml_model_version`. Risk scores include the
site-local `prediction_date`. Risk endpoints return `score: null` with `status: "unsupported"` for
sites outside the current model catalog and `status: "missing"` when a supported site has no score;
expired scores are `stale`. Never interpret any absent score as zero risk.

## Real-time stream

Use authenticated streaming `fetch`, not native `EventSource`, because the stream needs an
`Authorization` header. Events contain `id`, `event`, and JSON `data`. Reconnect with the last
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

### Administrative alert and report actions

The current two-role policy is unchanged: `user` may submit reports, while
`admin` may list all reports and manage them. Users cannot edit/delete even their
own reports. All alert updates also require `admin`.

- `PATCH /api/alerts/{alert_id}` accepts `status` (`ACKNOWLEDGED` or `RESOLVED`
  for the UI) and a review `reason` (3–1000 characters). It records an alert
  transition with the administrator's identity. For lightning `STOP_WORK`,
  resolution requires server status `ALL_CLEAR_ELIGIBLE` and an elapsed current
  countdown. A newer strike can make a previously displayed sign-off stale;
  handle HTTP 409 by refreshing, without showing success. Eligibility itself
  is controlled by the server, never set by the client.
- `PATCH /api/reports/{report_id}` accepts only `description` (3–2000 characters
  after trimming), returns the updated report envelope, and preserves original
  type, pin, reporter and timestamp. Shared wildlife observation descriptions
  and their alert source metadata are synchronized.
- `DELETE /api/reports/{report_id}` returns 204 with no body. It removes the
  report and its exact derived `crew_report` wildlife observations, resolves
  only alerts sourced from those observations, and retains alert transition
  history with the deleting administrator's identity. Other sources and reports
  are unaffected. The UI asks for explicit confirmation before deletion.

Unknown reports return 404; unauthorized roles return 403. No database schema
migration or ML scoring change is required. Refresh reports, site observations,
alerts and briefings after successful mutations; report events also use the
existing event stream.
