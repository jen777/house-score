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
  scoreNotes,
} from "@/db/schema";
import { AUTH_COOKIE, verifyPassword, expectedToken } from "@/lib/auth";
import { extractListingFeatures } from "@/lib/ai";
import { geocode } from "@/lib/geocode";
import { recomputeProperty, SCORE_COLUMN } from "@/lib/recompute";
import { CATEGORIES } from "@/lib/scoring";

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

export async function extractAction(formData: FormData) {
  const id = String(formData.get("id"));
  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, id));
  if (!prop?.listingDescription) {
    redirect(`/properties/${id}?error=no-description`);
  }

  try {
    const { data, model } = await extractListingFeatures({
      listingText: prop!.listingDescription!,
      address: prop!.address,
      propertyType: prop!.propertyType ?? undefined,
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
    redirect(`/properties/${id}?error=${encodeURIComponent(msg)}`);
  }
}

// ---- Category ratings (the seven 1–5 scores) ----

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
