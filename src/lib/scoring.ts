// Pure scoring engine. No I/O — easy to unit-test and re-tune.
// This implements the model in docs/SCORING.md, taken directly from the owner's
// house_comparison_scoring_tracker.xlsx: 7 weighted categories rated 1–5,
// combined into a Weighted Score out of 100, driving a Recommendation.

export type CategoryKey =
  | "location_walkability"
  | "community_kids"
  | "layout_family_fit"
  | "schools_childcare"
  | "commute_access"
  | "financial_fit"
  | "condition_risk_resale";

// Order matches the tracker's Scoring Rubric / Weights & Inputs sheet.
export const CATEGORIES: CategoryKey[] = [
  "location_walkability",
  "community_kids",
  "layout_family_fit",
  "schools_childcare",
  "commute_access",
  "financial_fit",
  "condition_risk_resale",
];

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  location_walkability: "Location / walkability",
  community_kids: "Community / kids amenities",
  layout_family_fit: "House layout / family fit",
  schools_childcare: "Schools / childcare fit",
  commute_access: "Commute / access",
  financial_fit: "Financial fit",
  condition_risk_resale: "Condition / risk / resale",
};

export type Weights = Record<CategoryKey, number>;

// Weights sum to 100 (Weights & Inputs sheet). Tunable per owner.
export const DEFAULT_WEIGHTS: Weights = {
  location_walkability: 20,
  community_kids: 15,
  layout_family_fit: 20,
  schools_childcare: 10,
  commute_access: 10,
  financial_fit: 15,
  condition_risk_resale: 10,
};

// A category rating is an integer 1–5, or null = unrated.
export type Ratings = Partial<Record<CategoryKey, number | null>>;

export type Recommendation =
  | "Strong candidate"
  | "Good option"
  | "Maybe"
  | "Pass"
  | "Pass / must-have issue"
  | "Needs data";

/**
 * Weighted Score out of 100 (House Tracker column AF).
 *
 *   round( Σ(rating_i × weight_i) / Σ(weight_i) × 20 , 1)
 *
 * Blanks count as 0 in the numerator but their weight still counts in the
 * denominator (partial scoring drags the total down). Returns null ("Needs
 * data") only when NO category is rated.
 */
export function weightedScore(
  ratings: Ratings,
  weights: Weights = DEFAULT_WEIGHTS,
): number | null {
  let anyRated = false;
  let num = 0;
  let den = 0;
  for (const key of CATEGORIES) {
    const w = weights[key] ?? 0;
    den += w;
    const v = ratings[key];
    if (v != null && !Number.isNaN(v)) {
      anyRated = true;
      num += w * v;
    }
  }
  if (!anyRated || den === 0) return null;
  return Math.round((num / den) * 20 * 10) / 10;
}

/**
 * Recommendation (House Tracker column AG), evaluated top-down. A "must-have
 * issue" is a hard gate that forces a Pass regardless of the score.
 */
export function recommendation(
  score: number | null,
  mustHaveIssue: boolean,
): Recommendation {
  if (score == null) return "Needs data";
  if (mustHaveIssue) return "Pass / must-have issue";
  if (score >= 85) return "Strong candidate";
  if (score >= 75) return "Good option";
  if (score >= 65) return "Maybe";
  return "Pass";
}

// ---- Financial / commute inputs (Weights & Inputs sheet) ----

export interface ScoringInputs {
  max_budget: number;
  preferred_price: number;
  comfortable_monthly: number;
  min_bedrooms: number;
  down_payment_pct: number;
  interest_rate: number;
  loan_term_years: number;
  property_tax_rate: number;
  annual_insurance: number;
  target_commute_salisbury_min: number;
  target_commute_charlotte_min: number;
}

// Defaults match the values currently in the owner's tracker.
export const DEFAULT_INPUTS: ScoringInputs = {
  max_budget: 650_000,
  preferred_price: 575_000,
  comfortable_monthly: 4_500,
  min_bedrooms: 3,
  down_payment_pct: 0.2,
  interest_rate: 0.065,
  loan_term_years: 30,
  property_tax_rate: 0.011,
  annual_insurance: 1_800,
  target_commute_salisbury_min: 45,
  target_commute_charlotte_min: 25,
};

export interface MonthlyInput {
  price?: number | null;
  hoaMonthly?: number | null;
  taxesAnnual?: number | null; // if null, estimated from propertyTaxRate
}

/**
 * Estimated Monthly Payment (House Tracker column P):
 *   P&I(loan, rate, term) + HOA + (taxesAnnual ?? price×taxRate)/12 + insurance/12
 * where P&I is the standard amortizing payment. Returns null without a price.
 */
export function estimatedMonthly(
  p: MonthlyInput,
  inputs: ScoringInputs = DEFAULT_INPUTS,
): number | null {
  if (p.price == null || Number.isNaN(p.price) || p.price <= 0) return null;
  const loan = p.price * (1 - inputs.down_payment_pct);
  const m = inputs.interest_rate / 12;
  const n = inputs.loan_term_years * 12;
  const pi =
    m === 0
      ? loan / n
      : (loan * m * Math.pow(1 + m, n)) / (Math.pow(1 + m, n) - 1);
  const taxesAnnual =
    p.taxesAnnual ?? p.price * inputs.property_tax_rate;
  const taxes = taxesAnnual / 12;
  const insurance = inputs.annual_insurance / 12;
  const hoa = p.hoaMonthly ?? 0;
  return Math.round(pi + hoa + taxes + insurance);
}

/** Categories with no rating yet — surfaced in the UI as "needs input". */
export function unratedCategories(ratings: Ratings): CategoryKey[] {
  return CATEGORIES.filter(
    (k) => ratings[k] == null || Number.isNaN(ratings[k] as number),
  );
}
