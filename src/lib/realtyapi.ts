// RealtyAPI (https://www.realtyapi.io) client — turns a pasted Redfin listing URL
// into a structured property record so a house can be created in one step.
// Server-side only: the API key is never shipped to the browser.
//
// Compliance: our app does NOT scrape Redfin. RealtyAPI is a third-party real
// estate data API; we call it server-side and store what it returns (see
// docs/DATA_SOURCES.md). The pasted Redfin link is the lookup key.
//
// Endpoint used:
//   GET https://redfin.realtyapi.io/detailsbyurl?property_url=<redfin property url>
//
// The exact response shape can vary, so — like the RentCast client — the network
// call is kept thin and the field mapping lives in the pure `normalizeRedfin`,
// which reads defensively from many candidate field names and tolerates nesting.
// The base URL and key are env-driven so they can be corrected without a code
// change (REALTYAPI_BASE_URL / REALTYAPI_API_KEY).

import { logInfo, logWarn, logError } from "./log";

const BASE_URL =
  process.env.REALTYAPI_BASE_URL?.replace(/\/$/, "") ||
  "https://redfin.realtyapi.io";

const SQFT_PER_ACRE = 43560;

/** True when a RealtyAPI key is configured (Redfin import is available). */
export function realtyapiConfigured(): boolean {
  return Boolean(process.env.REALTYAPI_API_KEY);
}

/** A loose Redfin URL check so we fail fast on obviously-wrong input. */
export function isRedfinUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return /(^|\.)redfin\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

// --- Normalized output the app stores (mirrors the `properties` columns) ---

export interface RedfinListing {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null; // mapped to single_family | townhome | condo
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotAcres: number | null;
  yearBuilt: number | null;
  hoaMonthly: number | null;
  taxesAnnual: number | null;
  daysOnMarket: number | null;
  mlsNumber: string | null;
  description: string | null;
}

