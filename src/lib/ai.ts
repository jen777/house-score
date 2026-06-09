import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logInfo, logError } from "./log";
import { CATEGORIES, type CategoryKey } from "./scoring";

// Structured output schema for listing extraction. See docs/AI_EXTRACTION.md.
export const extractionSchema = z.object({
  family_friendly_features: z.array(z.string()).default([]),
  walking_features: z.array(z.string()).default([]),
  work_from_home: z.array(z.string()).default([]),
  renovation_risk: z.array(z.string()).default([]),
  community_amenities: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  hoa_signals: z
    .object({
      hoa_mentioned: z.boolean().nullable().default(null),
      fee_text: z.string().nullable().default(null),
      amenities: z.array(z.string()).default([]),
      restrictions_mentioned: z.array(z.string()).default([]),
    })
    .default({
      hoa_mentioned: null,
      fee_text: null,
      amenities: [],
      restrictions_mentioned: [],
    }),
  emotional_fit_summary: z.string().default(""),
  extracted_numeric_hints: z
    .object({
      beds: z.number().nullable().default(null),
      baths: z.number().nullable().default(null),
      sqft: z.number().nullable().default(null),
      year_built: z.number().nullable().default(null),
      lot_size_text: z.string().nullable().default(null),
    })
    .default({
      beds: null,
      baths: null,
      sqft: null,
      year_built: null,
      lot_size_text: null,
    }),
});

export type Extraction = z.infer<typeof extractionSchema>;

const SYSTEM_PROMPT = `You are a real-estate listing analyst. Extract structured
signal from a listing description for a personal home-buying decision tool.

Rules:
- Extract ONLY what the text states or strongly implies. Never invent numbers.
- If something isn't stated, leave it out or note it as a concern.
- Numeric hints are best-effort and may be overridden by the user later.
- Flag uncertainty (e.g. unknown HOA restrictions, possible deferred maintenance)
  in "concerns".
- You may be given a "Property data" block sourced from a licensed property-data
  API (RentCast). Treat those values as authoritative facts about the property —
  more reliable than the listing copy, which is marketing written by the seller.
  Use them to ground your analysis:
  - Lean on the API beds/baths/sqft/lot/year/type when judging layout and fit;
    fill "extracted_numeric_hints" from the LISTING TEXT only (so the user can
    compare the seller's claims against the API facts).
  - Use the valuation and rent estimates to inform financial-fit observations
    (e.g. list price well above the estimated value, or strong rent coverage).
  - Use comparable sales for resale/condition context.
  - When the listing's claims clearly contradict the API data (e.g. the copy
    implies far more space, or omits a known HOA / high taxes), call that out in
    "concerns".
- Always respond by calling the record_listing_features tool.`;

const TOOL = {
  name: "record_listing_features",
  description: "Record the structured features extracted from a listing.",
  input_schema: {
    type: "object" as const,
    properties: {
      family_friendly_features: { type: "array", items: { type: "string" } },
      walking_features: { type: "array", items: { type: "string" } },
      work_from_home: { type: "array", items: { type: "string" } },
      renovation_risk: { type: "array", items: { type: "string" } },
      community_amenities: { type: "array", items: { type: "string" } },
      concerns: { type: "array", items: { type: "string" } },
      hoa_signals: {
        type: "object",
        properties: {
          hoa_mentioned: { type: ["boolean", "null"] },
          fee_text: { type: ["string", "null"] },
          amenities: { type: "array", items: { type: "string" } },
          restrictions_mentioned: { type: "array", items: { type: "string" } },
        },
      },
      emotional_fit_summary: { type: "string" },
      extracted_numeric_hints: {
        type: "object",
        properties: {
          beds: { type: ["number", "null"] },
          baths: { type: ["number", "null"] },
          sqft: { type: ["number", "null"] },
          year_built: { type: ["number", "null"] },
          lot_size_text: { type: ["string", "null"] },
        },
      },
    },
    required: ["emotional_fit_summary"],
  },
};

