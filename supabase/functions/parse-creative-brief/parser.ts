import { ParsedCreativeBriefSchema } from "../shared/schemas.ts";
import type { ParsedCreativeBrief } from "../shared/schemas.ts";

function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("LLM did not return JSON");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function normalizeParsedBrief(
  rawText: string,
  llmContent: string,
): ParsedCreativeBrief {
  const parsed = extractJsonObject(llmContent);
  return ParsedCreativeBriefSchema.parse({
    ...(typeof parsed === "object" && parsed !== null ? parsed : {}),
    raw_text: rawText,
  });
}
