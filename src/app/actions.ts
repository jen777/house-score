"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  properties,
  propertyFeatures,
  propertyNotes,
  propertyScores,
  propertyEnrichment,
  propertyFieldProvenance,
  propertyDriveTimes,
  hoaDetails,
  places,
  scoreNotes,
} from "@/db/schema";
import { AUTH_COOKIE, verifyPassword, expectedToken } from "@/lib/auth";
import {
  extractListingFeatures,
  suggestCategoryRatings,
  formatMarketData,
  type PropertyMarketData,
} from "@/lib/ai";
import { researchHoa } from "@/lib/hoa";
import { persistHoaResearch } from "@/lib/hoa-persist";
import { geocode, formatAddress } from "@/lib/geocode";
import { driveTimes } from "@/lib/drivetime";
import { logInfo, logWarn, logError } from "@/lib/log";
import {
  enrichByAddress,
  normalizeRentcast,
  type RentcastEnrichment,
} from "@/lib/rentcast";
import {
  fetchRedfinByUrl,
  isRedfinUrl,
  type RedfinListing,
} from "@/lib/realtyapi";
import {
  recomputeProperty,
  getScoringConfig,
  SCORE_COLUMN,
} from "@/lib/recompute";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  type CategoryKey,
  type ScoringInputs,
} from "@/lib/scoring";

// ---- Auth ----

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/") || "/";
  if (!(await verifyPassword(password))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  const token = await expectedToken();
  (await cookies()).set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next.startsWith("/") ? next : "/");
}

export async function logoutAction() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}

// ---- Properties ----

function strOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function intOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : Math.round(n);
}

// Fields shared by create + update (everything except address/status).
function propertyFieldsFromForm(formData: FormData) {
  return {
    communityHoa: strOrNull(formData.get("communityHoa")),
    cityArea: strOrNull(formData.get("cityArea")),
    city: strOrNull(formData.get("city")),
    state: strOrNull(formData.get("state")),
    zip: strOrNull(formData.get("zip")),
    listingUrl: strOrNull(formData.get("listingUrl")),
    source: strOrNull(formData.get("source")),
    mlsNumber: strOrNull(formData.get("mlsNumber")),
    price: strOrNull(formData.get("price")),
    beds: strOrNull(formData.get("beds")),
    baths: strOrNull(formData.get("baths")),
    sqft: intOrNull(formData.get("sqft")),
    lotAcres: strOrNull(formData.get("lotAcres")),
    yearBuilt: intOrNull(formData.get("yearBuilt")),
    hoaMonthly: strOrNull(formData.get("hoaMonthly")),
    taxesAnnual: strOrNull(formData.get("taxesAnnual")),
    daysOnMarket: intOrNull(formData.get("daysOnMarket")),
    schoolRating: strOrNull(formData.get("schoolRating")),
    schoolElementary: strOrNull(formData.get("schoolElementary")),
    schoolMiddle: strOrNull(formData.get("schoolMiddle")),
    schoolHigh: strOrNull(formData.get("schoolHigh")),
    commuteSalisburyMin: intOrNull(formData.get("commuteSalisburyMin")),
    commuteCharlotteMin: intOrNull(formData.get("commuteCharlotteMin")),
    accessNotes: strOrNull(formData.get("accessNotes")),
    amenitiesNotes: strOrNull(formData.get("amenitiesNotes")),
    risksRedFlags: strOrNull(formData.get("risksRedFlags")),
    mustHaveIssue: String(formData.get("mustHaveIssue") ?? "No"),
    propertyType: strOrNull(formData.get("propertyType")),
    listingDescription: strOrNull(formData.get("listingDescription")),
  };
}

export async function createPropertyAction(formData: FormData) {
  const address = String(formData.get("address") ?? "").trim();
  if (!address) redirect("/properties/new?error=address");

  const fields = propertyFieldsFromForm(formData);
  const coords = await geocode({
    address,
    city: fields.city,
    state: fields.state,
    zip: fields.zip,
  });

  const [row] = await db
    .insert(properties)
    .values({
      address,
      status: "New",
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      ...fields,
    })
    .returning({ id: properties.id });

  await recomputeProperty(row.id);
  revalidatePath("/");
  revalidatePath("/map");
  redirect(`/properties/${row.id}`);
}

/**
 * Create a house in one step from a pasted Redfin listing URL, via RealtyAPI.
 * Pulls the full property record (price, beds/baths, sqft/lot/year, HOA, taxes,
 * MLS #, coordinates, listing remarks), inserts the property, records per-field
 * provenance (source = 'redfin'), and falls back to geocoding only when RealtyAPI
 * didn't return coordinates. The listing remarks land in `listing_description`
 * so the user can immediately run AI extraction. On any failure the user is sent
 * back to the add page with the error so they can retry or add manually.
 */
