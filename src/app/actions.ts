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
  scoreOverrides,
  propertyScores,
} from "@/db/schema";
import { AUTH_COOKIE, verifyPassword, expectedToken } from "@/lib/auth";
import { extractListingFeatures } from "@/lib/ai";
import { recomputeProperty } from "@/lib/recompute";

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

function numOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function createPropertyAction(formData: FormData) {
  const address = String(formData.get("address") ?? "").trim();
  if (!address) redirect("/properties/new?error=address");

  const [row] = await db
    .insert(properties)
    .values({
      address,
      city: numOrNull(formData.get("city")),
      state: numOrNull(formData.get("state")),
      zip: numOrNull(formData.get("zip")),
      listingUrl: numOrNull(formData.get("listingUrl")),
      source: String(formData.get("source") ?? "manual"),
      status: "new",
      price: numOrNull(formData.get("price")),
      beds: numOrNull(formData.get("beds")),
      baths: numOrNull(formData.get("baths")),
      sqft: formData.get("sqft") ? Number(formData.get("sqft")) : null,
      lotSize: numOrNull(formData.get("lotSize")),
      yearBuilt: formData.get("yearBuilt")
        ? Number(formData.get("yearBuilt"))
        : null,
      hoaFee: numOrNull(formData.get("hoaFee")),
      propertyType: numOrNull(formData.get("propertyType")),
      listingDescription: numOrNull(formData.get("listingDescription")),
    })
    .returning({ id: properties.id });

  await recomputeProperty(row.id);
  revalidatePath("/");
  redirect(`/properties/${row.id}`);
}

export async function updatePropertyAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db
    .update(properties)
    .set({
      address: String(formData.get("address") ?? "").trim(),
      city: numOrNull(formData.get("city")),
      state: numOrNull(formData.get("state")),
      zip: numOrNull(formData.get("zip")),
      listingUrl: numOrNull(formData.get("listingUrl")),
      price: numOrNull(formData.get("price")),
      beds: numOrNull(formData.get("beds")),
      baths: numOrNull(formData.get("baths")),
      sqft: formData.get("sqft") ? Number(formData.get("sqft")) : null,
      lotSize: numOrNull(formData.get("lotSize")),
      yearBuilt: formData.get("yearBuilt")
        ? Number(formData.get("yearBuilt"))
        : null,
      hoaFee: numOrNull(formData.get("hoaFee")),
      propertyType: numOrNull(formData.get("propertyType")),
      listingDescription: numOrNull(formData.get("listingDescription")),
      updatedAt: new Date(),
    })
    .where(eq(properties.id, id));

  await recomputeProperty(id);
  revalidatePath(`/properties/${id}`);
  revalidatePath("/");
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

    await db
      .insert(propertyFeatures)
      .values({
        propertyId: id,
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
      })
      .onConflictDoUpdate({
        target: propertyFeatures.propertyId,
        set: {
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
        },
      });

    await recomputeProperty(id);
    revalidatePath(`/properties/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "extraction failed";
    redirect(`/properties/${id}?error=${encodeURIComponent(msg)}`);
  }
}

// ---- Personal-fit scores & overrides ----

export async function savePersonalScoresAction(formData: FormData) {
  const id = String(formData.get("id"));
  const fields = {
    walkabilityScore: numOrNull(formData.get("walkability")),
    toddlerFriendlyScore: numOrNull(formData.get("toddler_friendly")),
    communityScore: numOrNull(formData.get("community")),
    emotionalFitScore: numOrNull(formData.get("emotional_fit")),
  };
  await db
    .insert(propertyScores)
    .values({ propertyId: id, ...fields })
    .onConflictDoUpdate({
      target: propertyScores.propertyId,
      set: fields,
    });
  await recomputeProperty(id);
  revalidatePath(`/properties/${id}`);
  revalidatePath("/");
}

export async function setOverrideAction(formData: FormData) {
  const id = String(formData.get("id"));
  const scoreName = String(formData.get("scoreName"));
  const value = numOrNull(formData.get("value"));
  const reason = numOrNull(formData.get("reason"));

  if (value == null) {
    await db
      .delete(scoreOverrides)
      .where(
        and(
          eq(scoreOverrides.propertyId, id),
          eq(scoreOverrides.scoreName, scoreName),
        ),
      );
  } else {
    await db
      .insert(scoreOverrides)
      .values({ propertyId: id, scoreName, value, reason })
      .onConflictDoUpdate({
        target: [scoreOverrides.propertyId, scoreOverrides.scoreName],
        set: { value, reason },
      });
  }
  await recomputeProperty(id);
  revalidatePath(`/properties/${id}`);
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
