# HouseScore

A personal real estate **decision engine** — not just a house tracker.

HouseScore helps you capture homes you're considering, enrich them with legal
property data, extract signal from listing descriptions with AI, and rank them
against a scoring model that blends **objective data** with your **personal fit**
(family, commute, toddler-friendliness, community feel, HOA risk, resale).

> **Status:** Planning. This repository currently contains the project plan
> only. See [`docs/`](docs/) for the full design. No application code yet.

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

| Layer            | Choice                                 |
| ---------------- | -------------------------------------- |
| Frontend         | Next.js (App Router) + React           |
| Backend          | Next.js Route Handlers / Server Actions |
| Database         | Supabase Postgres (+ PostGIS for geo)  |
| Auth             | Supabase Auth                          |
| AI extraction    | Claude API (Anthropic)                 |
| Property data    | RentCast (Phase 2) → ATTOM (later)     |
| Maps             | Mapbox or Google Maps                  |
| File/doc storage | Supabase Storage                       |

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
| [`docs/SCORING.md`](docs/SCORING.md)             | Objective + personal-fit scoring model |
| [`docs/AI_EXTRACTION.md`](docs/AI_EXTRACTION.md) | Claude-based listing feature extraction |
| [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)   | Legal data sourcing, APIs, compliance |
