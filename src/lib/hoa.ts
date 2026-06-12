// HOA validator (Phase 2). Researches the homeowners association that governs a
// property using the Anthropic web-search tool, then returns a structured
// review — ratings, rules/restrictions, fees, amenities, pros/cons and an
// overall quality verdict — that the app stores in hoa_details. Server-side
// only; the API key is never shipped to the browser.
//
// The LLM call (`researchHoa`) is kept thin and the output shape lives in the
// pure zod `hoaResearchSchema`, so the structured result can be validated (and
// the mapping reasoned about) without the API. See docs/AI_EXTRACTION.md and
// docs/DATA_SOURCES.md (we use a licensed/web-search path, not portal scraping).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logInfo, logWarn, logError } from "./log";

export const FEE_FREQUENCIES = [
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
  "one_time",
  "unknown",
] as const;

export const CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"] as const;

export const hoaSourceSchema = z.object({
  title: z.string().nullable().default(null),
  url: z.string(),
});

// The structured findings the model returns (and that we persist to hoa_details).
export const hoaResearchSchema = z.object({
  hoa_exists: z.boolean().nullable().default(null),
  hoa_name: z.string().nullable().default(null),
  management_company: z.string().nullable().default(null),
  management_contact: z.string().nullable().default(null),
  website: z.string().nullable().default(null),
  fee_amount: z.number().nullable().default(null),
  fee_frequency: z.enum(FEE_FREQUENCIES).default("unknown"),
  special_assessments: z.string().nullable().default(null),
  amenities: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  pet_policy: z.string().nullable().default(null),
  rental_policy: z.string().nullable().default(null),
  declaration_url: z.string().nullable().default(null),
  rating: z.number().min(0).max(5).nullable().default(null),
  review_count: z.number().nullable().default(null),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  verdict: z.string().default(""),
  open_questions: z.array(z.string()).default([]),
  confidence: z.enum(CONFIDENCE_LEVELS).default("unknown"),
  sources: z.array(hoaSourceSchema).default([]),
});

export type HoaResearch = z.infer<typeof hoaResearchSchema>;

/** True when an Anthropic key is configured (HOA research is available). */
export function hoaResearchConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `You are an HOA due-diligence analyst helping a home buyer.
Given a property address (and any known HOA name/fee), research the homeowners
association (HOA / POA / condo association) that governs the property using web
search, then judge how good the HOA is.

Do this:
1. Search the web for the specific HOA / community / subdivision and its
   management company. Look for: official HOA or management-company pages, the
   dues amount and what they cover, CC&Rs / bylaws / rules and restrictions,
   amenities, pet and rental/leasing policies, recent special assessments, fines
   or lawsuits, and resident reviews/ratings (Google, Yelp, Reddit, Nextdoor,
   BBB, HOA-rating sites).
2. Prefer primary/official and recent sources; cross-check claims across pages.
3. Synthesize an overall quality rating from 0 to 5 (5 = excellent) and a short,
   plain-English verdict on how good this HOA is for a buyer, with concrete pros
   and cons.

Rules:
- Use ONLY what sources state or strongly imply. Never invent fees, names, or
  ratings. If something can't be found, leave it null/empty and add it to
  open_questions instead of guessing.
- If you cannot confirm an HOA even exists for this address, set hoa_exists
  accordingly and say so in the verdict.
- Set confidence honestly based on how much you could actually verify.
- Cite every page you relied on in sources.
- Always finish by calling the record_hoa_review tool with your findings.`;

// Custom structured-output tool. Mirrors hoaResearchSchema.
const HOA_TOOL = {
  name: "record_hoa_review",
  description: "Record the structured HOA research findings and overall review.",
  input_schema: {
    type: "object" as const,
    properties: {
      hoa_exists: {
        type: ["boolean", "null"],
        description: "Whether an HOA/POA/condo association governs this property.",
      },
      hoa_name: { type: ["string", "null"] },
      management_company: { type: ["string", "null"] },
      management_contact: {
        type: ["string", "null"],
        description: "Phone, email, or contact page for the management company.",
      },
      website: { type: ["string", "null"] },
      fee_amount: {
        type: ["number", "null"],
        description: "HOA dues amount in dollars, numeric only (no $ or text).",
      },
      fee_frequency: { type: "string", enum: [...FEE_FREQUENCIES] },
      special_assessments: {
        type: ["string", "null"],
        description: "Known or recent special assessments, fines, or litigation.",
      },
      amenities: { type: "array", items: { type: "string" } },
      rules: {
        type: "array",
        items: { type: "string" },
        description: "Notable HOA rules / CC&R restrictions (parking, paint, sheds, etc.).",
      },
      pet_policy: { type: ["string", "null"] },
      rental_policy: {
        type: ["string", "null"],
        description: "Leasing / rental restrictions (caps, minimum lease, etc.).",
      },
      declaration_url: {
        type: ["string", "null"],
        description: "Link to the CC&Rs / declaration / bylaws document if found.",
      },
      rating: {
        type: ["number", "null"],
        description:
          "Overall HOA quality from 0 to 5 (5 = excellent), synthesized from reviews and findings.",
      },
      review_count: {
        type: ["number", "null"],
        description: "Approximate number of public reviews you found, if any.",
      },
      pros: { type: "array", items: { type: "string" } },
      cons: { type: "array", items: { type: "string" } },
      verdict: {
        type: "string",
        description: "A few-sentence review of how good this HOA is and why.",
      },
      open_questions: {
        type: "array",
        items: { type: "string" },
        description: "What the buyer should still verify directly with the HOA.",
      },
      confidence: {
        type: "string",
        enum: [...CONFIDENCE_LEVELS],
        description: "Your confidence given source quality and coverage.",
      },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: ["string", "null"] },
            url: { type: "string" },
          },
          required: ["url"],
        },
        description: "Web pages you used as evidence.",
      },
    },
    required: ["verdict", "confidence"],
  },
};

