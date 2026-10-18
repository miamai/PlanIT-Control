# Precognition — Frontend Implementation

This document explains the frontend that was built on top of the existing
`shadcn-admin` (Vite + React + TanStack Router) template for the **Precognition**
platform: a real-time environmental hazard platform for utility field
crews.

It covers **what changed**, **why**, and **how each piece maps to the challenge
requirements**. Everything runs against a deterministic mock API that mirrors
the backend contract the rest of the team will implement, so the UI can be
swapped onto a real API without changing components.

---

## 1. Summary of the deliverable

We turned a generic admin template into a hazard-intelligence control center:

- A **admin dashboard** ranking all monitored sites by a fused 0–10 hazard
  index, with a live alert feed and an interactive US map.
- A **sites explorer** with search/filters plus a **site detail** page showing
  the combined risk picture (weather, heat, lightning, flood, wildfire, soil,
  wildlife), history charts, live alerts, and crew reports.
- An **alert center** that groups live alerts by hazard type and documents the
  detection rules (including the 10-mile lightning stop-work rule with a
  30-minute, strike-resetting all-clear countdown).
- A **shift briefing** page that renders the 6 PM local next-day briefing
  (headline, summary, per-site actions, watchlist, SMS preview).
- A **shared hazard database** and a mobile-first **crew hazard report form**
  (photo, GPS pin, hazard type, severity, note) that persists locally.
- **Auth roles** (`user` / `admin`) assigned by the backend; sign-in uses username and password.

