/**
 * llm_json.ts — Tolerant JSON extraction + schema validation for LLM replies.
 *
 * Models are told "return only JSON", but in practice a reply may arrive wrapped
 * in ```json fences or with stray prose. This parses defensively and validates
 * against a Zod schema, returning `null` on ANY failure (not JSON, or shape
 * mismatch) so callers degrade to cannot_assess instead of throwing. It never
 * throws.
 */

import { z } from "zod";

/**
 * Pull the most likely JSON payload out of raw model text: strip a code fence if
 * present, else slice from the first opening bracket to the last matching close.
 */
export function extractJsonText(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : trimmed).trim();

  // Fast path: the body is already valid JSON.
  try {
    JSON.parse(body);
    return body;
  } catch {
    // Fall through to bracket slicing.
  }

  const objStart = body.indexOf("{");
  const arrStart = body.indexOf("[");
  let start = -1;
  let close = "";
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    start = arrStart;
    close = "]";
  } else if (objStart !== -1) {
    start = objStart;
    close = "}";
  }
  if (start === -1) return null;

  const end = body.lastIndexOf(close);
  if (end <= start) return null;
  return body.slice(start, end + 1);
}

/** Parse + validate raw model text against `schema`. Returns null on any failure. */
export function safeParseJson<T>(raw: string, schema: z.ZodType<T>): T | null {
  const text = extractJsonText(raw);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}
