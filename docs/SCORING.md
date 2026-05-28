# Scoring model

> **Source of truth:** this model is taken directly from the owner's
> `house_comparison_scoring_tracker.xlsx` (sheets *Weights & Inputs*, *Scoring
> Rubric*, *House Tracker*, *Dashboard*). The formulas below are the exact
> spreadsheet logic, reproduced so the app behaves identically.
>
> ⚠️ **Implementation gap:** the current Phase 1 code in `src/lib/scoring.ts`
> implements an earlier, different draft (11 dimensions, 0–100 inputs). It does
> **not** yet match this spec. See "Aligning the code" at the end.

## Overview

Each house is rated **1–5** on **7 weighted categories**. The category ratings
are combined into a **Weighted Score out of 100**, which drives a
**Recommendation**. A separate **Estimated Monthly Payment** is computed from
financial inputs. Scoring is subjective-but-guided: the rubric defines what each
1–5 means per category.

- **1** = Poor, **2** = Weak, **3** = Acceptable, **4** = Good, **5** = Excellent

## Categories & weights

Weights sum to 100. They are tunable inputs (the *Weights & Inputs* sheet).

| # | Category (`key`)                         | Weight |
| - | ---------------------------------------- | ------ |
| 1 | Location / walkability (`location_walkability`)     | 20 |
| 2 | Community / kids amenities (`community_kids`)        | 15 |
| 3 | House layout / family fit (`layout_family_fit`)      | 20 |
| 4 | Schools / childcare fit (`schools_childcare`)        | 10 |
| 5 | Commute / access (`commute_access`)                  | 10 |
| 6 | Financial fit (`financial_fit`)                      | 15 |
| 7 | Condition / risk / resale (`condition_risk_resale`)  | 10 |
|   | **TOTAL**                                            | **100** |

## Weighted Score formula

Exact spreadsheet formula (House Tracker column `AF`):

```
WeightedScore =
  IF(no categories rated, "",
     ROUND( Σ(rating_i × weight_i) / Σ(weight_i) × 20 , 1))
```

In words: take the **weighted average** of the seven 1–5 ratings, then **× 20**
to scale a 1–5 average onto a 0–100 score (a perfect all-5s house = 100).

```ts
weightedScore = round( sum(rating[i] * weight[i]) / sum(weight[i]) * 20, 1)
```

