import { eq } from "drizzle-orm";
import { db } from "@/db";
import { properties, propertyScores, scoringConfig } from "@/db/schema";
import {
  weightedScore,
  recommendation,
  estimatedMonthly,
  DEFAULT_WEIGHTS,
  DEFAULT_INPUTS,
  CATEGORIES,
  type Weights,
  type ScoringInputs,
  type Ratings,
  type CategoryKey,
} from "./scoring";

// Map a category key -> property_scores column (drizzle field name).
export const SCORE_COLUMN: Record<
  CategoryKey,
  keyof typeof propertyScores.$inferInsert
> = {
  location_walkability: "locationWalkability",
  community_kids: "communityKids",
  layout_family_fit: "layoutFamilyFit",
  schools_childcare: "schoolsChildcare",
  commute_access: "commuteAccess",
  financial_fit: "financialFit",
  condition_risk_resale: "conditionRiskResale",
};

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** Load the owner's scoring config (weights + inputs), falling back to defaults. */
export async function getScoringConfig(): Promise<{
  weights: Weights;
  inputs: ScoringInputs;
}> {
  const [row] = await db
    .select()
    .from(scoringConfig)
    .where(eq(scoringConfig.id, 1));
  return {
    weights: { ...DEFAULT_WEIGHTS, ...((row?.weights as Weights) ?? {}) },
    inputs: { ...DEFAULT_INPUTS, ...((row?.inputs as ScoringInputs) ?? {}) },
  };
}

/**
 * Recompute a property's derived values and persist them:
 *  - Estimated Monthly Payment on the property (from price/HOA/taxes + inputs).
 *  - Weighted Score (out of 100) + Recommendation on property_scores, from the
 *    seven 1–5 category ratings and the must-have-issue gate.
 * The user-entered category ratings are preserved.
 */
export async function recomputeProperty(propertyId: string): Promise<void> {
  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, propertyId));
  if (!prop) return;

  const { weights, inputs } = await getScoringConfig();

  // 1. Estimated monthly payment lives on the property and is always derivable.
  const est = estimatedMonthly(
    {
      price: toNum(prop.price),
      hoaMonthly: toNum(prop.hoaMonthly),
      taxesAnnual: toNum(prop.taxesAnnual),
    },
    inputs,
  );
  await db
    .update(properties)
    .set({ estMonthlyPayment: est != null ? String(est) : null })
    .where(eq(properties.id, propertyId));

  // 2. Derive weighted score + recommendation from existing category ratings.
  const [existing] = await db
    .select()
    .from(propertyScores)
    .where(eq(propertyScores.propertyId, propertyId));

  const ratings: Ratings = {};
  for (const key of CATEGORIES) {
    ratings[key] = toNum(existing?.[SCORE_COLUMN[key] as keyof typeof existing]);
  }

  const score = weightedScore(ratings, weights);
  const rec = recommendation(score, prop.mustHaveIssue === "Yes");

  await db
    .insert(propertyScores)
    .values({
      propertyId,
      weightedScore: score != null ? String(score) : null,
      recommendation: rec,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: propertyScores.propertyId,
      set: {
        weightedScore: score != null ? String(score) : null,
        recommendation: rec,
        computedAt: new Date(),
      },
    });
}
