# Data model

Postgres (Supabase). All rows are owner-scoped via `owner_id` with Row Level
Security so the model is multi-user ready even though the MVP is single-user.
Every enriched field should be paired with a **source** and **confidence** so the
UI can show provenance.

## Conventions

- `id` — `uuid` primary key, default `gen_random_uuid()`.
- `owner_id` — `uuid` references `auth.users`, RLS `owner_id = auth.uid()`.
- Timestamps — `created_at`, `updated_at` (`timestamptz`, default `now()`).
- Geo — store `location geography(Point, 4326)` for PostGIS radius queries
  (kept alongside plain `latitude` / `longitude` for convenience).
- Enums modeled as Postgres enums (or `text` + check) — listed below.

## Enums

```
property_status : new | maybe | visit | favorite | rejected | offer_candidate
source_platform : redfin | zillow | realtor | manual | other
confidence_level: high | medium | low | unknown
fee_frequency   : monthly | quarterly | annual | one_time | unknown
note_category   : general | neighborhood | commute | condition | hoa | financial | visit
```

## `properties`

The clean canonical record every input converts into.

```
properties
- id                uuid pk
- owner_id          uuid -> auth.users
- address           text not null
- city              text
- state             text
- zip               text
- latitude          double precision
- longitude         double precision
- location          geography(Point, 4326)
- listing_url       text            -- user-pasted reference only
- source            source_platform
- mls_number        text
- status            property_status default 'new'
- price             numeric
- beds              numeric
- baths             numeric
- sqft              integer
- lot_size          numeric         -- acres or sqft; keep a unit column if needed
- year_built        integer
- hoa_fee           numeric         -- denormalized convenience copy of hoa_details
- property_type     text            -- single_family | townhome | condo | ...
- listing_description text          -- raw text fed to AI extraction
- created_at        timestamptz default now()
- updated_at        timestamptz default now()
```

## `property_field_provenance` (optional but recommended)

Tracks where each notable field came from and how confident we are. Avoids
widening `properties` with a `_source` / `_confidence` column per field.

```
property_field_provenance
- id            uuid pk
- property_id   uuid -> properties (on delete cascade)
- field_name    text           -- e.g. 'price', 'sqft', 'hoa_fee'
- source        text           -- 'rentcast' | 'mls' | 'listing' | 'manual' | 'county_gis'
- confidence    confidence_level
- captured_at   timestamptz default now()
- unique (property_id, field_name)
```

## `property_scores`

One row per property; recomputed by the scoring engine and updated on override.

```
property_scores
- property_id           uuid pk -> properties (on delete cascade)
- price_score           numeric
- monthly_cost_score    numeric
- commute_score         numeric
- school_score          numeric
- walkability_score     numeric
- toddler_friendly_score numeric
- community_score       numeric
- hoa_score             numeric
- condition_score       numeric
- resale_score          numeric
- emotional_fit_score   numeric
- total_weighted_score  numeric
- computed_at           timestamptz default now()
```

See `SCORING.md` for ranges, weights, and which scores are objective vs manual.

## `score_overrides`

Lets the user override any individual score without losing the computed value.

```
score_overrides
- id            uuid pk
- property_id   uuid -> properties (on delete cascade)
- score_name    text           -- matches a column in property_scores
- value         numeric
- reason        text
- created_at    timestamptz default now()
- unique (property_id, score_name)
```

## `hoa_details`

HOA data is decentralized and often incomplete — hence per-field confidence.

```
hoa_details
- property_id        uuid pk -> properties (on delete cascade)
- hoa_exists         boolean        -- null = unknown
- hoa_name           text
- fee_amount         numeric
- fee_frequency      fee_frequency
- amenities          jsonb          -- ["pool","clubhouse","playground","trails","sidewalks"]
- restrictions       jsonb          -- {"rental": "...", "pets": "...", "fences": "..."}
- management_company text
- website            text
- declaration_url    text           -- covenants / CC&Rs
- source_url         text
- confidence_level   confidence_level default 'unknown'
- created_at         timestamptz default now()
- updated_at         timestamptz default now()
```

## `property_features`

Structured output of AI extraction (see `AI_EXTRACTION.md`). Stored as typed
columns where useful + a raw `extraction` jsonb for everything.

```
property_features
- property_id            uuid pk -> properties (on delete cascade)
- family_friendly        jsonb   -- ["cul-de-sac","fenced yard","near playground"]
- walking_features       jsonb   -- ["sidewalks","greenway nearby"]
- work_from_home         jsonb   -- ["dedicated office","bonus room"]
- renovation_risk        jsonb   -- ["older roof not mentioned","dated kitchen"]
- community_amenities    jsonb   -- ["pool","clubhouse","walking trails"]
- concerns               jsonb   -- ["small yard","HOA restrictions unknown"]
- emotional_fit_summary  text
- extraction             jsonb   -- full raw model output for traceability
- model                  text    -- model id used
- extracted_at           timestamptz default now()
```

## `property_notes`

```
property_notes
- id            uuid pk
- property_id   uuid -> properties (on delete cascade)
- note          text not null
- category      note_category default 'general'
- created_at    timestamptz default now()
```

## `scoring_weights`

Per-owner tunable weights so the ranking reflects the user's priorities.

```
scoring_weights
- owner_id      uuid pk -> auth.users
- weights       jsonb   -- { "price": 0.1, "monthly_cost": 0.15, "commute": 0.1, ... }
- updated_at    timestamptz default now()
```

## Relationships

```
auth.users 1───* properties
properties 1───1 property_scores
properties 1───1 hoa_details
properties 1───1 property_features
properties 1───* property_notes
properties 1───* property_field_provenance
properties 1───* score_overrides
auth.users 1───1 scoring_weights
```
