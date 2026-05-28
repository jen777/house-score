// RentCast API client (Phase 2 enrichment). Server-side only — the API key is
// never shipped to the browser. See docs/DATA_SOURCES.md (we do NOT scrape
// listing portals; RentCast is a licensed property-data API) and docs/ROADMAP.md.
//
// Endpoints used (https://api.rentcast.io/v1):
//   GET /properties?address=...          property record (beds/baths/sqft/lot/year/type/tax/HOA/last sale)
//   GET /avm/value?address=...           value estimate + comparable sales
//   GET /avm/rent/long-term?address=...  long-term rent estimate
//
// The network call (`enrichByAddress`) is kept thin; the field mapping lives in
// the pure `normalizeRentcast` so it can be unit-tested without the API.

const BASE_URL =
  process.env.RENTCAST_BASE_URL?.replace(/\/$/, "") ||
  "https://api.rentcast.io/v1";

const SQFT_PER_ACRE = 43560;

/** True when a RentCast API key is configured (enrichment is available). */
export function rentcastConfigured(): boolean {
  return Boolean(process.env.RENTCAST_API_KEY);
}

// --- Shapes returned by RentCast (loosely typed; we read defensively) ---

export interface RentcastRecord {
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  squareFootage?: number | null;
  lotSize?: number | null; // square feet
  yearBuilt?: number | null;
  hoa?: { fee?: number | null } | null;
  // Keyed by year, e.g. { "2023": { year: 2023, total: 4200 } }.
  propertyTaxes?: Record<string, { year?: number; total?: number }> | null;
  lastSalePrice?: number | null;
  lastSaleDate?: string | null;
}

export interface RentcastAvm {
  price?: number | null;
  priceRangeLow?: number | null;
  priceRangeHigh?: number | null;
  rent?: number | null;
  rentRangeLow?: number | null;
  rentRangeHigh?: number | null;
  comparables?: RentcastComparableRaw[] | null;
}

export interface RentcastComparableRaw {
  id?: string;
  formattedAddress?: string;
  price?: number | null;
  squareFootage?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  distance?: number | null;
  daysOld?: number | null;
  correlation?: number | null;
}

// --- Normalized output the app stores ---

export interface NormalizedRecord {
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotAcres: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  hoaMonthly: number | null;
  taxesAnnual: number | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  lastSalePrice: number | null;
  lastSaleDate: string | null;
}

export interface NormalizedComparable {
  address: string | null;
  price: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  distanceMi: number | null;
  daysOld: number | null;
}

export interface RentcastEnrichment {
  record: NormalizedRecord;
  valuation: {
    value: number | null;
    valueLow: number | null;
    valueHigh: number | null;
  };
  rent: {
    rent: number | null;
    rentLow: number | null;
    rentHigh: number | null;
  };
  comparables: NormalizedComparable[];
  raw: {
    record: RentcastRecord | null;
    value: RentcastAvm | null;
    rent: RentcastAvm | null;
  };
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Most recent annual property-tax total from the year-keyed map. */
function latestTaxTotal(
  taxes: RentcastRecord["propertyTaxes"],
): number | null {
  if (!taxes) return null;
  const years = Object.keys(taxes).sort();
  for (let i = years.length - 1; i >= 0; i--) {
    const total = num(taxes[years[i]]?.total);
    if (total != null) return total;
  }
  return null;
}

/**
 * Pure mapping from RentCast payloads to the fields the app stores. Kept
 * separate from the network call so it can be tested with fixtures.
 */
export function normalizeRentcast(
  record: RentcastRecord | null,
  value: RentcastAvm | null,
  rent: RentcastAvm | null,
): RentcastEnrichment {
  const lotSqft = num(record?.lotSize);
  return {
    record: {
      beds: num(record?.bedrooms),
      baths: num(record?.bathrooms),
      sqft: num(record?.squareFootage),
      lotAcres:
        lotSqft != null ? Math.round((lotSqft / SQFT_PER_ACRE) * 100) / 100 : null,
      yearBuilt: num(record?.yearBuilt),
      propertyType: str(record?.propertyType),
      hoaMonthly: num(record?.hoa?.fee),
      taxesAnnual: latestTaxTotal(record?.propertyTaxes),
      city: str(record?.city),
      state: str(record?.state),
      zip: str(record?.zipCode),
      latitude: num(record?.latitude),
      longitude: num(record?.longitude),
      lastSalePrice: num(record?.lastSalePrice),
      lastSaleDate: str(record?.lastSaleDate),
    },
    valuation: {
      value: num(value?.price),
      valueLow: num(value?.priceRangeLow),
      valueHigh: num(value?.priceRangeHigh),
    },
    rent: {
      rent: num(rent?.rent),
      rentLow: num(rent?.rentRangeLow),
      rentHigh: num(rent?.rentRangeHigh),
    },
    comparables: (value?.comparables ?? []).slice(0, 8).map((c) => ({
      address: str(c.formattedAddress),
      price: num(c.price),
      sqft: num(c.squareFootage),
      beds: num(c.bedrooms),
      baths: num(c.bathrooms),
      distanceMi: num(c.distance),
      daysOld: num(c.daysOld),
    })),
    raw: { record: record ?? null, value: value ?? null, rent: rent ?? null },
  };
}

/** GET a RentCast endpoint; returns parsed JSON or throws a useful error. */
async function get<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    // Enrichment is explicit and cached in our DB; never use Next's fetch cache.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `RentCast ${path.split("?")[0]} failed (${res.status})${
        body ? `: ${body.slice(0, 200)}` : ""
      }`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Look up a property by address and return normalized enrichment. The three
 * calls are independent, so we run them together and tolerate the AVM/rent
 * endpoints 404ing (RentCast returns 404 when it can't model a value) — the
 * property record alone is still worth keeping.
 */
export async function enrichByAddress(
  address: string,
): Promise<RentcastEnrichment> {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) throw new Error("RENTCAST_API_KEY is not configured");

  const q = `address=${encodeURIComponent(address)}`;

  // /properties returns an array; take the first (best) match.
  const records = await get<RentcastRecord[]>(`/properties?${q}`, apiKey);
  const record = Array.isArray(records) ? records[0] ?? null : null;
  if (!record) {
    throw new Error(`RentCast found no property record for "${address}"`);
  }

  const optional = async (path: string): Promise<RentcastAvm | null> => {
    try {
      return await get<RentcastAvm>(path, apiKey);
    } catch {
      return null; // AVM/rent unavailable for this address — not fatal.
    }
  };

  const [value, rent] = await Promise.all([
    optional(`/avm/value?${q}`),
    optional(`/avm/rent/long-term?${q}`),
  ]);

  return normalizeRentcast(record, value, rent);
}