/**
 * Authoritative property facts from the RentCast enrichment, passed alongside the
 * listing text so the model can ground its analysis in real data rather than the
 * seller's marketing copy. Every field is optional — supply what's available.
 */
export interface PropertyMarketData {
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  lotAcres?: number | null;
  yearBuilt?: number | null;
  propertyType?: string | null;
  hoaMonthly?: number | null;
  taxesAnnual?: number | null;
  lastSalePrice?: number | null;
  lastSaleDate?: string | null;
  valueEstimate?: number | null;
  valueLow?: number | null;
  valueHigh?: number | null;
  rentEstimate?: number | null;
  rentLow?: number | null;
  rentHigh?: number | null;
  comparables?: {
    address?: string | null;
    price?: number | null;
    sqft?: number | null;
    beds?: number | null;
    baths?: number | null;
    distanceMi?: number | null;
    daysOld?: number | null;
  }[];
}

/** True when an Anthropic API key is configured (AI features are available). */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface ExtractInput {
  listingText: string;
  address?: string;
  propertyType?: string;
  /** RentCast-sourced facts to ground the model (optional). */
  marketData?: PropertyMarketData;
}

export interface ExtractResult {
  data: Extraction;
  model: string;
}

const usd = (n: number | null | undefined): string | null =>
  n == null ? null : `$${Math.round(n).toLocaleString("en-US")}`;

const range = (
  lo: number | null | undefined,
  hi: number | null | undefined,
): string => {
  const l = usd(lo);
  const h = usd(hi);
  return l && h ? ` (range ${l}–${h})` : "";
};

/**
 * Render the RentCast facts as a compact, labelled text block. Returns null when
 * there's effectively nothing to share, so we don't add an empty section.
 */
export function formatMarketData(m: PropertyMarketData): string | null {
  const lines: string[] = [];

  const size = [
    m.sqft != null ? `${m.sqft.toLocaleString("en-US")} sqft` : null,
    m.lotAcres != null ? `${m.lotAcres} acre lot` : null,
  ].filter(Boolean);
  const bedbath = [
    m.beds != null ? `${m.beds} bed` : null,
    m.baths != null ? `${m.baths} bath` : null,
  ].filter(Boolean);

  if (m.propertyType) lines.push(`- Property type: ${m.propertyType}`);
  if (bedbath.length) lines.push(`- Beds/baths: ${bedbath.join(" / ")}`);
  if (size.length) lines.push(`- Size: ${size.join(", ")}`);
  if (m.yearBuilt != null) lines.push(`- Year built: ${m.yearBuilt}`);
  if (m.hoaMonthly != null) lines.push(`- HOA: ${usd(m.hoaMonthly)}/month`);
  if (m.taxesAnnual != null)
    lines.push(`- Property taxes: ${usd(m.taxesAnnual)}/year`);
  if (m.lastSalePrice != null || m.lastSaleDate)
    lines.push(
      `- Last sale: ${usd(m.lastSalePrice) ?? "price unknown"}${
        m.lastSaleDate ? ` on ${m.lastSaleDate}` : ""
      }`,
    );
  if (m.valueEstimate != null)
    lines.push(
      `- Estimated value: ${usd(m.valueEstimate)}${range(m.valueLow, m.valueHigh)}`,
    );
  if (m.rentEstimate != null)
    lines.push(
      `- Estimated long-term rent: ${usd(m.rentEstimate)}/month${range(
        m.rentLow,
        m.rentHigh,
      )}`,
    );

  const comps = (m.comparables ?? []).filter((c) => c.address || c.price != null);
  if (comps.length) {
    lines.push("- Comparable sales:");
    for (const c of comps.slice(0, 6)) {
      const parts = [
        usd(c.price),
        c.sqft != null ? `${c.sqft.toLocaleString("en-US")} sqft` : null,
        c.beds != null || c.baths != null
          ? `${c.beds ?? "?"}bd/${c.baths ?? "?"}ba`
          : null,
        c.distanceMi != null ? `${c.distanceMi} mi away` : null,
        c.daysOld != null ? `${c.daysOld} days old` : null,
      ].filter(Boolean);
      lines.push(`  - ${c.address ?? "comparable"}${parts.length ? ` — ${parts.join(", ")}` : ""}`);
    }
  }

  return lines.length ? lines.join("\n") : null;
}

