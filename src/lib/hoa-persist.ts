// Shared persistence for HOA-validator results, used by both the server action
// (no-JS form fallback) and the streaming route handler. Keeping the field
// mapping in one place avoids the two paths drifting apart.

import { db } from "@/db";
import { hoaDetails } from "@/db/schema";
import type { HoaResearch } from "./hoa";

/** Upsert a property's HOA research findings into hoa_details. */
export async function persistHoaResearch(
  propertyId: string,
  data: HoaResearch,
  model: string,
): Promise<void> {
  const values = {
    hoaExists: data.hoa_exists,
    hoaName: data.hoa_name,
    managementCompany: data.management_company,
    managementContact: data.management_contact,
    website: data.website,
    feeAmount: data.fee_amount == null ? null : String(data.fee_amount),
    feeFrequency: data.fee_frequency,
    specialAssessments: data.special_assessments,
    amenities: data.amenities,
    restrictions: data.rules,
    petPolicy: data.pet_policy,
    rentalPolicy: data.rental_policy,
    declarationUrl: data.declaration_url,
    rating: data.rating == null ? null : String(data.rating),
    reviewCount:
      data.review_count == null ? null : Math.round(data.review_count),
    pros: data.pros,
    cons: data.cons,
    verdict: data.verdict,
    openQuestions: data.open_questions,
    sources: data.sources,
    sourceUrl: data.sources[0]?.url ?? null,
    confidenceLevel: data.confidence,
    model,
    researchedAt: new Date(),
    updatedAt: new Date(),
  };

  await db
    .insert(hoaDetails)
    .values({ propertyId, ...values })
    .onConflictDoUpdate({ target: hoaDetails.propertyId, set: values });
}
