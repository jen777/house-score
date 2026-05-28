# AI extraction (Claude)

Feed a listing description into Claude and get back **structured features** that
populate `property_features` and feed the scoring engine.

## Where it runs

- Server-side only (Route Handler / Server Action). `ANTHROPIC_API_KEY` never
  reaches the client.
- Use the Anthropic SDK with **tool use / structured output** so the model
  returns validated JSON rather than prose.
- Use **prompt caching** on the static system prompt + schema to cut cost when
  extracting many listings in a session.

## Input

```json
{
  "address": "optional, for context",
  "listing_text": "the pasted listing description / remarks",
  "property_type": "optional hint: single_family | townhome | condo"
}
```

## Output schema

```json
{
  "family_friendly_features": ["cul-de-sac", "fenced yard", "near playground"],
  "walking_features": ["sidewalks", "greenway nearby", "walkable community"],
  "work_from_home": ["dedicated office", "bonus room"],
  "renovation_risk": ["older roof not mentioned", "dated kitchen"],
  "community_amenities": ["pool", "clubhouse", "walking trails"],
  "concerns": ["small yard", "HOA restrictions unknown"],
  "hoa_signals": {
    "hoa_mentioned": true,
    "fee_text": "$92/month",
    "amenities": ["pool", "clubhouse"],
    "restrictions_mentioned": ["rental restrictions unclear"]
  },
  "emotional_fit_summary": "Good family-friendly option if HOA and commute check out.",
  "extracted_numeric_hints": {
    "beds": 4,
    "baths": 2.5,
    "sqft": 2400,
    "year_built": 2015,
    "lot_size_text": "0.25 acres"
  }
}
```

## Extraction principles

- **Extract, don't invent.** If the listing doesn't state something, return it as
  a *concern* or omit it — never fabricate a number. Numeric hints are
  best-effort and always overridable by the user / API enrichment.
- **Separate signals from facts.** `hoa_signals` and `extracted_numeric_hints`
  are *hints*; authoritative values come from the API (Phase 2) or user. Provenance
  is recorded in `property_field_provenance` with `source = 'listing'`,
  confidence usually `low`/`medium`.
- **Map to the 7 scoring categories.** The model can propose a **1–5 rating**
  per category (using the rubric in `SCORING.md`), which the user confirms or
  overrides. Extracted lists feed:
  - `walking_features` + location cues → **Location / walkability**
  - `community_amenities` + `hoa_signals` → **Community / kids amenities**
  - `family_friendly_features` (beds/layout/yard/WFH) → **House layout / family fit**
  - school/childcare mentions → **Schools / childcare fit**
  - access/commute mentions → **Commute / access**
  - price/HOA/tax signals → **Financial fit**
  - `renovation_risk` + condition cues → **Condition / risk / resale**
  - `concerns` / red flags → surfaced as flags; a hard deal-breaker should set
    the property's `must_have_issue = Yes` (which forces a "Pass", see SCORING.md)
  - Proposed ratings are **suggestions only** with low confidence; the rubric is
    subjective and the user makes the final call.
- **Store the raw output** in `property_features.extraction` for traceability,
  plus the `model` id used.
- **Validate** the JSON against the schema before persisting; on failure, store
  the error and let the user retry / edit manually.

## Suggested prompt shape

- **System:** role = real-estate listing analyst; rules = extract only what's
  stated, flag uncertainty as concerns, never invent numbers, output via the
  provided tool/schema. (Cache this.)
- **User:** the listing text (+ optional address/type context).
- **Tool:** `record_listing_features` with the JSON schema above; force the model
  to call it so output is structured.

## Cost / UX notes

- One extraction per property add (and on-demand "re-extract" if text changes).
- Show the user the extracted result and let them edit before it's committed —
  the AI proposes, the user disposes.
