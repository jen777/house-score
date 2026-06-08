# Data sources & compliance

The defensible, legal foundation of the project. **We do not scrape listing
portals.** Listing links are user-pasted references; enrichment comes from APIs
and public records.

## Hard rules

- **No automated crawling/querying/scraping of Redfin, Zillow, or Realtor.com.**
  Their terms prohibit it. A pasted link is stored only as a human reference, and
  the user confirms the address themselves.
- **Server-side keys only.** All data-provider calls happen server-side; keys are
  never shipped to the browser.
- **Provenance on everything.** Each enriched field stores `source` + `confidence`
  (see `DATA_MODEL.md` → `property_field_provenance`).

## Source options

| Option                          | Best for                                                        | Reality |
| ------------------------------- | --------------------------------------------------------------- | ------- |
| **MLS / IDX / RESO feed**       | Best listing accuracy                                           | Usually requires realtor/broker relationship |
| **MLS Grid via Canopy MLS**     | Charlotte-area MLS data                                         | Best long-term option; partner with an agent |
| **ATTOM API**                   | Property records, ownership, tax, sales history, neighborhood   | Paid; strong enrichment source |
| **RentCast API**                | Property records, value/rent estimates, active listings, comps  | Easiest for prototyping → **Phase 2 first choice** |
| **RealtyAPI (realtyapi.io)**    | One-step listing import from a pasted Redfin URL                 | Third-party data API; powers "Import from Redfin link" |
| **County GIS / public records** | Parcel, zoning, floodplain, tax, ownership, overlays            | Free but fragmented |
| **Manual listing link/text**    | Easy user input + AI extraction                                 | Reference only, never a scraping foundation |

## Phase-by-phase sourcing

- **Phase 1:** Manual address + pasted listing text → AI extraction. No paid APIs.
- **Phase 2:** **RentCast** for records, valuation, comps, active listings, market
  trends. Look up by address (or lat/long). ATTOM added later for richer
  tax/ownership/sales-history. Begin county GIS for parcel/zoning/flood.
- **Phase 3:** MLS-quality data via Canopy MLS / MLS Grid using the **RESO Web
  API** standard (the modern replacement for legacy RETS). Requires a
  member/subscriber relationship and a data-vendor agreement.

## RentCast integration notes (Phase 2 — implemented)

- Lookup key: address (primary). `src/lib/rentcast.ts` calls `/properties`,
  `/avm/value`, and `/avm/rent/long-term`; the AVM/rent calls are optional and a
  404 there is tolerated (the property record alone is still kept).
- Pulled: property record (beds/baths/sqft/lot/year/type/HOA/tax), last sale,
  value & rent estimates, comparables. (Active-listing status / market trends
  are a later add.)
- Each returned record field is mapped onto `properties` and gets a
  `property_field_provenance` row (`source = 'rentcast'`; record fields = `high`,
  AVM value = `medium`). Estimates/comps + the raw payload are cached in
  `property_enrichment`.
- Responses are cached in `property_enrichment` and only refreshed on the
  explicit "Enrich from RentCast" action — never on page load.
- `RENTCAST_API_KEY` is server-side only; with no key the enrich action is
  disabled.

## RealtyAPI / Redfin link import (implemented)

Adding a house can start from a single **Redfin listing URL**: paste the link on
the Add-house page and "Import from Redfin link" pulls a full property record via
[RealtyAPI](https://www.realtyapi.io) and creates the house in one step.

- **We do not scrape Redfin.** RealtyAPI is the third-party provider; our app only
  calls RealtyAPI server-side (the pasted Redfin URL is the lookup key) and stores
  what it returns. This keeps the "no direct portal scraping" rule intact.
- Endpoint: `GET https://redfin.realtyapi.io/detailsbyurl?property_url=<redfin url>`
  with the `x-realtyapi-key` header. `src/lib/realtyapi.ts` keeps the call thin;
  the field mapping lives in the pure, defensively-written `normalizeRedfin`
  (reads many candidate field names and tolerates nesting), and the raw payload
  is kept for traceability.
- Pulled onto the new property: address/city/state/zip, coordinates, price,
  beds/baths, sqft/lot/year, HOA, taxes, MLS #, property type, and the listing
  remarks (stored in `listing_description` so the user can immediately run AI
  extraction). Coordinates are geocoded only as a fallback.
- Each populated field gets a `property_field_provenance` row
  (`source = 'redfin'`, confidence `high`).
- `REALTYAPI_API_KEY` is server-side only; with no key the import is disabled
  (the input/button are greyed out) and houses are still added manually.
  `REALTYAPI_BASE_URL` overrides the API host if needed.

## HOA data — expect partial automation

HOA data is decentralized; there's no clean national source. In North Carolina,
planned communities are generally created by recording a **declaration** in
county land records, and **no state/federal agency oversees HOAs** — so data must
be assembled from listings, county records, HOA sites, management companies, and
disclosure documents.

For each home, attempt to collect (with per-field confidence):

```
HOA
- exists? yes / no / unknown
- monthly/annual fee
- amenities: pool, clubhouse, playground, trails, sidewalks
- community name
- management company
- HOA website
- declaration / covenants link
- rental / architectural / pet / fence / play-structure restrictions
```

Example of how confidence is surfaced:

```
HOA fee: $92/month        source: MLS listing                 confidence: High
Pool/clubhouse: Yes       source: listing + community website confidence: Medium
Rental restrictions: ?    source: not found                   confidence: Low
```

## References

- Redfin Terms of Use — prohibits automated crawling/scraping.
- Canopy MLS IDX program — IDX/Web API data feeds via MLS Grid for members.
- RESO Web API — modern real estate data transport standard (replaces RETS).
- ATTOM Property Data API — address/APN/ID/lat-long lookup; property, tax, sales,
  schools, neighborhood, valuation datasets.
- RentCast API — 140M+ property records, valuations, comps, active listings,
  market trends.
- RealtyAPI (realtyapi.io) — unified real estate data API (Redfin, Zillow,
  Realtor, Airbnb); used here for one-step Redfin-URL listing import.
- NC General Statutes Ch. 47F — Planned Community Act.
- NC DOJ — Homeowners' Associations (no state/federal HOA oversight).
