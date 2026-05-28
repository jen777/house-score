# Architecture

## Stack

| Layer            | Choice                                       | Notes |
| ---------------- | -------------------------------------------- | ----- |
| Frontend         | Next.js (App Router) + React + TypeScript    | Server Components by default |
| Backend          | Next.js Route Handlers + Server Actions      | Keep it one deployable unit for the MVP |
| Database         | Supabase Postgres                            | RLS on, owner-scoped rows |
| Geo              | PostGIS extension                            | `geography(Point)` + radius queries |
| Auth             | Supabase Auth                                | Single-user MVP, but multi-user ready |
| AI extraction    | Claude API (Anthropic SDK)                   | Structured output via tool use; prompt caching |
| Property data    | RentCast (Phase 2) → ATTOM (later)           | Server-side only; keys never in client |
| Maps             | Mapbox GL (or Google Maps)                   | Render saved communities |
| File storage     | Supabase Storage                             | Listing screenshots, disclosure PDFs |
| Charts           | Simple table first, lightweight charts later | Don't overbuild the dashboard |

## High-level system

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js app                           │
│                                                           │
│  React UI (Server + Client Components)                    │
│    • Add property      • Property detail / override       │
│    • Comparison view   • Map view   • Status board        │
│                                                           │
│  Server Actions / Route Handlers                          │
│    • property CRUD                                        │
│    • POST /api/extract   → Claude (listing → features)    │
│    • POST /api/enrich    → RentCast (Phase 2)             │
│    • scoring engine (pure TS, server-side)                │
└───────────────┬───────────────────────────┬──────────────┘
                │                           │
        ┌───────▼────────┐         ┌────────▼─────────┐
        │ Supabase        │         │ External APIs    │
        │  Postgres+PostGIS│        │  • Claude        │
        │  Auth            │        │  • RentCast (P2) │
        │  Storage         │        │  • Maps          │
        └─────────────────┘         └──────────────────┘
```

## Add-a-property request flow

```
User pastes link + listing text
        │
        ▼
Create `properties` row (status = new, source = redfin|zillow|realtor|manual)
        │
        ▼
User confirms address  ──(Phase 2)──►  enrich via RentCast → backfill fields
        │                                  (each field: value + source + confidence)
        ▼
POST /api/extract { listing_text }  →  Claude returns structured features JSON
        │
        ▼
Persist extracted features + concerns + emotional_fit_summary
        │
        ▼
Scoring engine computes objective scores from data,
seeds personal-fit scores as "unrated"
        │
        ▼
User adjusts subjective ratings → total_weighted_score recomputed
        │
        ▼
Property appears in ranked comparison dashboard
```

## Key design principles

- **The decision layer is the product.** APIs and listings are inputs; the value
  is comparable scoring tuned to the user.
- **Never scrape.** Listing links are user-pasted references only. Enrichment is
  via legal APIs / public records. See `DATA_SOURCES.md`.
- **Every enriched field carries provenance:** `value`, `source`, `confidence`.
- **Scoring is pure and testable.** Implement as pure functions over a property
  record + a weights config; no I/O. Easy to unit-test and to re-tune.
- **Secrets stay server-side.** Claude / RentCast / maps server keys never reach
  the client; call them from Route Handlers / Server Actions.
- **Manual override always wins.** Any AI- or API-derived field can be overridden;
  store both the derived value and the user override.

## Environment configuration (planned)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server-only

# AI
ANTHROPIC_API_KEY=                # server-only

# Property data (Phase 2)
RENTCAST_API_KEY=                 # server-only

# Maps
NEXT_PUBLIC_MAPBOX_TOKEN=         # or Google Maps key
```
