import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logInfo, logError } from "./log";

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