export interface RedfinImport {
  listing: RedfinListing;
  raw: unknown;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  // Strip currency / commas if the API returns formatted strings.
  const n = typeof v === "string" ? Number(v.replace(/[$,]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Candidate "roots" to read fields from: the payload itself plus the common
 * wrapper objects RealtyAPI / Redfin nest details under. Reading across all of
 * them lets `pick` find a field wherever it lives without us hard-coding one
 * exact schema.
 */
function roots(raw: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const add = (v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(v as Record<string, unknown>);
    }
  };
  add(raw);
  const top = (raw ?? {}) as Record<string, unknown>;
  for (const key of [
    "data",
    "result",
    "property",
    "home",
    "listing",
    "details",
    "propertyDetails",
    "homeInfo",
    "aboveTheFold",
    "belowTheFold",
    "addressInfo",
    "address",
  ]) {
    add(top[key]);
  }
  // One level deeper for the most common wrappers.
  for (const key of ["data", "result", "property", "home"]) {
    const inner = top[key] as Record<string, unknown> | undefined;
    if (inner && typeof inner === "object") {
      for (const k2 of ["property", "home", "details", "propertyDetails"]) {
        add(inner[k2]);
      }
    }
  }
  return out;
}

/** First non-null value found across the candidate roots for any of `keys`. */
function pick(rs: Record<string, unknown>[], keys: string[]): unknown {
  for (const r of rs) {
    for (const k of keys) {
      const v = r[k];
      if (v != null && v !== "") return v;
    }
  }
  return undefined;
}

/** Map a free-text Redfin property type onto our three known keys. */
function mapPropertyType(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = s.toLowerCase();
  if (t.includes("town")) return "townhome";
  if (t.includes("condo") || t.includes("co-op") || t.includes("coop"))
    return "condo";
  if (
    t.includes("single") ||
    t.includes("detached") ||
    t.includes("residential")
  )
    return "single_family";
  // Unknown type: keep the original so the user can see/correct it.
  return s;
}

/**
 * Pure mapping from a RealtyAPI Redfin payload to the fields the app stores.
 * Defensive by design (reads many candidate names, tolerates nesting) so a minor
 * schema change doesn't drop data. Kept separate from the network call so it can
 * be unit-tested with fixtures.
 */
export function normalizeRedfin(raw: unknown): RedfinListing {
  const rs = roots(raw);

  const lotAcresDirect = num(
    pick(rs, ["lotSizeAcres", "lotAcres", "lotSizeInAcres"]),
  );
  const lotSqft = num(pick(rs, ["lotSqFt", "lotSize", "lotSizeSqFt", "lotSizeSquareFeet"]));
  const lotAcres =
    lotAcresDirect != null
      ? lotAcresDirect
      : lotSqft != null
        ? Math.round((lotSqft / SQFT_PER_ACRE) * 100) / 100
        : null;

  return {
    address: str(
      pick(rs, [
        "streetAddress",
        "streetLine",
        "addressLine1",
        "line1",
        "fullAddress",
        "formattedAddress",
        "address",
      ]),
    ),
    city: str(pick(rs, ["city", "addressCity"])),
    state: str(pick(rs, ["state", "stateCode", "addressState", "stateOrProvince"])),
    zip: str(pick(rs, ["zip", "zipCode", "postalCode", "zipcode"])),
    latitude: num(pick(rs, ["latitude", "lat"])),
    longitude: num(pick(rs, ["longitude", "lng", "lon", "long"])),
    propertyType: mapPropertyType(
      pick(rs, ["propertyType", "homeType", "type", "propertyTypeName"]),
    ),
    price: num(
      pick(rs, ["price", "listPrice", "listingPrice", "currentPrice", "askingPrice"]),
    ),
    beds: num(pick(rs, ["beds", "numBeds", "bedrooms", "bed", "numBedrooms"])),
    baths: num(pick(rs, ["baths", "numBaths", "bathrooms", "bath", "numBathrooms"])),
    sqft: num(
      pick(rs, [
        "sqFt",
        "sqft",
        "squareFeet",
        "squareFootage",
        "livingArea",
        "finishedSqFt",
      ]),
    ),
    lotAcres,
    yearBuilt: num(pick(rs, ["yearBuilt", "year_built", "yearbuilt"])),
    hoaMonthly: num(
      pick(rs, ["hoaMonthly", "hoaDues", "hoaFee", "hoa", "monthlyHoaFee", "associationFee"]),
    ),
    taxesAnnual: num(
      pick(rs, [
        "taxesAnnual",
        "annualTax",
        "propertyTaxes",
        "taxAnnualAmount",
        "annualTaxAmount",
        "taxes",
      ]),
    ),
    daysOnMarket: num(pick(rs, ["daysOnMarket", "dom", "timeOnRedfin", "daysOnRedfin"])),
    mlsNumber: str(pick(rs, ["mlsId", "mlsNumber", "mls", "mlsNum"])),
    description: str(
      pick(rs, [
        "listingRemarks",
        "publicRemarks",
        "marketingRemarks",
        "remarks",
        "description",
        "homeDescription",
        "listingDescription",
      ]),
    ),
  };
}

/**
 * Look up a Redfin listing by its URL and return the normalized record plus the
 * raw payload (stored for traceability). Throws a useful error on a missing key,
 * a non-OK response, or an empty result so the caller can surface it to the user.
 */
export async function fetchRedfinByUrl(url: string): Promise<RedfinImport> {
  const apiKey = process.env.REALTYAPI_API_KEY;
  if (!apiKey) throw new Error("REALTYAPI_API_KEY is not configured");
  if (!isRedfinUrl(url)) {
    throw new Error("Enter a valid Redfin property URL (redfin.com/...)");
  }

  const endpoint = "/detailsbyurl";
  const path = `${endpoint}?property_url=${encodeURIComponent(url.trim())}`;
  const started = Date.now();
  logInfo("realtyapi", "fetch Redfin details by url", { url });

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "x-realtyapi-key": apiKey, Accept: "application/json" },
      // Import is explicit and we persist the result; never use Next's fetch cache.
      cache: "no-store",
    });
  } catch (err) {
    logError("realtyapi", "network error", { endpoint, error: err });
    throw new Error("RealtyAPI request failed (network error)");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logError("realtyapi", "HTTP error", {
      endpoint,
      status: res.status,
      ms: Date.now() - started,
      body: body ? body.slice(0, 200) : undefined,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("RealtyAPI rejected the key (check REALTYAPI_API_KEY)");
    }
    if (res.status === 404) {
      throw new Error("RealtyAPI couldn't find that Redfin listing");
    }
    throw new Error(`RealtyAPI request failed (${res.status})`);
  }

  const raw = (await res.json().catch(() => null)) as unknown;
  if (!raw || typeof raw !== "object") {
    logWarn("realtyapi", "empty/invalid response body", { endpoint });
    throw new Error("RealtyAPI returned an empty response");
  }

  const listing = normalizeRedfin(raw);
  logInfo("realtyapi", "Redfin details fetched", {
    endpoint,
    ms: Date.now() - started,
    address: listing.address ?? "(none)",
    hasPrice: listing.price != null,
    hasDescription: listing.description != null,
  });
  return { listing, raw };
}