export async function createFromRedfinAction(formData: FormData) {
  const url = String(formData.get("redfinUrl") ?? "").trim();
  if (!url) redirect("/properties/new?error=redfin-url");
  if (!isRedfinUrl(url)) redirect("/properties/new?error=redfin-url");

  let listing: RedfinListing | undefined;
  try {
    ({ listing } = await fetchRedfinByUrl(url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Redfin import failed";
    logError("realtyapi", "Redfin import failed", { url, error: err });
    redirect(`/properties/new?error=${encodeURIComponent(msg)}`);
  }

  if (!listing!.address) {
    logWarn("realtyapi", "Redfin import returned no address", { url });
    redirect(
      `/properties/new?error=${encodeURIComponent(
        "RealtyAPI returned no address for that listing",
      )}`,
    );
  }

  // RealtyAPI usually returns coordinates; geocode only as a fallback.
  let latitude = listing!.latitude;
  let longitude = listing!.longitude;
  if (latitude == null || longitude == null) {
    const coords = await geocode({
      address: listing!.address!,
      city: listing!.city,
      state: listing!.state,
      zip: listing!.zip,
    });
    latitude = coords?.latitude ?? null;
    longitude = coords?.longitude ?? null;
  }

  const intRound = (v: number | null): number | null =>
    v == null ? null : Math.round(v);

  const [row] = await db
    .insert(properties)
    .values({
      address: listing!.address!,
      status: "New",
      source: "Redfin",
      listingUrl: url,
      city: listing!.city,
      state: listing!.state,
      zip: listing!.zip,
      latitude,
      longitude,
      propertyType: listing!.propertyType,
      price: numStr(listing!.price),
      beds: numStr(listing!.beds),
      baths: numStr(listing!.baths),
      sqft: intRound(listing!.sqft),
      lotAcres: numStr(listing!.lotAcres),
      yearBuilt: intRound(listing!.yearBuilt),
      hoaMonthly: numStr(listing!.hoaMonthly),
      taxesAnnual: numStr(listing!.taxesAnnual),
      daysOnMarket: intRound(listing!.daysOnMarket),
      schoolRating: numStr(listing!.schoolRating),
      schoolElementary: numStr(listing!.schoolElementary),
      schoolMiddle: numStr(listing!.schoolMiddle),
      schoolHigh: numStr(listing!.schoolHigh),
      mlsNumber: listing!.mlsNumber,
      listingDescription: listing!.description,
    })
    .returning({ id: properties.id });

  // Provenance: one row per field RealtyAPI actually populated (high confidence
  // on listed facts; the listing remarks are listing-sourced).
  const provFields: { field: string; value: unknown }[] = [
    { field: "price", value: listing!.price },
    { field: "beds", value: listing!.beds },
    { field: "baths", value: listing!.baths },
    { field: "sqft", value: listing!.sqft },
    { field: "lot_acres", value: listing!.lotAcres },
    { field: "year_built", value: listing!.yearBuilt },
    { field: "hoa_monthly", value: listing!.hoaMonthly },
    { field: "taxes_annual", value: listing!.taxesAnnual },
    { field: "property_type", value: listing!.propertyType },
    { field: "school_rating", value: listing!.schoolRating },
    { field: "mls_number", value: listing!.mlsNumber },
  ];
  for (const p of provFields) {
    if (p.value == null) continue;
    await db.insert(propertyFieldProvenance).values({
      propertyId: row.id,
      fieldName: p.field,
      source: "redfin",
      confidence: "high",
      capturedAt: new Date(),
    });
  }

  logInfo("realtyapi", "house created from Redfin import", {
    id: row.id,
    address: listing!.address,
    hasPrice: listing!.price != null,
    hasDescription: listing!.description != null,
  });

  await recomputeProperty(row.id);
  revalidatePath("/");
  revalidatePath("/map");
  redirect(`/properties/${row.id}`);
}

export async function updatePropertyAction(formData: FormData) {
  const id = String(formData.get("id"));
  const address = String(formData.get("address") ?? "").trim();
  const fields = propertyFieldsFromForm(formData);

  // Re-geocode only when an address part changed or coordinates are missing,
  // to avoid spending a geocoding call on every edit.
  const [existing] = await db
    .select({
      address: properties.address,
      city: properties.city,
      state: properties.state,
      zip: properties.zip,
      latitude: properties.latitude,
      longitude: properties.longitude,
    })
    .from(properties)
    .where(eq(properties.id, id));

  const addressChanged =
    !existing ||
    existing.address !== address ||
    existing.city !== fields.city ||
    existing.state !== fields.state ||
    existing.zip !== fields.zip;
  const needsCoords = existing?.latitude == null || existing?.longitude == null;

  const coordsPatch: { latitude?: number | null; longitude?: number | null } =
    {};
  if (addressChanged || needsCoords) {
    const coords = await geocode({
      address,
      city: fields.city,
      state: fields.state,
      zip: fields.zip,
    });
    coordsPatch.latitude = coords?.latitude ?? null;
    coordsPatch.longitude = coords?.longitude ?? null;
  }

  await db
    .update(properties)
    .set({
      address,
      ...fields,
      ...coordsPatch,
      updatedAt: new Date(),
    })
    .where(eq(properties.id, id));

  await recomputeProperty(id);
  revalidatePath(`/properties/${id}`);
  revalidatePath("/");
  revalidatePath("/map");
}

export async function deletePropertyAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.delete(properties).where(eq(properties.id, id));
  revalidatePath("/");
  redirect("/");
}

/**
 * Archive a house: hide it from the main list, comparison, and map (e.g. it sold
 * before you could act). It stays in the DB and shows on the Archived page, where
 * it can be restored. Non-destructive — use deletePropertyAction to remove for good.
 */
export async function archivePropertyAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db
    .update(properties)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(properties.id, id));
  revalidatePath("/");
  revalidatePath("/archived");
  revalidatePath(`/properties/${id}`);
  redirect("/archived");
}

