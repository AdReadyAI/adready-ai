import { z } from "zod";
import { createEdgeHandler } from "../shared/handler.ts";
import { chat, stripCodeFences } from "../shared/llm.ts";
import { ok, err } from "../shared/response.ts";
import { ParsedCreativeBriefSchema } from "../shared/schemas.ts";

const RequestSchema = z.object({
  raw_text: z.string().min(1),
});

type RequestBody = z.infer<typeof RequestSchema>;

const SYSTEM_PROMPT = `You are a creative-brief parser. Extract the following fields from the unstructured brief below and return ONLY valid JSON matching this exact shape (no markdown, no explanation):

{
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
- Do not echo the original brief back. Return only the extracted fields above.`;

createEdgeHandler("parse-creative-brief", RequestSchema, async (_req, ctx) => {
  const { raw_text } = ctx.body as RequestBody;

  const reply = await chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: raw_text },
  ]);

  let extracted: unknown;
  try {
    extracted = JSON.parse(stripCodeFences(reply));
  } catch (cause) {
    console.error(
      `[parse-creative-brief] ${ctx.requestId} reply was not JSON:`,
      cause instanceof Error ? cause.message : cause,
      "\n--- raw reply ---\n",
      reply,
    );
    return err("PARSE_FAILED", "The model returned invalid JSON");
  }

  // A bare null/array/string parses fine but would spread into a shape Zod
  // accepts via its defaults, silently yielding an empty brief. Reject early.
  if (
    extracted === null || typeof extracted !== "object" ||
    Array.isArray(extracted)
  ) {
    console.error(
      `[parse-creative-brief] ${ctx.requestId} expected a JSON object, got ${
        Array.isArray(extracted) ? "array" : typeof extracted
      }:`,
      "\n--- raw reply ---\n",
      reply,
    );
    return err("SCHEMA_MISMATCH", "The model did not return a JSON object");
  }

  // raw_text is authoritative from the request — spread the model's output
  // first so it can never overwrite the user's actual brief text.
  const result = ParsedCreativeBriefSchema.safeParse({
    ...(extracted as Record<string, unknown>),
    raw_text,
  });

  if (!result.success) {
    console.error(
      `[parse-creative-brief] ${ctx.requestId} JSON parsed but failed schema:`,
      JSON.stringify(result.error.issues),
      "\n--- raw reply ---\n",
      reply,
    );
    return err(
      "SCHEMA_MISMATCH",
      "The model returned JSON in an unexpected shape",
    );
  }

  return ok(result.data);
});
