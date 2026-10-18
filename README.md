# PlanIT Control

PlanIT Control is a field-operations dashboard for understanding environmental risk at monitored sites. It brings together weather, alerts, hazard scores, crew reports, and operational briefings so supervisors can make safer work decisions.

## What the project does

- Shows monitored sites and their current conditions.
- Summarizes heat, flooding, storms, wildfire, soil, wildlife, and other hazards.
- Calculates an overall Hazard Index and explains the main contributing factors.
- Delivers alerts and live updates to the dashboard.
- Stores crew reports and operational history.
- Provides briefings that turn risk information into clear next steps.

## How the parts fit together

```text
External data sources
        │
        ▼
Core API ───────► Database
   │
   ├────────────► ML service (risk scores and briefings)
   │
   └────────────► Frontend dashboard
```

- **Frontend** is the website used by operators and supervisors.
- **Core** is the main application service. It manages users, sites, observations, alerts, reports, decisions, and live updates.
- **ML** is the hazard-analysis service. It produces Hazard Index scores, contributing factors, and briefing content.
- **Database** stores accounts, sites, observations, alerts, reports, scores, and history.
- **External providers** supply information such as weather, weather alerts, USGS data, EIA site data, wildfire information, and other environmental observations.

## Project structure

```text
/
├── frontend/     User-facing web dashboard
├── core/         Main API, authentication, workers, alerts, and database logic
├── ml/           Hazard scoring, model data, and briefing service
├── requirement.md Project/task notes
└── README.md     This overview
```

Important areas inside the main projects:

- `frontend/src/` — dashboard pages, forms, maps, tables, and UI behavior.
- `core/app/` — API routes and operational services.
- `core/alembic/` — database change history.
- `core/docs/` — API documentation and contracts.
- `ml/pipeline/` — data preparation and model-building workflows.
- `ml/models/` — model artifacts when they are available.

## Where to find more information

- [Core overview and operations](core/README.md)
- [ML service and hazard models](ml/README.md)
- [Frontend dashboard](frontend/README.md)

The detailed setup and development instructions stay in those project-specific documents so this page remains easy to read for non-developers.
