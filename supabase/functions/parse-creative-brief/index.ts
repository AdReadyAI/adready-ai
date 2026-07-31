import { z } from "zod";
import { createEdgeHandler } from "../shared/handler.ts";
import { chat } from "../shared/llm.ts";
import { ok, err } from "../shared/response.ts";
import { ParsedCreativeBriefSchema } from "../shared/schemas.ts";

const RequestSchema = z.object({
  raw_text: z.string().min(1),
});

type RequestBody = z.infer<typeof RequestSchema>;

const SYSTEM_PROMPT = `You are a creative-brief parser. Extract the following fields from the unstructured brief below and return ONLY valid JSON matching this exact shape (no markdown, no explanation):

{
  "raw_text": "<full original text>",
  "brand_voice": "<string or empty string>",
  "target_audience": "<string or empty string>",
  "required_messages": ["<string>", ...],
  "required_ctas": ["<string>", ...],
  "approved_claims": ["<string>", ...],
  "forbidden_claims": ["<string>", ...],
  "brand_guidelines": ["<string>", ...],
  "policy_requirements": ["<string>", ...]
}

Rules:
- Extract, don't invent. If the brief doesn't mention a field, use "" for strings and [] for arrays.
- Never make up plausible values. A hallucinated forbidden-claim becomes a false failure downstream.
- required_messages, required_ctas, approved_claims, forbidden_claims, brand_guidelines, and policy_requirements are always arrays, even when empty.
- brand_voice and target_audience are always strings, even when empty.
- raw_text must be the complete original text, unchanged.`;

createEdgeHandler("parse-creative-brief", RequestSchema, async (_req, ctx) => {
  const { raw_text } = ctx.body as RequestBody;

  const reply = await chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: raw_text },
  ]);

  try {
    const parsed = JSON.parse(reply);
    const data = ParsedCreativeBriefSchema.parse({ raw_text, ...parsed });
    return ok(data);
  } catch {
    return err("PARSE_FAILED", "The model returned invalid JSON");
  }
});