The whole app is driven by **72 real US power-plant locations** (see
[§3](#3-mock-data-the-real-provenance)) and a **deterministic hazard engine**.

---

## 2. Requirement → implementation map

| Challenge requirement | Where it lives |
| --- | --- |
| Real-time stop-work alert if lightning within 10 mi | `src/api/mock/engine.ts` (`LIGHTNING_RADIUS_MI = 10`), `src/stores/live-store.ts`, `src/components/planit/lightning-countdown.tsx` |
| 30-minute all-clear countdown that resets per strike | `ALL_CLEAR_MINUTES = 30` in `engine.ts`; countdown derived in `useCountdown`; resets because each new strike pushes `clearAt` forward |
| Combined risk picture per site (weather/heat/lightning/flood/wildfire/soil/wildlife) | `computeSiteRiskBundle` + `buildDomains` (`engine.ts`); rendered by `RiskPicture` on site detail |
| Flood alerts | `flood` domain + alert generation in `engine.ts` (river-proximity + rainfall) |
| 6 PM local next-day briefing | `BRIEFING_HOUR = 18`, `generateBriefing()` in `engine.ts`; `src/features/briefing` |
| Crew hazard reporting (photo, GPS, type, share) | `src/features/hazards/report-form.tsx`, `createHazardReport()` in `src/api/index.ts` |
| Shared hazard database | `src/features/hazards/index.tsx` + `listHazardReports()` |
| Admin map ranking sites by risk | `src/features/dashboard` (`SiteMap` with numbered top-10 markers + `priority-sites`), `src/features/sites` (`risk-ranked-table`) |
| Hazard index 0–10 with explanations | `scoreRisk()`/`computeRisk()` (`engine.ts`); "Score drivers" card on site detail; `HazardGauge` |
| ≥ 50 real power-plant locations | `src/api/mock/sites-data.ts` (72 plants) |
| Auth roles user / admin | `src/features/auth/sign-in/components/user-auth-form.tsx`, `src/stores/auth-store.ts`, `src/components/profile-dropdown.tsx` |

---

## 3. Mock data: the real provenance

`src/api/mock/sites-data.ts` contains **72 real, contiguous-US power plants**
across 47 states. The data was derived from the **EIA-860M "Monthly Update to
the Electric Power Monthly" (August 2026 snapshot)** published by the U.S.
Energy Information Administration. Each site carries real name, utility,
county/state, latitude/longitude, nameplate capacity (MW), plant type, and the
EIA plant ID.

> Provenance note: the file is a trimmed snapshot for offline/mock use. The
> `eiaPlantId` field is retained so the real backend can re-join to the full EIA
> dataset.

Each site is assigned a deterministic **`SiteProfile`** (heat/storm/flood/
wildfire/wildlife/soil exposure, coastal flag, river distance, flood zone) so the
same site always produces the same risk unless the live clock or strike feed
changes. This keeps screenshots and tests stable.

`src/api/mock/reports-data.ts` seeds **14 crew hazard reports** so the shared
database, maps, and dashboard aren't empty on first load.

---

## 4. Architecture

```
src/
  api/
    types.ts              # the API contract (single source of truth)
    index.ts              # async data-access layer (swap mock → fetch)
    mock/
      sites-data.ts       # 72 real sites
      engine.ts           # deterministic hazard engine
      reports-data.ts     # seeded crew reports
  stores/
    live-store.ts         # zustand: realtime clock + lightning strike feed
    auth-store.ts         # (template) user + roles
  hooks/
    use-planit.ts         # derived risk/alerts/countdown hooks
  lib/
    planit.ts             # severity/recommendation styling, icons, formatters
    toast.ts              # small sonner wrapper
  components/planit/      # app-wide presentational components
  features/
    dashboard/ sites/ alerts/ briefing/ hazards/
  routes/_authenticated/  # TanStack file routes (thin wrappers)
docs/
  frontend-implementation.md  # this file
```

### 4.1 Why an API layer instead of importing the mock directly

Every screen talks to `src/api/index.ts`, never to `mock/*`. Each function is
`async` and artificially delayed (`LATENCY_MS = 220`) to behave like a network
call. When Person A/B land the real backend, only `src/api/index.ts` changes —
the signatures are already the contract. `src/api/types.ts` is that contract:
`Site`, `SiteRisk`, `HazardDomain`, `DomainStatus`, `Alert`, `LightningStrike`,
`HazardReport`, `Briefing`, `DashboardSummary`, `TimelinePoint`, and so on.

### 4.2 Why a hazard engine (`engine.ts`)

The engine is the local stand-in for "the ML model" (Person B's work). It is
pure and deterministic given `(site, now, strikes)`:

- `computeConditions()` — synthesizes weather/heat/lightning/flood/soil/wildfire
  signals from the site profile plus a scenario.
- `buildDomains()` — turns signals into 7 `DomainStatus` entries (0–10 severity,
  status level, human-readable detail).
- `scoreRisk()` / `computeRisk()` — weighted fusion using `HAZARD_WEIGHTS`, then
  `recommendationFromScore` → `GO` / `CAUTION` / `NO-GO`, plus `reasons[]`
  explaining the biggest contributors.
- `buildAlertForSite()` — emits alerts, including the lightning stop-work rule.
- `generateBriefing()` — builds the 6 PM next-day briefing (headline, summary,
  per-site actions, watchlist, SMS preview), tagged `gemini` or `template`.
- `buildTimeline()` / `buildHazardIndexHistory()` — 24-hour and 14-day series for
  the site charts.

Constants: `LIGHTNING_RADIUS_MI = 10`, `ALL_CLEAR_MINUTES = 30`,
`BRIEFING_HOUR = 18`, `MODEL_VERSION = 'hazard-index v1.3'`.

### 4.3 Why a live store (`live-store.ts`)

Real-time behaviour is simulated with a zustand store that:

- ticks a clock every second (drives all countdowns and "time ago" labels);
- holds a **lightning strike feed** seeded with recent strikes and adds a new
  strike every ~14s;
- exposes `simulateStrike(siteId)` so a demo can trigger the stop-work flow on
  demand (there's a "Simulate strike" button on the dashboard, alerts, and site
  pages).

`computeSiteRiskBundle` is called with the live `now` and `strikes`, so alerts
and countdowns update automatically exactly as a websocket push would. The store
is started once, in `AuthenticatedLayout`, so hooks never mount twice.

### 4.4 Why hooks (`use-planit.ts`)

Components shouldn't know how risk is derived. The hooks memoize bundles with a
20s risk bucket:

- `useSiteBundles()` / `useSiteBundle(id)` → `{ site, risk, conditions, alerts }`
- `useActiveAlerts()` → alerts ranked by recency, tagged with their site
- `useCountdown(iso)` → seconds remaining (used for all-clear timers)
- `useSimulateStrike()`, `useLiveStrikes()`

---

## 5. Screens

Every 0–10 score (gauge, bars, map markers, charts) is colored by its score band
using the ML service's cut-offs: GO < 3.5, CAUTION 3.5–6.5, NO-GO ≥ 6.5
(`GO_BELOW` / `CAUTION_BELOW` / `RISK_BANDS` in `src/lib/planit.ts`).
The displayed live decision can instead be REVIEW REQUIRED for missing/stale
data or NO-GO because of a current alert; that does not recolor the numeric score.

### 5.1 Dashboard (`/`)

Supervisor overview: KPI cards (GO / CAUTION / NO-GO / review split, lightning
stop-work count with the next all-clear, alerts by severity, average index), a
US risk map whose top 10 markers carry their rank number, the matching top-10
list, and compact panels for active alerts, tomorrow's briefing and crew
reports. Clicking a marker or row opens the site.

### 5.2 Sites (`/sites`)

Searchable, filterable portfolio list. Filters: recommendation (`GO` /
`CAUTION` / `NO-GO` / `REVIEW REQUIRED`), plant type, and quick chips with counts. List and map tabs.
Each row links to the site detail page.

### 5.3 Site detail (`/sites/$siteId`)

The combined risk picture for one location:

- a stop-work banner with the all-clear ring whenever lightning is active;
- `HazardGauge`: the 0–10 index on a dial split into the GO / CAUTION / NO-GO
  bands, with the recommendation badge;
- **Hazards** (`RiskPicture`): one row per domain (heat, lightning, flood,
  storm, wildfire, soil, wildlife) with the reading, a 4-step severity meter
  (or Unknown) and trend; source, timestamp-aligned severity basis, and detail are on hover;
- **Score drivers**: typed TreeSHAP or rule-based contributor impacts on each
  hazard's 0–10 sub-score; no overall-score percentage is invented;
- a **14-day hazard-index chart** drawn over the GO / CAUTION / NO-GO bands and
  **24-hour weather** as three small charts (heat index with the 100°F line,
  wind, rainfall);
- site alerts with inline countdowns and crew actions;
- a focused site map with strikes and crew reports;
- the crew reports filed at that site.

### 5.4 Alerts (`/alerts`)

A **stop-work** row of countdown rings (one per site inside a lightning
radius), then the remaining alerts as a compact list, tabbed by hazard type,
most severe first. Side panels list the alert thresholds and delivery channels
(push, Twilio SMS, 6 PM email).

### 5.5 Briefing (`/briefing`)

The 6 PM local next-day safety briefing: headline, narrative summary, per-site
actions with forecast scores, watchlist, and an SMS preview. Also shows the last
five briefings and a today-vs-tomorrow snapshot.

### 5.6 Hazards (`/hazards`) and report form (`/hazards/new`)

The shared hazard database (filter by type, map, top reporters) and the
mobile-first report form: hazard type, severity, note, **photo** (camera/file →
data URL preview), **GPS** via the browser geolocation API (with graceful
fallback to the selected site's coordinates), nearest-site association, and
reporter identity/role. Submissions persist to `localStorage`
(`planit.hazard-reports.v1`) through `createHazardReport()` so reports survive
reloads and immediately appear in lists and maps.

---

## 6. Auth roles

Authentication uses the core API's username/password login with exactly two roles:
`user` and `admin`. User accounts can read operational data and submit hazard
reports. Admins additionally review reports, acknowledge/resolve alerts, manage
accounts, and perform ingestion/system operations. There is no sign-in role
selector. Access tokens remain in memory; the HttpOnly refresh cookie restores
sessions. The user-management screen is available only to Admins.

---

## 7. Template changes and cleanup

**Removed** (unrelated demo features): `features/{apps,chats,tasks,users}`,
their routes, the `clerk/*` demo routes and Clerk logo assets, and the old
dashboard demo components (`analytics`, `analytics-chart`, `overview`,
`recent-sales`).

**Rebranded**: `index.html` title/meta, the two auth-layout headings, sidebar
teams/user, profile dropdown, and nav-user avatar initials now read "Precognition"
/ GridWatch Energy.

**Rewritten**: `src/components/layout/data/sidebar-data.ts` now lists the Precognition
navigation (Dashboard, Sites, Alerts, Briefing, Hazard Reports, Settings).

**Wired**: `AuthenticatedLayout` starts the live feed; `PlanitHeader` is the
top app bar (LIVE indicator + search/theme/profile); navigation lives only in
the sidebar.

**Tests**: `src/context/search-provider.test.tsx` was updated to reference the
new nav items (`Alerts`, `Settings Profile`) instead of the removed demo routes.

**Retained intentionally**: `@clerk/react` remains a dependency (unused by app
code) to avoid regenerating the frozen lockfile; CI installs with
`--frozen-lockfile`.

### Dependencies added

- `leaflet`, `react-leaflet`, `@types/leaflet` — the risk map. Basemaps are
  Esri's keyless Light/Dark Gray Canvas (CARTO now watermarks keyless tiles);
  the report form uses Esri World Topo for on-the-ground context.
- `pnpm-workspace.yaml` with `allowBuilds` for `@clerk/shared` and `esbuild`, so
  `pnpm install` exits 0 under pnpm 12 (required by CI).

---

## 8. Verification

All of the following pass locally (same commands CI runs, see
`.github/workflows/ci.yml`):

- `pnpm lint` — 0 errors, 0 warnings.
- `pnpm format:check` — clean.
- `pnpm build` (`tsc -b && vite build`) — clean.
- `pnpm test` — 87 tests passing (Vitest browser/Playwright).
- Dev-server smoke test: `/`, `/sites`, `/sites/SITE-001`, `/alerts`,
  `/briefing`, `/hazards`, `/hazards/new` all render with no console errors and
  no error boundary.

> CI note: Playwright browsers must be installed once
> (`pnpm exec playwright install chromium`) before the browser test suite runs.

---

## 9. How this connects to the backend

When Persons A/B finish:

1. Replace the bodies (not the signatures) of the functions in
   `src/api/index.ts` with real `fetch` calls to the Tiger Data / Vultr backend.
2. Replace `engine.ts` usage with the deployed hazard-index model output — the
   `SiteRisk` shape (`score`, `recommendation`, `domains[]`, `reasons[]`,
   `trend`, `backtest`, `modelVersion`, `updatedAt`) is already what the UI
   consumes.
3. Replace the simulated strike feed in `live-store.ts` with a websocket/
   server-sent-events subscription that calls the same store actions.
4. Replace `generateBriefing()` output with the Gemini response, keeping the
   `Briefing` type.