/** Restore an archived house back to the active list. */
export async function unarchivePropertyAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db
    .update(properties)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(properties.id, id));
  revalidatePath("/");
  revalidatePath("/archived");
  revalidatePath(`/properties/${id}`);
  redirect(`/properties/${id}`);
}

export async function updateStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await db
    .update(properties)
    .set({ status, updatedAt: new Date() })
    .where(eq(properties.id, id));
  revalidatePath(`/properties/${id}`);
  revalidatePath("/");
}

// ---- AI extraction ----

/**
 * Build the RentCast facts block for a property from its cached enrichment, so
 * the AI extraction can reason over real property data. Reconstructs the
 * normalized enrichment from the stored raw payload (the single source of truth);
 * returns undefined when the property hasn't been enriched yet.
 */
async function loadMarketData(
  propertyId: string,
): Promise<PropertyMarketData | undefined> {
  const [row] = await db
    .select()
    .from(propertyEnrichment)
    .where(eq(propertyEnrichment.propertyId, propertyId));
  if (!row?.raw) return undefined;

  const raw = row.raw as RentcastEnrichment["raw"];
  const e = normalizeRentcast(raw.record, raw.value, raw.rent);
  return {
    beds: e.record.beds,
    baths: e.record.baths,
    sqft: e.record.sqft,
    lotAcres: e.record.lotAcres,
    yearBuilt: e.record.yearBuilt,
    propertyType: e.record.propertyType,
    hoaMonthly: e.record.hoaMonthly,
    taxesAnnual: e.record.taxesAnnual,
    lastSalePrice: e.record.lastSalePrice,
    lastSaleDate: e.record.lastSaleDate,
    valueEstimate: e.valuation.value,
    valueLow: e.valuation.valueLow,
    valueHigh: e.valuation.valueHigh,
    rentEstimate: e.rent.rent,
    rentLow: e.rent.rentLow,
    rentHigh: e.rent.rentHigh,
    comparables: e.comparables.map((c) => ({
      address: c.address,
      price: c.price,
      sqft: c.sqft,
      beds: c.beds,
      baths: c.baths,
      distanceMi: c.distanceMi,
      daysOld: c.daysOld,
    })),
  };
}