**Worked example (the sheet's sample row):**

| Category | Rating | Weight | rating×weight |
| --- | --- | --- | --- |
| Location / walkability | 4 | 20 | 80 |
| Community / kids | 5 | 15 | 75 |
| Layout / family fit | 4 | 20 | 80 |
| Schools / childcare | 4 | 10 | 40 |
| Commute / access | 3 | 10 | 30 |
| Financial fit | 4 | 15 | 60 |
| Condition / risk / resale | 4 | 10 | 40 |
| | | **Σw=100** | **Σ=405** |

`405 / 100 × 20 = 81.0` → **Weighted Score = 81** ✓

> **Blanks count as 0.** A category left unrated contributes 0 to the numerator
> but its full weight still counts in the denominator — so partial scoring drags
> the total down. Score **all seven** categories for a meaningful number. The
> score is blank ("Needs data") only when **no** category is rated.

## Recommendation

Exact spreadsheet formula (House Tracker column `AG`), evaluated top-down:

```
IF WeightedScore is blank        → "Needs data"
ELSE IF Must-Have Issue = "Yes"  → "Pass / must-have issue"   (hard gate)
ELSE IF WeightedScore >= 85      → "Strong candidate"
ELSE IF WeightedScore >= 75      → "Good option"
ELSE IF WeightedScore >= 65      → "Maybe"
ELSE                             → "Pass"
```

| Band | Score | Notes |
| --- | --- | --- |
| Strong candidate | ≥ 85 | |
| Good option | 75–84 | sample row (81) lands here |
| Maybe | 65–74 | |
| Pass | < 65 | |
| Pass / must-have issue | any | **overrides** the score when `Must-Have Issue? = Yes` |
| Needs data | — | no categories rated yet |

The **Must-Have Issue?** flag is a deal-breaker gate: a "Yes" forces a Pass
regardless of how high the weighted score is.

## Estimated Monthly Payment

Exact spreadsheet formula (House Tracker column `P`):

```
EstMonthly = round(
    PI(price × (1 − downPct), rate, termYears)        // principal & interest
  + hoaMonthly                                          // column N
  + (taxesAnnual ?? price × propTaxRate) / 12           // column O, else estimate
  + annualInsurance / 12
, 0)
```

where `PI` is the standard amortizing payment:

```
loan = price × (1 − downPct)
m    = rate / 12
PI   = loan × m × (1+m)^(term×12) / ((1+m)^(term×12) − 1)
```

If the actual annual taxes (tracker column "Taxes Annual") are entered, they're
used; otherwise taxes are estimated as `price × propTaxRate`.

**Worked example:** price 575,000; 20% down → loan 460,000; 6.5%/30y → P&I ≈
2,908; HOA 125; tax 575,000×1.1%/12 ≈ 527; insurance 1,800/12 = 150 →
**≈ 3,710** ✓

## Inputs (Weights & Inputs sheet)

These are the owner's tunable parameters (the "yellow cells"). Defaults are the
values currently in the tracker:

| Input (`key`) | Default | Used for |
| --- | --- | --- |
| Max purchase budget (`max_budget`) | 650,000 | top budget filter |
| Preferred purchase price (`preferred_price`) | 575,000 | quick comparison |
| Comfortable monthly payment (`comfortable_monthly`) | 4,500 | financial-fit judgment |
| Minimum bedrooms (`min_bedrooms`) | 3 | filter goal |
| Down payment % (`down_payment_pct`) | 0.20 | monthly payment |
| Interest rate (`interest_rate`) | 0.065 | monthly payment |
| Loan term years (`loan_term_years`) | 30 | monthly payment |
| Property tax rate (`property_tax_rate`) | 0.011 | tax estimate |
| Annual insurance (`annual_insurance`) | 1,800 | monthly payment |
| Target commute — Salisbury office (`target_commute_salisbury_min`) | 45 | commute scoring |
| Target commute — Charlotte/Uptown (`target_commute_charlotte_min`) | 25 | commute scoring |

## Scoring rubric (what each 1–5 means)

From the *Scoring Rubric* sheet. Use this to guide manual ratings and to prompt
the AI extractor when proposing category ratings.

### Location / walkability
- **5** — Very strong target area; sidewalks; parks/walking nearby; feels safe and pleasant.
- **4** — Good area with some walkable options.
- **3** — Okay area but mostly car-dependent.
- **2** — Compromises on area or traffic/noise.
- **1** — Wrong area, isolated, unsafe-feeling, or major traffic issue.

### Community / kids amenities
- **5** — Pool, playground, clubhouse or strong kid-friendly community; not crowded.
- **4** — Some amenities and family feel.
- **3** — Basic neighborhood, limited amenities.
- **2** — Few kid-friendly features.
- **1** — No amenities or poor fit for young kids.

### House layout / family fit
- **5** — 3–4 beds, practical layout, storage, safe yard, WFH space, guest/help space.
- **4** — Mostly fits with small compromises.
- **3** — Works but some layout tradeoffs.
- **2** — Several family/workflow issues.
- **1** — Does not work for family needs.

### Schools / childcare fit
- **5** — Strong school zone and childcare/activities access.
- **4** — Good schools/child options.
- **3** — Acceptable but needs research.
- **2** — Weak or uncertain.
- **1** — Major school/childcare concern.

### Commute / access
- **5** — Easy access to office, Charlotte, airport, stores, and activities.
- **4** — Good access with minor tradeoffs.
- **3** — Acceptable commute/access.
- **2** — Long or inconvenient.
- **1** — Too far or impractical.

### Financial fit
- **5** — Within budget, comfortable monthly cost, reasonable HOA/taxes.
- **4** — Slight stretch but manageable.
- **3** — At limit; needs careful review.
- **2** — Too expensive or high carrying costs.
- **1** — Not financially reasonable.

### Condition / risk / resale
- **5** — Move-in ready, low risk, strong resale.
- **4** — Minor work or manageable risk.
- **3** — Some repairs/unknowns.
- **2** — Significant risk or dated condition.
- **1** — Major red flags.

## Dashboard metrics

The *Dashboard* sheet derives, across all tracked houses:

- **Total houses tracked** — count of addresses.
- **Highest score** — max Weighted Score.
- **Strong candidates** — count where Recommendation = "Strong candidate".
- **Good options** — count where Recommendation = "Good option".
- **Average est monthly** — mean of Estimated Monthly Payment.
- **Top 10** — houses ranked by Weighted Score (descending), showing address,
  community/HOA, city/area, price, est monthly, score, recommendation.

## Aligning the code (follow-up)

To make `src/lib/scoring.ts` match this spec, the engine should:

1. Replace the 11-dimension 0–100 model with the **7 categories** above, each an
   integer **1–5** input.
2. Compute `weightedScore = sum(rating×weight)/sum(weight) × 20`, rounded to 1dp,
   treating blanks as 0 and returning blank only when nothing is rated.
3. Add `recommendation(weightedScore, mustHaveIssue)` with the bands above
   (including the must-have-issue hard gate).
4. Add `estimatedMonthly(...)` implementing the amortization + tax + insurance +
   HOA formula, and store it on the property.
5. Move the financial/commute parameters into the inputs config (seed with the
   defaults in the table above) instead of `DEFAULT_CONFIG`.

The data model changes needed to support this are described in
`DATA_MODEL.md` (7 category ratings, `must_have_issue`, `est_monthly_payment`,
`taxes_annual`, two commute fields, recommendation band).
