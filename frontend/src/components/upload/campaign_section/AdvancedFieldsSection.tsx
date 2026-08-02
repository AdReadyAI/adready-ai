import { useState } from "react";
import type { ParsedCreativeBrief } from "../../../types/brief";

type FieldDef = {
  key: keyof ParsedCreativeBrief;
  label: string;
  isArray: boolean;
};

const FIELDS: FieldDef[] = [
  { key: "brand_voice", label: "Brand Voice", isArray: false },
  { key: "target_audience", label: "Target Audience", isArray: false },
  { key: "required_messages", label: "Required Messages", isArray: true },
  { key: "required_ctas", label: "Required CTAs", isArray: true },
  { key: "approved_claims", label: "Approved Claims", isArray: true },
  { key: "forbidden_claims", label: "Forbidden Claims", isArray: true },
  { key: "brand_guidelines", label: "Brand Guidelines", isArray: true },
  { key: "policy_requirements", label: "Policy Requirements", isArray: true },
];

type Props = {
  values: ParsedCreativeBrief;
  onChange: (field: keyof ParsedCreativeBrief, value: string | string[]) => void;
  onUndo: (field: keyof ParsedCreativeBrief) => void;
  aiFilled: Set<string>;
  loading: boolean;
};

const inputClass =
  "w-full bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent";

export default function AdvancedFieldsSection({ values, onChange, onUndo, aiFilled, loading }: Props) {
  const aiCount = aiFilled.size;

  return (
    <details open={aiCount > 0} className="rounded-lg border border-[#E2E1DC] bg-white">
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
        {!loading && aiCount > 0 && (
          <span className="ml-auto text-xs text-[#534AB7]">✨ {aiCount} filled from brief</span>
        )}
      </summary>

      <div className="space-y-5 border-t border-[#E2E1DC] px-4 py-4">
        {FIELDS.map((field) => {
          const val = values[field.key];
          const isAi = aiFilled.has(field.key);

          return (
            <div key={field.key}>
              <div className="mb-1.5 flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">{field.label}</label>
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
                <ArrayField value={val as string[]} onChange={(v) => onChange(field.key, v)} />
              ) : (
                <input
                  type="text"
                  value={val as string}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className={inputClass}
                />
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function ArrayField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
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
          className="flex-1 bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
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
