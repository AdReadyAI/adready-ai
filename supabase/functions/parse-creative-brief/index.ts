import { z } from "zod";
import {
  createEdgeHandler,
  createSupabaseClient,
  createSupabaseServiceClient,
  err,
  ok,
} from "../shared/index.ts";
import { chat } from "../shared/llm.ts";
import type { ParsedCreativeBrief } from "../shared/schemas.ts";
import { normalizeParsedBrief } from "./parser.ts";

export const ParseCreativeBriefRequestSchema = z.object({
  request_id: z.string().uuid(),
  destination_platform: z.string().trim().min(1).default("unknown"),
  raw_text: z.string().trim().min(1).optional(),
});

type ParseCreativeBriefRequest = z.infer<typeof ParseCreativeBriefRequestSchema>;

const SYSTEM_PROMPT = [
  "You parse advertising creative briefs into strict JSON for downstream evaluation agents.",
  "Return only a JSON object. Do not include markdown, commentary, or extra keys.",
  "Use short, factual strings copied or closely paraphrased from the brief.",
  "If a field is missing or ambiguous, use an empty array for list fields and omit optional string fields.",
].join(" ");

const USER_PROMPT_PREFIX = `
Parse this creative brief into exactly this JSON shape:
{
  "raw_text": string,
  "brand_voice"?: string,
  "target_audience"?: string,
  "required_messages": string[],
  "required_ctas": string[],
  "approved_claims": string[],
  "forbidden_claims": string[],
  "brand_guidelines": string[],
  "policy_requirements": string[]
}

Field guidance:
- brand_voice: tone and voice expectations.
- target_audience: the intended audience.
- required_messages: mandatory product or campaign messages.
- required_ctas: required CTA language, destinations, or actions.
- approved_claims: claims explicitly allowed or supported.
- forbidden_claims: claims or language explicitly prohibited.
- brand_guidelines: tone, visual identity, logo, color, typography, or format rules.
- policy_requirements: disclaimers, regulatory constraints, platform rules, or category restrictions.

Creative brief:
`.trim();

async function loadAuthorizedBriefText(
  req: Request,
  body: ParseCreativeBriefRequest,
): Promise<string> {
  const supabase = createSupabaseClient(req);
  const { data, error } = await supabase
    .from("requests")
    .select("user_brief")
    .eq("request_id", body.request_id)
    .single();

  if (error) throw new Error(`Failed to load request brief: ${error.message}`);

  const rawText = body.raw_text?.trim() ||
    (typeof data?.user_brief === "string" ? data.user_brief.trim() : "");
  if (!rawText) {
    throw err("MISSING_BRIEF", "Request does not have a creative brief", 400);
  }
  return rawText;
}

async function storeParsedBrief(
  requestId: string,
  destinationPlatform: string,
  parsedBrief: ParsedCreativeBrief,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("parsed_creative_briefs")
    .upsert({
      request_id: requestId,
      destination_platform: destinationPlatform,
      raw_text: parsedBrief.raw_text,
      brand_voice: parsedBrief.brand_voice ?? null,
      target_audience: parsedBrief.target_audience ?? null,
      required_messages: parsedBrief.required_messages,
      required_ctas: parsedBrief.required_ctas,
      approved_claims: parsedBrief.approved_claims,
      forbidden_claims: parsedBrief.forbidden_claims,
      brand_guidelines: parsedBrief.brand_guidelines,
      policy_requirements: parsedBrief.policy_requirements,
    });

  if (error) throw new Error(`Failed to store parsed brief: ${error.message}`);
}

createEdgeHandler(
  "parse-creative-brief",
  ParseCreativeBriefRequestSchema,
  async (req, ctx) => {
    const rawText = await loadAuthorizedBriefText(req, ctx.body);
    const llmContent = await chat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${USER_PROMPT_PREFIX}\n\n${rawText}` },
    ]);

    const parsedBrief = normalizeParsedBrief(rawText, llmContent);
    await storeParsedBrief(
      ctx.body.request_id,
      ctx.body.destination_platform,
      parsedBrief,
    );

    return ok({
      request_id: ctx.body.request_id,
      destination_platform: ctx.body.destination_platform,
      parsed_creative_brief: parsedBrief,
    });
  },
);
