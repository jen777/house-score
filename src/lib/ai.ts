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

export interface ExtractInput {
  listingText: string;
  address?: string;
  propertyType?: string;
}

export interface ExtractResult {
  data: Extraction;
  model: string;
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

  const context = [
    input.address ? `Address: ${input.address}` : null,
    input.propertyType ? `Property type: ${input.propertyType}` : null,
    "Listing description:",
    input.listingText,
  ]
    .filter(Boolean)
    .join("\n");

  logInfo("anthropic", "messages.create request", {
    model,
    listingChars: input.listingText.length,
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
