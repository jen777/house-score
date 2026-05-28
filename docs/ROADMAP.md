# Roadmap

Build in three phases. Don't overbuild Phase 1 — prove the decision layer first.

---

## Phase 1 — Personal tracker with AI extraction

**Goal:** A working personal tool where you can add homes, capture the listing
text, get AI-extracted features, compute scores, and compare candidates. No
paid external APIs required yet.

### MVP features

1. **Add a house** by address, or by pasting a listing link + listing text.
   - Paste Redfin / Zillow / Realtor.com link (stored as a reference only).
   - Paste the listing description text (the AI input).
   - Manual address entry / upload screenshot text.
2. **Store** listing URL, source platform, and key details in one clean record.
3. **AI extraction:** paste listing description → Claude extracts structured
   features, amenities, concerns, and an emotional-fit summary.
4. **Auto-fill** features and concerns from the extraction, with manual override.
5. **Scoring:** rate 7 categories 1–5 (AI can propose, user confirms) → Weighted
   Score out of 100 → Recommendation. See `SCORING.md`.
6. **Manual override** of any rating and any extracted field; `must_have_issue`
   flag forces a Pass.
7. **Compare** top houses side by side.
8. **Status tracking:** New → Watching → Tour scheduled → Offer candidate →
   Rejected → Under contract → Sold.
9. **Map** of saved communities (Mapbox/Google).
10. **Notes** per property, categorized.

### Phase 1 acceptance criteria

- Add a property with only an address + pasted listing text.
- AI extraction returns structured JSON and populates fields.
- A total weighted score is computed and is recomputed on manual override.
- Side-by-side comparison of 2–4 properties.
- Status changes persist.

### Explicitly out of scope for Phase 1

- Any paid property-data API.
- Live listing sync / scraping (never).
- MLS feeds.
- Multi-user / sharing beyond a single owner account.

---

## Phase 2 — API enrichment

**Goal:** Reduce manual entry by enriching from a legal property-data API.

- ✅ Integrate **RentCast** first: property records, value/rent estimates, comps.
  (Active-listing status / market trends and **ATTOM** are later upgrades for
  richer tax/ownership/sales-history data.)
- ✅ "Enrich from RentCast" on the property detail page calls the API by address
  and backfills: beds/baths, sqft, lot size, year built, property type, HOA,
  tax, plus value/rent estimates and comps. (List price is never overwritten —
  it's the user's reference, not an AVM.)
- ✅ **Confidence levels** on every enriched field, with the source surfaced in
  the UI (`property_field_provenance`: record fields = high, AVM value = medium).
- ⏳ **County GIS / public records** (parcel, zoning, floodplain) — deferred to a
  later slice; sources are fragmented and county-specific.

### Phase 2 acceptance criteria

- ✅ Enriching an address auto-populates record fields from RentCast.
- ✅ Each enriched field shows source + confidence.
- ✅ Valuation and comps surface on the property detail page.

### How the RentCast enrichment is wired

- `src/lib/rentcast.ts` — server-side client (`RENTCAST_API_KEY`); thin network
  call `enrichByAddress()` + a pure `normalizeRentcast()` mapping (unit-testable).
- `enrichPropertyAction` (`src/app/actions.ts`) — overwrites record fields where
  data exists, upserts `property_enrichment` (value/rent/comps + raw), writes
  `property_field_provenance`, then re-runs `recomputeProperty` (enriched
  HOA/taxes flow into the Estimated Monthly Payment).
- Detail page renders the value/rent/last-sale + comparables table and a
  source/confidence badge on each enriched fact.

---

## Phase 3 — MLS-quality data

**Goal:** Current, accurate listing data, legally.

- Partner with a local realtor/brokerage.
- Explore **Canopy MLS / MLS Grid** access (Charlotte region) via the
  **RESO Web API** standard. Access generally requires a member/subscriber
  relationship and a data-vendor agreement.
- Map MLS fields into the existing data model; treat MLS as the
  highest-confidence source where available.

---

## Suggested build order within Phase 1

1. Repo scaffold (Next.js + Supabase client, env config).
2. Database schema + migrations (see `DATA_MODEL.md`).
3. Property CRUD + list view + detail view.
4. AI extraction endpoint (Claude) + "extract from description" action.
5. Scoring engine (pure functions, unit-tested) — see `SCORING.md`.
6. Category rating UI (7 categories, 1–5) + recompute of weighted score,
   recommendation, and estimated monthly payment.
7. Comparison view.
8. Map view.
9. Status workflow + notes.