export interface HoaResearchInput {
  address: string; // full, geocodable address (street + city/state/zip)
  hoaName?: string | null;
  knownFeeMonthly?: number | null;
  listingText?: string | null;
}

export interface HoaResearchResult {
  data: HoaResearch;
  model: string;
}

type Tools = Anthropic.MessageCreateParamsNonStreaming["tools"];

function systemBlocks() {
  return [
    {
      type: "text" as const,
      text: SYSTEM_PROMPT,
      // Cache the static system prompt to cut cost across many lookups.
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

/** One messages.create call; logs timing/usage and surfaces API errors. */
async function create(
  client: Anthropic,
  model: string,
  messages: Anthropic.MessageParam[],
  tools: Tools,
  toolChoice?: Anthropic.MessageCreateParamsNonStreaming["tool_choice"],
): Promise<Anthropic.Message> {
  const started = Date.now();
  logInfo("hoa", "messages.create request", {
    model,
    tools: tools?.map((t) => t.name),
  });
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 3000,
      system: systemBlocks(),
      tools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      messages,
    });
    logInfo("hoa", "messages.create response", {
      model,
      ms: Date.now() - started,
      stopReason: msg.stop_reason,
      inputTokens: msg.usage?.input_tokens,
      outputTokens: msg.usage?.output_tokens,
    });
    return msg;
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    logError("hoa", "messages.create failed", {
      model,
      status,
      ms: Date.now() - started,
      error: err,
    });
    throw err;
  }
}

function findToolUse(
  message: Anthropic.Message,
): Anthropic.ToolUseBlock | null {
  const block = message.content.find(
    (c) => c.type === "tool_use" && c.name === HOA_TOOL.name,
  );
  return block && block.type === "tool_use" ? block : null;
}

/** True when an error looks like "web search isn't enabled for this account". */
function isWebSearchUnavailable(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status !== 400 && err.status !== 403) return false;
  const msg = String(err.message ?? "").toLowerCase();
  return (
    msg.includes("web_search") ||
    msg.includes("web search") ||
    msg.includes("not enabled") ||
    msg.includes("not allowed") ||
    msg.includes("unsupported tool")
  );
}

/**
 * Research a property's HOA and return structured findings. Lets the model use
 * the web-search server tool freely, then collects its record_hoa_review call.
 * Resilient to two common snags: web search not being enabled on the account
 * (retries knowledge-only), and the model ending with prose instead of the tool
 * call (asks once more, forcing the tool).
 */
export async function researchHoa(
  input: HoaResearchInput,
): Promise<HoaResearchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const maxSearches = Number(process.env.HOA_MAX_WEB_SEARCHES || 6);
  const client = new Anthropic({ apiKey });

  const context = [
    `Property address: ${input.address}`,
    input.hoaName ? `Known community/HOA name: ${input.hoaName}` : null,
    input.knownFeeMonthly != null
      ? `Known HOA fee (approx): $${input.knownFeeMonthly}/month`
      : null,
    input.listingText
      ? `Listing description (context only):\n${input.listingText.slice(0, 2000)}`
      : null,
    "",
    "Research this property's HOA and record your findings.",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: context },
  ];

  const webSearchTool = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: maxSearches,
  } as unknown as NonNullable<Tools>[number];

  logInfo("hoa", "research start", {
    address: input.address,
    hoaName: input.hoaName ?? undefined,
  });

  // 1. Let the model search the web, then call our tool (tool_choice: auto).
  let message: Anthropic.Message;
  try {
    message = await create(client, model, messages, [webSearchTool, HOA_TOOL]);
  } catch (err) {
    if (!isWebSearchUnavailable(err)) throw err;
    logWarn("hoa", "web search unavailable; retrying knowledge-only");
    message = await create(client, model, messages, [HOA_TOOL]);
  }

  let toolUse = findToolUse(message);

  // 2. Fallback: model finished with prose — ask again, forcing the tool. We
  //    replay only the assistant's text (not the raw content, which may hold
  //    resolved web_search blocks the tool-free follow-up wouldn't accept).
  if (!toolUse) {
    logWarn("hoa", "no tool call yet; requesting structured output");
    const priorText = message.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    messages.push({
      role: "assistant",
      content: priorText || "(research completed)",
    });
    messages.push({
      role: "user",
      content:
        "Now call record_hoa_review with the structured findings from your research.",
    });
    message = await create(client, model, messages, [HOA_TOOL], {
      type: "tool",
      name: HOA_TOOL.name,
    });
    toolUse = findToolUse(message);
  }

  if (!toolUse) {
    logError("hoa", "model did not return structured HOA findings", {
      stopReason: message.stop_reason,
    });
    throw new Error("Model did not return structured HOA findings");
  }

  const data = hoaResearchSchema.parse(toolUse.input);
  logInfo("hoa", "research complete", {
    address: input.address,
    hoaExists: data.hoa_exists,
    rating: data.rating,
    sources: data.sources.length,
    confidence: data.confidence,
  });
  return { data, model };
}