export async function extractListingFeatures(
  input: ExtractInput,
): Promise<ExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const client = new Anthropic({ apiKey });

  const marketBlock = input.marketData
    ? formatMarketData(input.marketData)
    : null;

  const context = [
    input.address ? `Address: ${input.address}` : null,
    input.propertyType ? `Property type: ${input.propertyType}` : null,
    marketBlock
      ? `Property data (authoritative, from a licensed property-data API):\n${marketBlock}`
      : null,
    "Listing description:",
    input.listingText,
  ]
    .filter(Boolean)
    .join("\n\n");

  logInfo("anthropic", "messages.create request", {
    model,
    listingChars: input.listingText.length,
    marketData: marketBlock ? "included" : "none",
  });
  const started = Date.now();

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // Cache the static system prompt to cut cost across many extractions.
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_listing_features" },
      messages: [{ role: "user", content: context }],
    });
  } catch (err) {
    // Anthropic.APIError carries the HTTP status (401 bad key, 429 rate limit,
    // 529 overloaded, ...) — surface it so failures aren't opaque.
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    logError("anthropic", "messages.create failed", {
      model,
      status,
      ms: Date.now() - started,
      error: err,
    });
    throw err;
  }

  logInfo("anthropic", "messages.create response", {
    model,
    ms: Date.now() - started,
    stopReason: message.stop_reason,
    inputTokens: message.usage?.input_tokens,
    outputTokens: message.usage?.output_tokens,
    cacheReadTokens: message.usage?.cache_read_input_tokens,
    cacheWriteTokens: message.usage?.cache_creation_input_tokens,
  });

  const toolUse = message.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    logError("anthropic", "model did not return structured tool output", {
      model,
      stopReason: message.stop_reason,
    });
    throw new Error("Model did not return structured features");
  }

  const data = extractionSchema.parse(toolUse.input);
  return { data, model };
}

// ===========================================================================
// Category-rating suggestions
//
// Propose the seven 1–5 category ratings from everything the app knows about a
// house (facts + AI extraction + RentCast enrichment + drive times), graded
// against the rubric in docs/SCORING.md. The model proposes; the user disposes
// — the suggestions land in the ratings form for review before they're saved.
// ===========================================================================

// Compact rubric (mirrors docs/SCORING.md) so the model grades consistently.
const RUBRIC = `Rate each category 1–5 (1 = poor, 2 = weak, 3 = acceptable, 4 = good, 5 = excellent).

Location / walkability — 5: very strong target area, sidewalks, parks/walkable, safe & pleasant; 3: okay but car-dependent; 1: wrong area, isolated, unsafe, or major traffic.
Community / kids amenities — 5: pool/playground/clubhouse or strong kid-friendly community, not crowded; 3: basic neighborhood, limited amenities; 1: no amenities or poor fit for young kids.
House layout / family fit — 5: 3–4 beds, practical layout, storage, safe yard, WFH space, guest/help space; 3: works with tradeoffs; 1: does not work for family needs.
Schools / childcare fit — 5: strong school zone + childcare/activities access; 3: acceptable but needs research; 1: major school/childcare concern.
Commute / access — 5: easy access to office, Charlotte, airport, stores, activities; 3: acceptable; 1: too far or impractical.
Financial fit — 5: within budget, comfortable monthly cost, reasonable HOA/taxes; 3: at the limit, needs careful review; 1: not financially reasonable.
Condition / risk / resale — 5: move-in ready, low risk, strong resale; 3: some repairs/unknowns; 1: major red flags.`;

