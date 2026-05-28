// Pure scoring engine. No I/O — easy to unit-test and re-tune.
// See docs/SCORING.md for the model.

export type ScoreName =
  | "price"
  | "monthly_cost"
  | "commute"
  | "school"
  | "condition"
  | "resale"
  | "hoa"
  | "walkability"
  | "toddler_friendly"
  | "community"
  | "emotional_fit";

export type Scores = Partial<Record<ScoreName, number | null>>;

export type Weights = Record<ScoreName, number>;

export const DEFAULT_WEIGHTS: Weights = {
  price: 0.1,
  monthly_cost: 0.15,
  commute: 0.1,
  school: 0.1,
  condition: 0.1,
  resale: 0.05,
  hoa: 0.05,
  walkability: 0.08,
  toddler_friendly: 0.1,
  community: 0.09,
  emotional_fit: 0.08,
};

// Objective sub-scores are derived from data; personal-fit sub-scores start
// unrated (null) until the user provides them (often after a visit).
export const OBJECTIVE_SCORES: ScoreName[] = [
  "price",
  "monthly_cost",
  "commute",
  "school",
  "condition",
  "resale",
  "hoa",
];

export const PERSONAL_SCORES: ScoreName[] = [
  "walkability",
  "toddler_friendly",
  "community",
  "emotional_fit",
];

const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, n));

export interface PropertyForScoring {
  price?: number | null;
  beds?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  hoaFee?: number | null;
  // monthly cost inputs (user-provided in Phase 1)
  monthlyCost?: number | null;
  // commute drive time in minutes, if known
  commuteMinutes?: number | null;
  // 0..10 school rating, if known
  schoolRating?: number | null;
  renovationRiskCount?: number | null;
}

export interface ScoringConfig {
  budget?: number; // target purchase price
  monthlyBudget?: number; // target monthly all-in cost
  idealSqftMin?: number;
  idealSqftMax?: number;
  idealBedsMin?: number;
  idealBedsMax?: number;
  targetCommuteMinutes?: number;
  currentYear?: number;
}

export const DEFAULT_CONFIG: Required<ScoringConfig> = {
  budget: 600_000,
  monthlyBudget: 4_000,
  idealSqftMin: 1_800,
  idealSqftMax: 3_200,
  idealBedsMin: 3,
  idealBedsMax: 4,
  targetCommuteMinutes: 30,
  currentYear: new Date().getFullYear(),
};

/** Score that peaks at 100 inside [min,max] and decays linearly outside it. */
function rangeScore(
  value: number,
  min: number,
  max: number,
  falloff: number,
): number {
  if (value >= min && value <= max) return 100;
  const dist = value < min ? min - value : value - max;
  return clamp(100 - (dist / falloff) * 100);
}

/** 100 at/under target, decays as value exceeds target. */
function underTargetScore(value: number, target: number, falloff: number) {
  if (value <= target) return 100;
  return clamp(100 - ((value - target) / falloff) * 100);
}

/**
 * Compute objective sub-scores from property data. Personal-fit sub-scores are
 * NOT computed here (they're user-provided); pass them in via `manual`.
 */
export function computeObjectiveScores(
  p: PropertyForScoring,
  cfg: ScoringConfig = {},
): Scores {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  const scores: Scores = {};

  if (p.price != null) {
    scores.price = underTargetScore(p.price, c.budget, c.budget * 0.25);
  }

  if (p.monthlyCost != null) {
    scores.monthly_cost = underTargetScore(
      p.monthlyCost,
      c.monthlyBudget,
      c.monthlyBudget * 0.3,
    );
  }

  if (p.commuteMinutes != null) {
    scores.commute = underTargetScore(
      p.commuteMinutes,
      c.targetCommuteMinutes,
      c.targetCommuteMinutes,
    );
  }

  if (p.schoolRating != null) {
    scores.school = clamp((p.schoolRating / 10) * 100);
  }

  if (p.yearBuilt != null) {
    // 30+ years old → 0 from age alone; newer → higher. Renovation risk flags
    // from AI extraction apply an additional penalty.
    const age = Math.max(0, c.currentYear - p.yearBuilt);
    const ageScore = clamp(100 - (age / 30) * 100);
    const riskPenalty = (p.renovationRiskCount ?? 0) * 10;
    scores.condition = clamp(ageScore - riskPenalty);
  }

  if (p.hoaFee != null) {
    // $400+/mo HOA → 0 from fee alone; $0 → 100.
    scores.hoa = clamp(100 - (p.hoaFee / 400) * 100);
  }

  return scores;
}

/**
 * Combine sub-scores into a weighted total. Sub-scores that are null/undefined
 * are excluded from BOTH numerator and denominator, so a house isn't punished
 * for not yet having a visit-based personal-fit score.
 */
export function totalWeightedScore(
  scores: Scores,
  weights: Weights = DEFAULT_WEIGHTS,
): number | null {
  let num = 0;
  let den = 0;
  for (const key of Object.keys(weights) as ScoreName[]) {
    const v = scores[key];
    if (v == null || Number.isNaN(v)) continue;
    const w = weights[key];
    num += w * v;
    den += w;
  }
  if (den === 0) return null;
  return Math.round((num / den) * 10) / 10;
}

/** Dimensions with no value yet — surfaced in the UI as "needs input/visit". */
export function unratedDimensions(scores: Scores): ScoreName[] {
  return (Object.keys(DEFAULT_WEIGHTS) as ScoreName[]).filter(
    (k) => scores[k] == null || Number.isNaN(scores[k] as number),
  );
}
