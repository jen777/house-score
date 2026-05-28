import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  properties,
  propertyScores,
  propertyFeatures,
  scoreOverrides,
  scoringWeights,
} from "@/db/schema";
import {
  computeObjectiveScores,
  totalWeightedScore,
  DEFAULT_WEIGHTS,
  type Scores,
  type ScoreName,
  type Weights,
} from "./scoring";

// Map ScoreName -> property_scores column key (drizzle field name).
const COLUMN: Record<ScoreName, keyof typeof propertyScores.$inferInsert> = {
  price: "priceScore",
  monthly_cost: "monthlyCostScore",
  commute: "commuteScore",
  school: "schoolScore",
  condition: "conditionScore",
  resale: "resaleScore",
  hoa: "hoaScore",
  walkability: "walkabilityScore",
  toddler_friendly: "toddlerFriendlyScore",
  community: "communityScore",
  emotional_fit: "emotionalFitScore",
};

const PERSONAL: ScoreName[] = [
  "walkability",
  "toddler_friendly",
  "community",
  "emotional_fit",
];

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * Recompute a property's scores and persist them.
 * - Objective scores are derived from property data + AI renovation-risk flags.
 * - Personal-fit scores are preserved from the existing row (user-entered).
 * - Any explicit override wins over both.
 */
export async function recomputeProperty(propertyId: string): Promise<void> {
  const [prop] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, propertyId));
  if (!prop) return;

  const [features] = await db
    .select()
    .from(propertyFeatures)
    .where(eq(propertyFeatures.propertyId, propertyId));

  const [existing] = await db
    .select()
    .from(propertyScores)
    .where(eq(propertyScores.propertyId, propertyId));

  const overrides = await db
    .select()
    .from(scoreOverrides)
    .where(eq(scoreOverrides.propertyId, propertyId));

  const [weightsRow] = await db
    .select()
    .from(scoringWeights)
    .where(eq(scoringWeights.id, 1));
  const weights = (weightsRow?.weights as Weights) ?? DEFAULT_WEIGHTS;

  const renovationRiskCount = Array.isArray(features?.renovationRisk)
    ? (features!.renovationRisk as unknown[]).length
    : 0;

  // 1. Objective scores from data.
  const scores: Scores = computeObjectiveScores({
    price: toNum(prop.price),
    beds: toNum(prop.beds),
    sqft: prop.sqft,
    yearBuilt: prop.yearBuilt,
    hoaFee: toNum(prop.hoaFee),
    renovationRiskCount,
  });

  // 2. Preserve existing personal-fit scores (user-entered).
  for (const name of PERSONAL) {
    const col = COLUMN[name];
    const v = toNum(existing?.[col as keyof typeof existing]);
    if (v != null) scores[name] = v;
  }

  // 3. Apply overrides (highest precedence).
  for (const o of overrides) {
    const name = o.scoreName as ScoreName;
    if (name in COLUMN) scores[name] = toNum(o.value);
  }

  const total = totalWeightedScore(scores, weights);

  const row: typeof propertyScores.$inferInsert = {
    propertyId,
    totalWeightedScore: total != null ? String(total) : null,
    computedAt: new Date(),
  };
  for (const name of Object.keys(COLUMN) as ScoreName[]) {
    const v = scores[name];
    (row as Record<string, unknown>)[COLUMN[name]] =
      v != null ? String(v) : null;
  }

  await db
    .insert(propertyScores)
    .values(row)
    .onConflictDoUpdate({ target: propertyScores.propertyId, set: row });
}