const RATINGS_SYSTEM_PROMPT = `You are a home-buying decision assistant. Given a
dossier of everything known about one house, propose a 1–5 rating for each of the
seven scoring categories, following the rubric exactly.

Rules:
- Ground every rating in the dossier. Judge "Financial fit" and "Commute / access"
  against the buyer's stated targets (budget, comfortable monthly, target commute
  times) when provided.
- Treat RentCast/property-API figures and computed drive times as facts; treat the
  listing description as seller marketing (useful but optimistic).
- The buyer's own notes (per-category notes, freeform notes, owner notes) are the
  strongest signal of their priorities and firsthand observations — weight them
  heavily and let them override generic inferences.
- If a "must-have issue / deal-breaker flag" is present, reflect that seriously in
  the relevant category (usually a low rating) and call it out in the rationale.
- When data for a category is thin, rate conservatively toward the middle (3) and
  say so in the rationale — never invent facts.
- Each rationale is ONE short sentence citing the specific evidence used.
- Rate all seven categories. Always respond by calling the record_category_ratings tool.`;

const ratingShape = {
  type: "object" as const,
  properties: {
    rating: { type: "integer", minimum: 1, maximum: 5 },
    rationale: { type: "string" },
  },
  required: ["rating", "rationale"],
};

const RATINGS_TOOL = {
  name: "record_category_ratings",
  description:
    "Record the proposed 1–5 rating and a one-sentence rationale for each of the seven categories.",
  input_schema: {
    type: "object" as const,
    properties: Object.fromEntries(
      CATEGORIES.map((key) => [key, ratingShape]),
    ) as Record<string, typeof ratingShape>,
    required: [...CATEGORIES],
  },
};

const ratingEntrySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  rationale: z.string().default(""),
});

const ratingsSchema = z.object(
  Object.fromEntries(
    CATEGORIES.map((key) => [key, ratingEntrySchema]),
  ) as Record<CategoryKey, typeof ratingEntrySchema>,
);

export interface SuggestedRating {
  rating: number;
  rationale: string;
}

export type SuggestedRatings = Record<CategoryKey, SuggestedRating>;

export interface SuggestRatingsResult {
  ratings: SuggestedRatings;
  model: string;
}

/**
 * Ask the model to propose all seven category ratings from a prebuilt dossier
 * (a labelled, multi-section text snapshot of the property's data). Returns one
 * { rating, rationale } per category. Throws if the model returns no structured
 * output or the API call fails (the caller surfaces the error).
 */
export async function suggestCategoryRatings(
  dossier: string,
): Promise<SuggestRatingsResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const client = new Anthropic({ apiKey });

  const content = `${RUBRIC}\n\n---\nHouse dossier:\n${dossier}`;

  logInfo("anthropic", "messages.create request", {
    model,
    purpose: "category-ratings",
    dossierChars: dossier.length,
  });
  const started = Date.now();

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 1200,
      system: [
        {
          type: "text",
          text: RATINGS_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [RATINGS_TOOL],
      tool_choice: { type: "tool", name: "record_category_ratings" },
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    logError("anthropic", "messages.create failed", {
      model,
      purpose: "category-ratings",
      status,
      ms: Date.now() - started,
      error: err,
    });
    throw err;
  }

  logInfo("anthropic", "messages.create response", {
    model,
    purpose: "category-ratings",
    ms: Date.now() - started,
    stopReason: message.stop_reason,
    inputTokens: message.usage?.input_tokens,
    outputTokens: message.usage?.output_tokens,
    cacheReadTokens: message.usage?.cache_read_input_tokens,
    cacheWriteTokens: message.usage?.cache_creation_input_tokens,
  });

  const toolUse = message.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    logError("anthropic", "model did not return structured tool output", {
      model,
      purpose: "category-ratings",
      stopReason: message.stop_reason,
    });
    throw new Error("Model did not return category ratings");
  }

  const parsed = ratingsSchema.parse(toolUse.input);
  // Zod gives us a plain object keyed by CategoryKey; cast through the known shape.
  const ratings = parsed as unknown as SuggestedRatings;
  return { ratings, model };
}
