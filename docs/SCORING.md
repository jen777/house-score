# Scoring model

Every house gets **objective scores** (computed from data) and **personal-fit
scores** (mostly manual). They combine into a single `total_weighted_score` used
for ranking.

## Principles

- Each sub-score is normalized to **0–100**.
- The scoring engine is a set of **pure functions**: `(property, config) → scores`.
  No I/O — trivial to unit-test and re-tune.
- Objective scores are computed; personal-fit scores start as **`null`
  (unrated)** and are filled in by the user (e.g., after a visit).
- Any score can be **overridden** (`score_overrides`); the override wins for
  ranking but the computed value is retained.
- Weights are **per-owner and tunable** (`scoring_weights`).

## Objective scores (computed from data)

| Score                | Inputs                              | Example logic |
| -------------------- | ----------------------------------- | ------------- |
| `price_score`        | price, budget                       | 100 at/under budget; decays as price exceeds budget |
| `monthly_cost_score` | price, rate, tax, insurance, HOA    | estimate monthly cost; score vs target monthly budget |
| `sqft` (feeds condition/fit) | sqft, ideal range           | peak inside ideal range; penalize too-small / oversized |
| `bedroom fit` (feeds fit) | beds                           | best at 3–4 beds (configurable) |
| `condition_score`    | year_built, renovation_risk (AI)    | newer/renovated higher; penalize flagged risks |
| `commute_score`      | lat/long → target(s) drive time     | 100 within target minutes; decays beyond |
| `walkability_score`  | walk features (AI), Walk Score-ish  | sidewalks/greenway/walkable boost |
| `school_score`       | school rating (API or manual)       | normalize rating to 0–100 |
| `resale_score`       | comps, market trend (Phase 2)       | appreciation + comp spread |
| `hoa_score`          | fee, restrictions, confidence       | lower fee + fewer restrictions = higher; unknown = mild penalty |
| flood/zoning risk    | county GIS (Phase 2)                | penalty applied to relevant scores |

> Monthly cost estimate (Phase 1 can use user-entered rate/tax/insurance):
> `monthly = mortgage(price, rate, term) + monthly_tax + monthly_insurance + monthly_hoa`

## Personal-fit scores (manual, often post-visit)

| Score                   | Why it stays manual |
| ----------------------- | ------------------- |
| `community_score`       | professional/family vibe — you feel it on site |
| `toddler_friendly_score`| playgrounds, calm streets, usable yard |
| `walkability_score`*    | actual usable walking, not just a number |
| neighborhood feel       | only knowable after driving/walking |
| not-crowded             | especially for townhomes |
| `emotional_fit_score`   | "feels like home" — subjective but decisive |

\* `walkability_score` can be seeded objectively from AI features, then overridden
by the user after a visit.

## Combining into a total

```
total_weighted_score =
    Σ ( weight[k] * score[k] )   for each scored dimension k
  / Σ ( weight[k] )              over dimensions that have a value
```

- Unrated personal-fit scores are **excluded from the denominator** (don't punish
  a house for not having been visited yet) — but the UI flags it as "needs visit".
- Default weights live in `scoring_weights.weights`; ship sensible defaults:

```json
{
  "price": 0.10,
  "monthly_cost": 0.15,
  "commute": 0.10,
  "school": 0.10,
  "condition": 0.10,
  "resale": 0.05,
  "hoa": 0.05,
  "walkability": 0.08,
  "toddler_friendly": 0.10,
  "community": 0.09,
  "emotional_fit": 0.08
}
```

## Confidence affects display, not silently the math

When a sub-score is built from low-confidence data (e.g., HOA "unknown"), show it
visibly (badge / muted) rather than hiding uncertainty. Optionally apply a small,
explicit confidence discount — but keep it transparent in the UI.

## Comparison view

Side-by-side of 2–4 properties:
- total score + rank,
- each sub-score as a bar,
- highlight best/worst per row,
- flag "needs visit" where personal-fit scores are unrated.
