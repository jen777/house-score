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
// The network call is kept thin; the field mapping lives in the pure
// `normalizeRedfin`, which reads RealtyAPI's nested Redfin shape
// (details.aboveTheFold = listing/marketing, details.belowTheFold.publicRecordsInfo
// = county records) and tolerates missing branches. The base URL and key are
// env-driven so they can be corrected without a code change
// (REALTYAPI_BASE_URL / REALTYAPI_API_KEY).

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
 * Unwrap an undici/fetch failure into log-friendly fields. `fetch failed` is a
 * generic wrapper — the actionable detail (DNS ENOTFOUND, ECONNREFUSED, TLS
 * cert error, ETIMEDOUT) is on `err.cause`, sometimes nested one more level.
 */
function describeFetchError(err: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (err instanceof Error) {
    out.name = err.name;
    out.message = err.message;
  } else {
    out.message = String(err);
  }
  // Walk the cause chain to find the underlying system error.
  let cause: unknown = (err as { cause?: unknown })?.cause;
  for (let depth = 0; cause && depth < 3; depth++) {
    const c = cause as {
      code?: unknown;
      errno?: unknown;
      syscall?: unknown;
      hostname?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (c.code != null) out.cause_code = c.code;
    if (c.errno != null) out.cause_errno = c.errno;
    if (c.syscall != null) out.cause_syscall = c.syscall;
    if (c.hostname != null) out.cause_hostname = c.hostname;
    if (c.message != null && out.cause_message == null)
      out.cause_message = c.message;
    cause = c.cause;
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

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

/** Leading integer from strings like "705000_US_DOLLAR" or "$705,000". */
function leadingNumber(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).replace(/[$,]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** "3,000 sq ft" → acres; "0.72 Acres" → acres. */
function lotTextToAcres(text: unknown): number | null {
  const s = str(text);
  if (!s) return null;
  const n = leadingNumber(s);
  if (n == null) return null;
  return /acre/i.test(s) ? n : Math.round((n / SQFT_PER_ACRE) * 100) / 100;
}

/** Pull the subject lat/lng out of a WalkScore deep-link, e.g. ".../lat=40.7/lng=-73.7?..." */
function latLngFromWalkScore(link: unknown): { lat: number | null; lng: number | null } {
  const s = str(link);
  if (!s) return { lat: null, lng: null };
  const lat = s.match(/lat=(-?\d+(?:\.\d+)?)/);
  const lng = s.match(/lng=(-?\d+(?:\.\d+)?)/);
  return { lat: lat ? Number(lat[1]) : null, lng: lng ? Number(lng[1]) : null };
}

/** Build a street address from Redfin's structured propertyAddress parts. */
function buildStreet(a: Obj): string | null {
  const parts = [
    a.streetNumber,
    a.directionalPrefix,
    a.streetName,
    a.streetType,
    a.directionalSuffix,
  ]
    .map((p) => str(p))
    .filter(Boolean);
  const base = parts.join(" ").trim();
  const unit = str(a.unitValue)
    ? `${str(a.unitType) || "Unit"} ${str(a.unitValue)}`
    : "";
  return [base, unit].filter(Boolean).join(" ") || null;
}

/**
 * Pure mapping from RealtyAPI's Redfin `detailsbyurl` payload to the fields the
 * app stores. The response nests data under `details.aboveTheFold` (listing /
 * marketing) and `details.belowTheFold.publicRecordsInfo` (county records), so we
 * read the authoritative public record first and fall back to the listing. Kept
 * separate from the network call so it can be tested with fixtures.
 */
export function normalizeRedfin(raw: unknown): RedfinListing {
  const root = obj(raw);
  const details = obj(root.details ?? root);
  const atf = obj(details.aboveTheFold);
  const btf = obj(details.belowTheFold);
  const main = obj(atf.mainHouseInfo);
  const panelMain = obj(obj(details.mainHouseInfoPanelInfo).mainHouseInfo);

  const pub = obj(btf.publicRecordsInfo);
  const basic = obj(pub.basicInfo);
  const latest = obj(pub.latestListingInfo);
  const taxInfo = obj(pub.taxInfo);
  const pubAddr = obj(pub.addressInfo);
  const addr = obj(main.propertyAddress ?? panelMain.propertyAddress);

  // selectedAmenities is a flat [{header, content}] list (Style, MLS#, Built…).
  const amenity: Record<string, string> = {};
  for (const a of (main.selectedAmenities ?? []) as Obj[]) {
    const h = str(a?.header);
    const c = str(a?.content);
    if (h && c) amenity[h.toLowerCase()] = c;
  }

  const description =
    str(obj((main.marketingRemarks ?? [])[0]).marketingRemark) ??
    str(obj((panelMain.marketingRemarks ?? [])[0]).marketingRemark);

  const street =
    str(panelMain.streetAddress) ?? buildStreet(addr) ?? str(pubAddr.street);

  const { lat, lng } = latLngFromWalkScore(
    obj(obj(obj(details.neighborhoodStats).walkScoreData).walkScore).link,
  );

  // Lot: prefer the numeric public record, else parse the amenity text.
  const lotSqft = num(basic.lotSqFt ?? latest.lotSqFt);
  const lotAcres =
    lotSqft != null
      ? Math.round((lotSqft / SQFT_PER_ACRE) * 100) / 100
      : lotTextToAcres(amenity["lot size"]);

  // Price: the listing price (e.g. "705000_US_DOLLAR"); fall back to last sold.
  const price =
    leadingNumber(obj(details.customerConversionInfo).listingPrice) ??
    leadingNumber(obj(details.agenInfo).listingPrice) ??
    num(obj(obj(obj(details.avm).__root).avmInfo).lastSoldPrice);

  return {
    address: street,
    city: str(addr.city ?? pubAddr.city),
    state: str(addr.stateOrProvinceCode ?? pubAddr.state),
    zip: str(addr.postalCode ?? pubAddr.zip),
    latitude: lat,
    longitude: lng,
    propertyType: mapPropertyType(
      basic.propertyTypeName ?? latest.propertyTypeName ?? amenity["property type"],
    ),
    price,
    beds: num(latest.beds ?? basic.beds),
    baths: num(latest.baths ?? basic.baths),
    sqft: num(basic.totalSqFt ?? latest.sqFt ?? basic.sqFtFinished),
    lotAcres,
    yearBuilt: num(basic.yearBuilt ?? latest.yearBuilt ?? amenity["built"]),
    hoaMonthly: num(main.monthlyHoaDues ?? main.hoaDues),
    taxesAnnual: num(taxInfo.taxesDue),
    daysOnMarket: null,
    mlsNumber: str(main.mlsId ?? panelMain.mlsId ?? amenity["mls#"]),
    description,
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
  const target = `${BASE_URL}${path}`;
  let host: string | undefined;
  try {
    host = new URL(BASE_URL).host;
  } catch {
    host = undefined;
  }
  const started = Date.now();
  logInfo("realtyapi", "fetch Redfin details by url", {
    url,
    baseUrl: BASE_URL,
    host,
    keyLen: apiKey.length,
  });

  // Time-box the request so a hung connection surfaces as a clear timeout
  // rather than appearing to silently stall.
  const controller = new AbortController();
  const timeoutMs = 20_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(target, {
      headers: { "x-realtyapi-key": apiKey, Accept: "application/json" },
      // Import is explicit and we persist the result; never use Next's fetch cache.
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = controller.signal.aborted;
    logError("realtyapi", aborted ? "request timed out" : "network error", {
      endpoint,
      host,
      baseUrl: BASE_URL,
      ms: Date.now() - started,
      timeoutMs: aborted ? timeoutMs : undefined,
      ...describeFetchError(err),
    });
    if (aborted) {
      throw new Error(
        `RealtyAPI request timed out after ${timeoutMs / 1000}s (host ${host})`,
      );
    }
    throw new Error(
      `RealtyAPI request failed to reach ${host} (network error)`,
    );
  } finally {
    clearTimeout(timer);
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