export async function extractAction(formData: FormData) {
  const id = String(formData.get("id"));
  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, id));
  if (!prop?.listingDescription) {
    redirect(`/properties/${id}?error=no-description`);
  }

  // If the property has been enriched, feed the RentCast facts to the model so it
  // can ground its analysis in real data instead of the seller's marketing copy.
  const marketData = await loadMarketData(id);
  if (marketData) {
    logInfo("extract", "including RentCast market data in extraction", { id });
  }

  try {
    const { data, model } = await extractListingFeatures({
      listingText: prop!.listingDescription!,
      address: prop!.address,
      propertyType: prop!.propertyType ?? undefined,
      marketData,
    });

    const values = {
      familyFriendly: data.family_friendly_features,
      walkingFeatures: data.walking_features,
      workFromHome: data.work_from_home,
      renovationRisk: data.renovation_risk,
      communityAmenities: data.community_amenities,
      concerns: data.concerns,
      emotionalFitSummary: data.emotional_fit_summary,
      extraction: data,
      model,
      extractedAt: new Date(),
    };

    await db
      .insert(propertyFeatures)
      .values({ propertyId: id, ...values })
      .onConflictDoUpdate({
        target: propertyFeatures.propertyId,
        set: values,
      });

    await recomputeProperty(id);
    revalidatePath(`/properties/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "extraction failed";
    logError("extract", "listing feature extraction failed", { id, error: e });
    redirect(`/properties/${id}?error=${encodeURIComponent(msg)}`);
  }
}

// ---- HOA validator (Phase 2) ----

/**
 * Research the HOA that governs a property and store the structured review in
 * hoa_details. Uses the Anthropic web-search tool to gather ratings, rules,
 * fees, amenities and resident sentiment, then synthesizes an overall verdict.
 * Needs a full, geocodable address (composed the same way geocoding does).
 */
export async function researchHoaAction(formData: FormData) {
  const id = String(formData.get("id"));
  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, id));
  if (!prop) redirect("/");
  if (!prop!.address?.trim()) {
    redirect(`/properties/${id}?error=no-address`);
  }

  try {
    const fullAddress = formatAddress({
      address: prop!.address,
      city: prop!.city,
      state: prop!.state,
      zip: prop!.zip,
    });

    const { data, model } = await researchHoa({
      address: fullAddress,
      hoaName: prop!.communityHoa,
      knownFeeMonthly:
        prop!.hoaMonthly == null ? null : Number(prop!.hoaMonthly),
      listingText: prop!.listingDescription,
    });

    await persistHoaResearch(id, data, model);
    revalidatePath(`/properties/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "HOA research failed";
    logError("hoa", "HOA research action failed", { id, error: e });
    redirect(`/properties/${id}?error=${encodeURIComponent(msg)}`);
  }
}

// ---- RentCast enrichment (Phase 2) ----

const numStr = (v: number | null): string | null =>
  v == null ? null : String(v);

/**
 * Enrich a property from RentCast by address. Overwrites record fields wherever
 * RentCast has data (per the owner's chosen "overwrite all" behavior), stores
 * the valuation / rent estimate / comparables in property_enrichment, and writes
 * a property_field_provenance row (source + confidence) for every field set.
 */
export async function enrichPropertyAction(formData: FormData) {
  const id = String(formData.get("id"));
  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, id));
  if (!prop) redirect("/");
  if (!prop!.address?.trim()) {
    redirect(`/properties/${id}?error=no-address`);
  }

  try {
    // RentCast needs a full, geocodable address — passing just the street line
    // ("17224 Cambridge Woods Ct") returns a 400 "could not be parsed or
    // geolocated". Compose street + city/state/zip the same way geocoding does.
    const fullAddress = formatAddress({
      address: prop!.address,
      city: prop!.city,
      state: prop!.state,
      zip: prop!.zip,
    });
    const e = await enrichByAddress(fullAddress);
    const r = e.record;

    // 1. Overwrite property record fields where RentCast supplied a value.
    //    (We never touch `price` — that's the user's list price, not an AVM.)
    const updates: Record<string, unknown> = {};
    const prov: { fieldName: string; confidence: string }[] = [];
    const set = (
      col: string,
      field: string,
      value: unknown,
      confidence = "high",
    ) => {
      if (value == null) return;
      updates[col] = value;
      prov.push({ fieldName: field, confidence });
    };

    set("beds", "beds", numStr(r.beds));
    set("baths", "baths", numStr(r.baths));
    set("sqft", "sqft", r.sqft);
    set("lotAcres", "lot_acres", numStr(r.lotAcres));
    set("yearBuilt", "year_built", r.yearBuilt);
    set("propertyType", "property_type", r.propertyType);
    set("hoaMonthly", "hoa_monthly", numStr(r.hoaMonthly));
    set("taxesAnnual", "taxes_annual", numStr(r.taxesAnnual));
    set("city", "city", r.city);
    set("state", "state", r.state);
    set("zip", "zip", r.zip);
    set("latitude", "latitude", r.latitude);
    set("longitude", "longitude", r.longitude);

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(properties).set(updates).where(eq(properties.id, id));
    }

    // The valuation is an estimate, so its provenance gets medium confidence.
    if (e.valuation.value != null) {
      prov.push({ fieldName: "value_estimate", confidence: "medium" });
    }

    // 2. Cache the valuation / rent / comparables + raw payload.
    const enrichVals = {
      source: "rentcast",
      valueEstimate: numStr(e.valuation.value),
      valueLow: numStr(e.valuation.valueLow),
      valueHigh: numStr(e.valuation.valueHigh),
      rentEstimate: numStr(e.rent.rent),
      rentLow: numStr(e.rent.rentLow),
      rentHigh: numStr(e.rent.rentHigh),
      lastSalePrice: numStr(r.lastSalePrice),
      lastSaleDate: r.lastSaleDate,
      comparables: e.comparables,
      raw: e.raw,
      fetchedAt: new Date(),
    };
    await db
      .insert(propertyEnrichment)
      .values({ propertyId: id, ...enrichVals })
      .onConflictDoUpdate({
        target: propertyEnrichment.propertyId,
        set: enrichVals,
      });

    // 3. Provenance: one upserted row per field (source + confidence).
    for (const p of prov) {
      await db
        .insert(propertyFieldProvenance)
        .values({
          propertyId: id,
          fieldName: p.fieldName,
          source: "rentcast",
          confidence: p.confidence,
          capturedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            propertyFieldProvenance.propertyId,
            propertyFieldProvenance.fieldName,
          ],
          set: {
            source: "rentcast",
            confidence: p.confidence,
            capturedAt: new Date(),
          },
        });
    }

    // 4. Est. monthly depends on price/HOA/taxes, which may have changed.
    await recomputeProperty(id);
    revalidatePath(`/properties/${id}`);
    revalidatePath("/");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "enrichment failed";
    logError("enrich", "RentCast enrichment failed", { id, error: err });
    redirect(`/properties/${id}?error=${encodeURIComponent(msg)}`);
  }
}

