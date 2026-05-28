# Data model

Postgres (Supabase). All rows are owner-scoped via `owner_id` with Row Level
Security so the model is multi-user ready even though the MVP is single-user.
Every enriched field should be paired with a **source** and **confidence** so the
UI can show provenance.

> The fields and enums below are aligned to the owner's
> `house_comparison_scoring_tracker.xlsx` (House Tracker columns, Dropdowns, and
> Weights & Inputs). Scoring uses **7 categories rated 1–5** — see `SCORING.md`.

## Conventions

- `id` — `uuid` primary key, default `gen_random_uuid()`.
- `owner_id` — `uuid` references `auth.users`, RLS `owner_id = auth.uid()`.
- Timestamps — `created_at`, `updated_at` (`timestamptz`, default `now()`).
- Geo — store `location geography(Point, 4326)` for PostGIS radius queries
  (kept alongside plain `latitude` / `longitude` for convenience).
- Enums modeled as Postgres enums (or `text` + check) — listed below.

## Enums

Values match the tracker's *Dropdowns* sheet.

```
property_status : New | Watching | Tour scheduled | Offer candidate
                | Rejected | Under contract | Sold
source_platform : Redfin | Zillow | Realtor.com | MLS/Agent | Other
recommendation  : Strong candidate | Good option | Maybe | Pass
                | Pass / must-have issue | Needs data        -- derived; see SCORING.md
must_have_issue : Yes | No | Maybe
confidence_level: high | medium | low | unknown
fee_frequency   : monthly | quarterly | annual | one_time | unknown
note_category   : general | neighborhood | commute | condition | hoa | financial | visit
```

## `properties`

The clean canonical record every input converts into.

Columns mirror the tracker's *House Tracker* sheet.

```
properties
- id                  uuid pk
- owner_id            uuid -> auth.users
- status              property_status default 'New'
- address             text not null
- community_hoa       text            -- "Community / HOA" name
- city_area           text            -- "City / Area", e.g. "South Charlotte / Ballantyne"
- city                text
- state               text
- zip                 text
- latitude            double precision
- longitude           double precision
- location            geography(Point, 4326)
- listing_url         text            -- user-pasted reference only
- source              source_platform
- mls_number          text
- price               numeric
- beds                numeric
- baths               numeric
- sqft                integer
- lot_acres           numeric         -- "Lot Acres"
- year_built          integer
- hoa_monthly         numeric         -- "HOA Monthly"
- taxes_annual        numeric         -- "Taxes Annual"; if null, est from property_tax_rate
- est_monthly_payment numeric         -- computed; see SCORING.md
- days_on_market      integer
- school_rating       numeric         -- e.g. 0–10
- commute_salisbury_min integer       -- "Commute to Salisbury Min"
- commute_charlotte_min integer       -- "Commute to Charlotte/Uptown Min"
- access_notes        text            -- "Access / Transit Notes"
- amenities_notes     text            -- "Amenities Notes"
- risks_red_flags     text            -- "Risks / Red Flags"
- must_have_issue     must_have_issue default 'No'   -- deal-breaker gate (see SCORING.md)
- property_type       text            -- single_family | townhome | condo | ...
- listing_description text            -- raw text fed to AI extraction
- created_at          timestamptz default now()
- updated_at          timestamptz default now()
```

## `property_field_provenance`

Tracks where each notable field came from and how confident we are. Avoids
widening `properties` with a `_source` / `_confidence` column per field.
Implemented in Phase 2: RentCast enrichment writes one row per field it supplies.

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

## `property_enrichment`

Phase 2 cache of a property-data API response (currently RentCast). One row per
property, refreshed on demand (the "Enrich from RentCast" action), not on every
page load. Record-level fields (beds/sqft/HOA/taxes/...) are written onto
`properties`; this table holds the **derived estimates and comps** plus the raw
payload for traceability.

```
property_enrichment
- property_id     uuid pk -> properties (on delete cascade)
- source          text default 'rentcast'
- value_estimate  numeric        -- AVM value
- value_low       numeric
- value_high      numeric
- rent_estimate   numeric        -- long-term rent AVM
- rent_low        numeric
- rent_high       numeric
- last_sale_price numeric
- last_sale_date  text
- comparables     jsonb          -- [{address, price, sqft, beds, baths, distanceMi, daysOld}]
- raw             jsonb          -- full API payloads (record + value + rent)
- fetched_at      timestamptz default now()
```

## `property_scores`

One row per property: the **seven 1–5 category ratings** plus the derived
weighted score and recommendation. Each rating is an integer 1–5 (or null =
unrated, which counts as 0 in the weighted score — see `SCORING.md`).

```
property_scores
- property_id                 uuid pk -> properties (on delete cascade)
- location_walkability        smallint   -- 1..5   (weight 20)
- community_kids              smallint   -- 1..5   (weight 15)
- layout_family_fit          smallint   -- 1..5   (weight 20)
- schools_childcare          smallint   -- 1..5   (weight 10)
- commute_access             smallint   -- 1..5   (weight 10)
- financial_fit              smallint   -- 1..5   (weight 15)
- condition_risk_resale      smallint   -- 1..5   (weight 10)
- weighted_score             numeric    -- 0..100, = Σ(rating×weight)/Σ(weight)×20
- recommendation             recommendation  -- derived from weighted_score + must_have_issue
- computed_at                timestamptz default now()
```

See `SCORING.md` for the exact formula, the rubric (what each 1–5 means), and
the recommendation bands.

## `score_notes`

Optional free-text rationale per category rating (the rubric encourages a
"why" behind each score). Not in the spreadsheet, but useful in the app.

```
score_notes
- id            uuid pk
- property_id   uuid -> properties (on delete cascade)
- category      text           -- one of the 7 category keys
- note          text
- created_at    timestamptz default now()
- unique (property_id, category)
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

## `scoring_config`

Per-owner tunable category **weights** and financial/commute **inputs** (the
tracker's *Weights & Inputs* sheet). Defaults match the current tracker values.

```
scoring_config
- owner_id      uuid pk -> auth.users
- weights       jsonb   -- { "location_walkability": 20, "community_kids": 15,
                        --   "layout_family_fit": 20, "schools_childcare": 10,
                        --   "commute_access": 10, "financial_fit": 15,
                        --   "condition_risk_resale": 10 }   (sum = 100)
- inputs        jsonb   -- { "max_budget": 650000, "preferred_price": 575000,
                        --   "comfortable_monthly": 4500, "min_bedrooms": 3,
                        --   "down_payment_pct": 0.20, "interest_rate": 0.065,
                        --   "loan_term_years": 30, "property_tax_rate": 0.011,
                        --   "annual_insurance": 1800,
                        --   "target_commute_salisbury_min": 45,
                        --   "target_commute_charlotte_min": 25 }
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
properties 1───1 property_enrichment
properties 1───* score_notes
auth.users 1───1 scoring_config
```
