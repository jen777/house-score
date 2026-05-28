# HouseScore

A personal real estate **decision engine** — not just a house tracker.

HouseScore helps you capture homes you're considering, enrich them with legal
property data, extract signal from listing descriptions with AI, and rank them
against a scoring model adapted from the owner's house-comparison tracker:
**7 weighted categories rated 1–5** — location/walkability, community/kids
amenities, layout/family fit, schools/childcare, commute/access, financial fit,
and condition/risk/resale — rolled into a **Weighted Score out of 100** and a
**Recommendation** (Strong candidate / Good option / Maybe / Pass). See
[`docs/SCORING.md`](docs/SCORING.md).

> **Status:** Phase 1 implemented. A working Next.js + Postgres app: add houses,
> paste a listing, run Claude extraction, rate the 7 categories (1–5) to get a
> weighted score + recommendation + estimated monthly payment, compare side by
> side, view saved homes on a map, and track status. Ships as a Docker Compose
> stack for Coolify. See [`docs/`](docs/) for the full design and
> [`docs/DEPLOY.md`](docs/DEPLOY.md) for deployment.

## The core idea

The "smart" part of this app is **not** copying a listing portal. It's the
**decision layer**: turning scattered listings into one clean, comparable record
and scoring each home on the things that actually matter to *you*.

```
Paste a listing link  →  confirm address  →  enrich from legal data sources
   →  AI reads the description & extracts features  →  scores computed
   →  you adjust the subjective ratings  →  ranked comparison dashboard
```

## A note on data sources (important)

This project does **not** scrape Redfin, Zillow, or Realtor.com. Their terms
prohibit automated crawling/querying. Listing links are treated as a **reference
the user pastes**, and the address is confirmed by the user. Enrichment comes
from **legal data sources**: property-data APIs (RentCast, then ATTOM), county
public records / GIS, and — long-term — MLS-quality data via a realtor/brokerage
relationship (Canopy MLS / MLS Grid for the Charlotte region) using the RESO Web
API standard. See [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

## Chosen stack

The plan targets Supabase, but Phase 1 ships **self-contained** for easy
Docker/Coolify deployment: the app runs its own Postgres and a single-user
password gate (we grow into Supabase Auth / managed Postgres later).

| Layer            | Phase 1 (now)                          | Plan (later) |
| ---------------- | -------------------------------------- | ------------ |
| Frontend         | Next.js (App Router) + React + TS      | same |
| Backend          | Next.js Server Actions / Route Handlers | same |
| Database         | Postgres 16 (in compose) via Drizzle ORM | Supabase Postgres (+ PostGIS) |
| Auth             | Single-user password gate (cookie)     | Supabase Auth |
| AI extraction    | Claude API (Anthropic)                 | same |
| Maps / geocoding | Google Maps + Geocoding (optional)     | same |
| Property data    | Manual + AI extraction                 | RentCast → ATTOM |
| Deployment       | Docker Compose (Coolify proxies)       | same |

## Run it

```bash
# Local dev
cp .env.example .env        # set APP_PASSWORD, AUTH_SECRET, ANTHROPIC_API_KEY
npm install && npm run dev  # http://localhost:3000

# Full stack (as Coolify runs it)
docker compose up --build
```

Deployment details (Coolify, env vars, TLS, backups): [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Project layout

```
src/
  app/                  Next.js App Router (pages + server actions + /api/health)
    page.tsx            ranked house list
    properties/new      add a house
    properties/[id]     detail: 1–5 category ratings, AI extraction, notes, edit
    compare             side-by-side comparison
    map                 Google Map of saved homes, pins colored by recommendation
    login               single-user password gate
  db/                   Drizzle schema, client, startup schema init (ensure-schema)
  lib/                  scoring engine (pure), Claude extraction, auth, UI helpers
  middleware.ts         auth gate for all non-public routes
Dockerfile              multi-stage standalone build
docker-compose.yml      app + Postgres, Coolify-friendly
```

## Roadmap at a glance

- **Phase 1 — Personal tracker + AI extraction.** Manual address / listing-text
  input. Build the scoring and comparison logic first.
- **Phase 2 — API enrichment.** Add RentCast for property records, valuation,
  sales history, and comps.
- **Phase 3 — MLS-quality data.** Partner with a local realtor/brokerage and
  explore Canopy MLS / MLS Grid (RESO Web API) for current Charlotte listings.

Full breakdown in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Documentation

| Doc | What's in it |
| --- | --- |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)             | Phased plan, MVP scope, milestones |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)   | Stack, system design, request flow |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)       | Postgres tables and relationships  |
| [`docs/SCORING.md`](docs/SCORING.md)             | 7-category 1–5 scoring model, formulas, rubric (from the tracker) |
| [`docs/AI_EXTRACTION.md`](docs/AI_EXTRACTION.md) | Claude-based listing feature extraction |
| [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)   | Legal data sourcing, APIs, compliance |