// ---- Category ratings (the seven 1–5 scores) ----

/** Plain-text money formatter for the AI dossier (skips blanks). */
function dossierMoney(v: unknown): string | null {
  const n = v == null ? null : Number(v);
  return n == null || Number.isNaN(n)
    ? null
    : `$${Math.round(n).toLocaleString("en-US")}`;
}

function jsonList(v: unknown): string[] {
  return Array.isArray(v)
    ? (v as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
}

/**
 * Assemble a labelled, multi-section dossier of everything the app knows about a
 * property, for the AI category-rating suggester. Empty sections are omitted so
 * the model isn't fed noise.
 */
function buildRatingDossier(args: {
  prop: typeof properties.$inferSelect;
  features: typeof propertyFeatures.$inferSelect | undefined;
  marketData: PropertyMarketData | undefined;
  hoa: typeof hoaDetails.$inferSelect | undefined;
  notes: { note: string; category: string | null }[];
  categoryNotes: { category: string; note: string | null }[];
  drives: {
    name: string;
    category: string | null;
    durationMin: number | null;
    distanceMi: number | null;
  }[];
  inputs: ScoringInputs;
}): string {
  const { prop, features, marketData, hoa, notes, categoryNotes, drives, inputs } =
    args;
  const sections: string[] = [];

  const loc = [prop.communityHoa, prop.cityArea, prop.city, prop.state, prop.zip]
    .filter(Boolean)
    .join(", ");
  const meta = [
    prop.propertyType ? `Type: ${prop.propertyType}` : null,
    prop.status ? `Status: ${prop.status}` : null,
    prop.source ? `Source: ${prop.source}` : null,
    prop.mlsNumber ? `MLS#: ${prop.mlsNumber}` : null,
    prop.listingUrl ? `Listing URL: ${prop.listingUrl}` : null,
  ].filter(Boolean);
  sections.push(
    `Address: ${prop.address}` +
      (loc ? `\nArea: ${loc}` : "") +
      (meta.length ? `\n${meta.join("\n")}` : ""),
  );

  // Listed facts (the property row — may be user-entered or RentCast-overwritten).
  const facts: string[] = [];
  const push = (label: string, val: string | null) => {
    if (val) facts.push(`- ${label}: ${val}`);
  };
  push("List price", dossierMoney(prop.price));
  push("Est. monthly payment", dossierMoney(prop.estMonthlyPayment));
  const bb = [
    prop.beds != null ? `${prop.beds} bed` : null,
    prop.baths != null ? `${prop.baths} bath` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  push("Beds/baths", bb || null);
  push("Sq ft", prop.sqft != null ? String(prop.sqft) : null);
  push("Lot (acres)", prop.lotAcres != null ? String(prop.lotAcres) : null);
  push("Year built", prop.yearBuilt != null ? String(prop.yearBuilt) : null);
  push("HOA/mo", dossierMoney(prop.hoaMonthly));
  push("Taxes/yr", dossierMoney(prop.taxesAnnual));
  push(
    "Days on market",
    prop.daysOnMarket != null ? String(prop.daysOnMarket) : null,
  );
  push(
    "School rating (GreatSchools avg, 0–10)",
    prop.schoolRating != null ? String(prop.schoolRating) : null,
  );
  const schoolLevels = [
    prop.schoolElementary != null ? `elementary ${prop.schoolElementary}` : null,
    prop.schoolMiddle != null ? `middle ${prop.schoolMiddle}` : null,
    prop.schoolHigh != null ? `high ${prop.schoolHigh}` : null,
  ].filter(Boolean);
  if (schoolLevels.length)
    push("Schools by level (0–10)", schoolLevels.join(", "));
  push(
    "Commute → Salisbury office",
    prop.commuteSalisburyMin != null ? `${prop.commuteSalisburyMin} min` : null,
  );
  push(
    "Commute → Charlotte/Uptown",
    prop.commuteCharlotteMin != null ? `${prop.commuteCharlotteMin} min` : null,
  );
  // The must-have gate forces a Pass regardless of score — make it explicit.
  if (prop.mustHaveIssue && prop.mustHaveIssue !== "No")
    push("Must-have issue / deal-breaker flag", prop.mustHaveIssue);
  if (facts.length) sections.push(`Listed facts:\n${facts.join("\n")}`);

  const ownerNotes: string[] = [];
  if (prop.accessNotes) ownerNotes.push(`- Access: ${prop.accessNotes}`);
  if (prop.amenitiesNotes) ownerNotes.push(`- Amenities: ${prop.amenitiesNotes}`);
  if (prop.risksRedFlags)
    ownerNotes.push(`- Risks/red flags: ${prop.risksRedFlags}`);
  if (ownerNotes.length) sections.push(`Owner notes:\n${ownerNotes.join("\n")}`);

  // Structured HOA record (separate from the listing's HOA hints).
  if (hoa) {
    const h: string[] = [];
    if (hoa.hoaExists != null) h.push(`- Has HOA: ${hoa.hoaExists ? "yes" : "no"}`);
    if (hoa.hoaName) h.push(`- Name: ${hoa.hoaName}`);
    if (hoa.feeAmount != null)
      h.push(
        `- Fee: ${dossierMoney(hoa.feeAmount)}${
          hoa.feeFrequency ? ` (${hoa.feeFrequency})` : ""
        }`,
      );
    const amen = jsonList(hoa.amenities);
    if (amen.length) h.push(`- Amenities: ${amen.join("; ")}`);
    const restr = jsonList(hoa.restrictions);
    if (restr.length) h.push(`- Restrictions: ${restr.join("; ")}`);
    if (hoa.managementCompany) h.push(`- Management: ${hoa.managementCompany}`);
    if (h.length) sections.push(`HOA details:\n${h.join("\n")}`);
  }

  if (features) {
    const fx: string[] = [];
    const addList = (label: string, items: string[]) => {
      if (items.length) fx.push(`- ${label}: ${items.join("; ")}`);
    };
    if (features.emotionalFitSummary)
      fx.push(`- Summary: ${features.emotionalFitSummary}`);
    addList("Family-friendly", jsonList(features.familyFriendly));
    addList("Walking", jsonList(features.walkingFeatures));
    addList("Work from home", jsonList(features.workFromHome));
    addList("Community amenities", jsonList(features.communityAmenities));
    addList("Renovation risk", jsonList(features.renovationRisk));
    addList("Concerns", jsonList(features.concerns));
    if (fx.length)
      sections.push(`AI listing analysis (from the description):\n${fx.join("\n")}`);
  }

  if (marketData) {
    const block = formatMarketData(marketData);
    if (block)
      sections.push(`Property-API data (RentCast, authoritative):\n${block}`);
  }

  const driveLines = drives
    .filter((d) => d.durationMin != null)
    .map(
      (d) =>
        `- ${d.name}${d.category ? ` (${d.category})` : ""}: ${d.durationMin} min` +
        (d.distanceMi != null ? `, ${d.distanceMi} mi` : ""),
    );
  if (driveLines.length)
    sections.push(`Drive times to saved places:\n${driveLines.join("\n")}`);

  // The buyer's own per-category reasoning — the most direct signal of their
  // priorities, so the model can align its ratings with their judgment.
  const catNoteLines = categoryNotes
    .filter((n) => n.note && n.note.trim())
    .map((n) => {
      const label =
        CATEGORY_LABEL[n.category as CategoryKey] ?? n.category;
      return `- ${label}: ${n.note!.trim()}`;
    });
  if (catNoteLines.length)
    sections.push(`Buyer's per-category notes:\n${catNoteLines.join("\n")}`);

  // Freeform notes the buyer logged against the property.
  const noteLines = notes
    .filter((n) => n.note && n.note.trim())
    .map(
      (n) =>
        `- ${n.category && n.category !== "general" ? `[${n.category}] ` : ""}${n.note.trim()}`,
    );
  if (noteLines.length)
    sections.push(`Buyer's notes on this property:\n${noteLines.join("\n")}`);

  // The seller's verbatim listing copy. The AI analysis above is a distilled
  // view of this; include the raw text too so the model can catch nuance the
  // extraction may have dropped (treat as optimistic marketing).
  if (prop.listingDescription && prop.listingDescription.trim()) {
    const desc = prop.listingDescription.trim();
    const clipped = desc.length > 4000 ? `${desc.slice(0, 4000)}…` : desc;
    sections.push(`Seller's listing description (verbatim, marketing):\n${clipped}`);
  }

  sections.push(
    [
      "Buyer targets (judge financial fit & commute against these):",
      `- Max budget: ${dossierMoney(inputs.max_budget)}`,
      `- Preferred price: ${dossierMoney(inputs.preferred_price)}`,
      `- Comfortable monthly payment: ${dossierMoney(inputs.comfortable_monthly)}`,
      `- Minimum bedrooms: ${inputs.min_bedrooms}`,
      `- Target commute → Salisbury: ${inputs.target_commute_salisbury_min} min`,
      `- Target commute → Charlotte: ${inputs.target_commute_charlotte_min} min`,
    ].join("\n"),
  );

  return sections.join("\n\n");
}

/**
 * Propose all seven 1–5 category ratings with AI, from the property's full data
 * (facts + listing analysis + RentCast enrichment + drive times) graded against
 * the rubric and the buyer's targets. Writes the suggested ratings to
 * property_scores and each rationale to the category's "why" note, then
 * recomputes — so the ratings form shows the AI's picks for the user to review,
 * adjust, and re-save. Overwrites existing ratings/notes (it's an explicit,
 * user-triggered suggestion).
 */
export async function suggestRatingsAction(formData: FormData) {
  const id = String(formData.get("id"));
  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, id));
  if (!prop) redirect("/");

  const [features] = await db
    .select()
    .from(propertyFeatures)
    .where(eq(propertyFeatures.propertyId, id));
  const marketData = await loadMarketData(id);
  const [hoa] = await db
    .select()
    .from(hoaDetails)
    .where(eq(hoaDetails.propertyId, id));
  const noteRows = await db
    .select()
    .from(propertyNotes)
    .where(eq(propertyNotes.propertyId, id));
  const catNoteRows = await db
    .select()
    .from(scoreNotes)
    .where(eq(scoreNotes.propertyId, id));
  const driveRows = await db
    .select()
    .from(propertyDriveTimes)
    .where(eq(propertyDriveTimes.propertyId, id));
  const placeRows = await db.select().from(places);
  const placeById = new Map(placeRows.map((p) => [p.id, p]));
  const drives = driveRows.map((d) => {
    const pl = placeById.get(d.placeId);
    return {
      name: pl?.name ?? "place",
      category: pl?.category ?? null,
      durationMin: d.durationMin,
      distanceMi: d.distanceMi,
    };
  });
  const { inputs } = await getScoringConfig();

  try {
    const dossier = buildRatingDossier({
      prop: prop!,
      features,
      marketData,
      hoa,
      notes: noteRows.map((n) => ({ note: n.note, category: n.category })),
      categoryNotes: catNoteRows.map((n) => ({
        category: n.category,
        note: n.note,
      })),
      drives,
      inputs,
    });
    logInfo("rate", "requesting AI category-rating suggestions", {
      id,
      dossierChars: dossier.length,
      hasExtraction: !!features,
      hasMarketData: !!marketData,
      hasHoa: !!hoa,
      notes: noteRows.length,
      categoryNotes: catNoteRows.length,
      driveTimes: drives.length,
    });

    const { ratings, model } = await suggestCategoryRatings(dossier);

    // 1. Write the seven ratings onto property_scores (overwrites prior values).
    const ratingCols: Record<string, number> = {};
    for (const key of CATEGORIES) {
      ratingCols[SCORE_COLUMN[key] as string] = ratings[key].rating;
    }
    await db
      .insert(propertyScores)
      .values({ propertyId: id, ...ratingCols })
      .onConflictDoUpdate({
        target: propertyScores.propertyId,
        set: ratingCols,
      });

    // 2. Store each rationale as the category's "why" note so the reasoning shows.
    for (const key of CATEGORIES) {
      const note = ratings[key].rationale?.trim();
      if (!note) continue;
      await db
        .insert(scoreNotes)
        .values({ propertyId: id, category: key, note })
        .onConflictDoUpdate({
          target: [scoreNotes.propertyId, scoreNotes.category],
          set: { note },
        });
    }

    logInfo("rate", "AI category ratings applied", {
      id,
      model,
      ratings: CATEGORIES.map((k) => `${k}=${ratings[k].rating}`).join(" "),
    });

    // 3. Recompute weighted score + recommendation from the new ratings.
    await recomputeProperty(id);
    revalidatePath(`/properties/${id}`);
    revalidatePath("/");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "rating suggestion failed";
    logError("rate", "AI rating suggestion failed", { id, error: err });
    redirect(`/properties/${id}?error=${encodeURIComponent(msg)}`);
  }
}

function ratingOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Math.round(Number(s));
  if (Number.isNaN(n)) return null;
  return Math.max(1, Math.min(5, n));
}

export async function saveScoresAction(formData: FormData) {
  const id = String(formData.get("id"));

  // 1. The seven category ratings.
  const ratingFields: Record<string, number | null> = {};
  for (const key of CATEGORIES) {
    ratingFields[SCORE_COLUMN[key] as string] = ratingOrNull(
      formData.get(key),
    );
  }
  await db
    .insert(propertyScores)
    .values({ propertyId: id, ...ratingFields })
    .onConflictDoUpdate({
      target: propertyScores.propertyId,
      set: ratingFields,
    });

  // 2. The must-have-issue gate lives on the property.
  const mustHaveIssue = String(formData.get("mustHaveIssue") ?? "No");
  await db
    .update(properties)
    .set({ mustHaveIssue, updatedAt: new Date() })
    .where(eq(properties.id, id));

  // 3. Optional per-category rationale notes.
  for (const key of CATEGORIES) {
    const note = strOrNull(formData.get(`note_${key}`));
    if (note == null) {
      await db
        .delete(scoreNotes)
        .where(
          and(
            eq(scoreNotes.propertyId, id),
            eq(scoreNotes.category, key),
          ),
        );
    } else {
      await db
        .insert(scoreNotes)
        .values({ propertyId: id, category: key, note })
        .onConflictDoUpdate({
          target: [scoreNotes.propertyId, scoreNotes.category],
          set: { note },
        });
    }
  }

  await recomputeProperty(id);
  revalidatePath(`/properties/${id}`);
  revalidatePath("/");
}

