import { useEffect, useState } from "react";
import type { ParsedCreativeBrief } from "../../../types/brief";

type FieldDef = {
  key: keyof ParsedCreativeBrief;
  label: string;
  isArray: boolean;
  required: boolean;
  /** Shown under a required field while it is empty — what the pipeline loses without it. */
  requiredHint?: string;
};

// Required vs optional here is not a style choice — it mirrors the agents'
// deterministic input guards. Each required field below gates at least one
// sub-check: left empty, the agent short-circuits that check to
// `cannot_assess` before the model ever sees it, and the metric comes back
// with a hole in it instead of a verdict. The optional fields are only
// serialized into prompt context, so their absence narrows what the model can
// catch but never drops a check.
//
// Required fields are listed first so the split reads top-to-bottom.
const FIELDS: FieldDef[] = [
  {
    key: "brand_voice",
    label: "Brand Voice",
    isArray: false,
    required: true,
    // brand-alignment-agent/prompts.ts:133 → applyGuidanceGuards (line 57)
    requiredHint: "Without this, Brand Alignment skips the Brand Voice check.",
  },
  {
    key: "target_audience",
    label: "Target Audience",
    isArray: false,
    required: true,
    // brief-alignment-agent/checks.ts:78 → both audience_fit sub-checks
    requiredHint: "Without this, Brief Alignment skips both Audience Fit checks.",
  },
  {
    key: "required_messages",
    label: "Required Messages",
    isArray: true,
    required: true,
    // brief-alignment-agent/checks.ts:69 → required_message_missing
    requiredHint: "Without this, Brief Alignment skips the Required Message check.",
  },
  {
    key: "brand_guidelines",
    label: "Brand Guidelines",
    isArray: true,
    required: true,
    // brand-alignment-agent/checks.ts:57 (logo_absent + logo_incorrect) and
    // prompts.ts:129 (color_palette_off). Those guards match on the text of
    // each guideline, not just on the array being non-empty — hence the
    // wording nudge.
    requiredHint:
      "Without this, Brand Alignment skips the logo and color checks. Mention the logo and the palette/typography rules explicitly.",
  },
  { key: "required_ctas", label: "Required CTAs", isArray: true, required: false },
  { key: "approved_claims", label: "Approved Claims", isArray: true, required: false },
  { key: "forbidden_claims", label: "Forbidden Claims", isArray: true, required: false },
  { key: "policy_requirements", label: "Policy Requirements", isArray: true, required: false },
];

function isBlank(value: string | string[]): boolean {
  return Array.isArray(value) ? value.length === 0 : !value.trim();
}

/**
 * Labels of the required advanced fields still unfilled.
 *
 * Exported so CampaignForm can gate submit on the same list the panel renders
 * from — one source of truth, so a field can't be starred here and ignored
 * there.
 */
export function missingRequiredAdvanced(values: ParsedCreativeBrief): string[] {
  return FIELDS.filter((field) => field.required && isBlank(values[field.key]))
    .map((field) => field.label);
}

type Props = {
  values: ParsedCreativeBrief;
  onChange: (field: keyof ParsedCreativeBrief, value: string | string[]) => void;
  onUndo: (field: keyof ParsedCreativeBrief) => void;
  aiFilled: Set<string>;
  loading: boolean;
};

const inputClass =
  "w-full bg-[#F0EFEB] rounded-lg border px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent";

const borderIdle = "border-[#E2E1DC]";
const borderMissing = "border-[#E0A93B]";

export default function AdvancedFieldsSection({ values, onChange, onUndo, aiFilled, loading }: Props) {
  const aiCount = aiFilled.size;
  const missingCount = missingRequiredAdvanced(values).length;

  // Controlled rather than `open={aiCount > 0}`: submit is blocked on fields
  // that live inside this panel, so it starts open (nothing is filled yet) and
  // reopens when parsing lands new values. Tracking the state instead of
  // driving the attribute directly keeps the user's own collapse from being
  // stomped on the next render.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (aiCount > 0) setOpen(true);
  }, [aiCount]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded-lg border border-[#E2E1DC] bg-white"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <span className="text-slate-400">
          {loading ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            "▸"
          )}
        </span>
        Advanced brief details
        {loading && (
          <span className="ml-auto text-xs text-[#534AB7]">Parsing brief…</span>
        )}
        {!loading && (
          <span className="ml-auto flex items-center gap-3 text-xs">
            {aiCount > 0 && <span className="text-[#534AB7]">✨ {aiCount} filled from brief</span>}
            {missingCount > 0 && (
              <span className="rounded bg-[#FBF0DA] px-1.5 py-0.5 font-medium text-[#8A6216]">
                {missingCount} required field{missingCount === 1 ? "" : "s"} missing
              </span>
            )}
          </span>
        )}
      </summary>

      <div className="space-y-5 border-t border-[#E2E1DC] px-4 py-4">
        <p className="text-xs text-[#6B6A66]">
          Fields marked <span className="text-[#B3261E]">*</span> are required — the review skips
          the checks that depend on them when they are blank.
        </p>

        {FIELDS.map((field) => {
          const val = values[field.key];
          const isAi = aiFilled.has(field.key);
          const isMissing = field.required && isBlank(val);

          return (
            <div key={field.key}>
              <div className="mb-1.5 flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">
                  {field.label}
                  {field.required && <span className="ml-0.5 text-[#B3261E]">*</span>}
                </label>
                {!field.required && (
                  <span className="text-[11px] text-[#9B9A97]">Optional</span>
                )}
                {isAi && (
                  <span className="inline-flex items-center gap-1 rounded bg-[#534AB7]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#534AB7]">
                    ✨ AI
                  </span>
                )}
                {isAi && (
                  <button
                    type="button"
                    onClick={() => onUndo(field.key)}
                    className="text-[10px] text-slate-400 underline hover:text-slate-600"
                  >
                    undo
                  </button>
                )}
              </div>

              {field.isArray ? (
                <ArrayField
                  value={val as string[]}
                  onChange={(v) => onChange(field.key, v)}
                  missing={isMissing}
                />
              ) : (
                <input
                  type="text"
                  value={val as string}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  aria-required={field.required}
                  aria-invalid={isMissing}
                  className={`${inputClass} ${isMissing ? borderMissing : borderIdle}`}
                />
              )}

              {isMissing && field.requiredHint && (
                <p className="mt-1 text-[11px] text-[#8A6216]">{field.requiredHint}</p>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function ArrayField({
  value,
  onChange,
  missing = false,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  missing?: boolean;
}) {
  const [input, setInput] = useState("");

  function addItem() {
    const text = input.trim();
    if (text) {
      onChange([...value, text]);
      setInput("");
    }
  }

  function removeItem(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-1">
      {value.map((item, i) => (
          <div key={i} className="flex items-center gap-2 rounded bg-[#E8E6FD] px-3 py-1.5 text-sm text-slate-900">
          <span className="flex-1">{item}</span>
          <button
            type="button"
            onClick={() => removeItem(i)}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
          placeholder="Add item…"
          aria-invalid={missing}
          className={`flex-1 bg-[#F0EFEB] rounded-lg border ${
            missing ? borderMissing : "border-[#E2E1DC]"
          } px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent`}
        />
        <button
          type="button"
          onClick={addItem}
          disabled={!input.trim()}
          className="rounded-lg bg-[#534AB7] px-3 py-1.5 text-sm text-white hover:bg-[#463E9E] transition-colors disabled:bg-[#CCCCCC] disabled:text-[#808080] disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
    </div>
  );
}