// ---- Notes ----

export async function addNoteAction(formData: FormData) {
  const id = String(formData.get("id"));
  const note = String(formData.get("note") ?? "").trim();
  const category = String(formData.get("category") ?? "general");
  if (note) {
    await db.insert(propertyNotes).values({ propertyId: id, note, category });
  }
  revalidatePath(`/properties/${id}`);
}

// ---- Saved places + drive times ----

/** Add a destination (grocery, office, gym, ...). Geocoded best-effort on save. */
export async function addPlaceAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const category = String(formData.get("category") ?? "other");
  if (!name || !address) redirect("/places?error=name-address");

  const coords = await geocode({ address });
  if (!coords) {
    logWarn("places", "place saved without coordinates (geocoding failed)", {
      name,
      address,
    });
  }
  await db.insert(places).values({
    name,
    address,
    category,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
  });
  logInfo("places", "added place", { name, category, geocoded: !!coords });

  revalidatePath("/places");
  redirect("/places");
}

export async function deletePlaceAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.delete(places).where(eq(places.id, id));
  revalidatePath("/places");
  redirect("/places");
}

/**
 * Compute driving time + distance from a property to every saved place and
 * cache the results. Best-effort: places that can't be routed (or that lack
 * coordinates) are skipped. Requires a Google Maps key and property coordinates.
 */
export async function computeDriveTimesAction(formData: FormData) {
  const id = String(formData.get("id"));
  const [prop] = await db
    .select({
      id: properties.id,
      latitude: properties.latitude,
      longitude: properties.longitude,
    })
    .from(properties)
    .where(eq(properties.id, id));
  if (!prop) {
    logWarn("drivetime", "compute requested for unknown property", { id });
    redirect("/");
  }
  if (prop!.latitude == null || prop!.longitude == null) {
    logWarn("drivetime", "property has no coordinates; cannot compute", { id });
    redirect(`/properties/${id}?error=no-coords`);
  }

  const allPlaces = await db.select().from(places);
  const routable = allPlaces.filter(
    (p) => p.latitude != null && p.longitude != null,
  );
  if (routable.length === 0) {
    logWarn("drivetime", "no routable places (none have coordinates)", {
      id,
      placesTotal: allPlaces.length,
    });
    redirect(`/properties/${id}?error=no-places`);
  }

  logInfo("drivetime", "computing drive times", {
    id,
    placesTotal: allPlaces.length,
    routable: routable.length,
  });

  const results = await driveTimes(
    { latitude: prop!.latitude!, longitude: prop!.longitude! },
    routable.map((p) => ({ latitude: p.latitude!, longitude: p.longitude! })),
  );

  let written = 0;
  for (let i = 0; i < routable.length; i++) {
    const r = results[i];
    if (!r) continue;
    const vals = {
      durationMin: r.durationMin,
      distanceMi: r.distanceMi,
      computedAt: new Date(),
    };
    await db
      .insert(propertyDriveTimes)
      .values({ propertyId: id, placeId: routable[i].id, ...vals })
      .onConflictDoUpdate({
        target: [
          propertyDriveTimes.propertyId,
          propertyDriveTimes.placeId,
        ],
        set: vals,
      });
    written++;
  }

  logInfo("drivetime", "drive times computed", {
    id,
    routable: routable.length,
    written,
    skipped: routable.length - written,
  });

  revalidatePath(`/properties/${id}`);
}
