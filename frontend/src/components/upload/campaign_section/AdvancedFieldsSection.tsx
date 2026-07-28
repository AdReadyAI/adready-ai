import { useState } from "react";
import type { AdvancedBriefFields } from "../../../types/brief";
import ChevronDownIcon from "../../icons/ChevronDownIcon";

const TEXT_FIELDS: Array<{ key: "brand_voice" | "target_audience"; label: string; helper: string }> = [
  { key: "brand_voice", label: "Brand Voice", helper: "Tone and voice expectations." },
  { key: "target_audience", label: "Target Audience", helper: "Intended audience." },
];

const LIST_FIELDS: Array<{ key: Exclude<keyof AdvancedBriefFields, "brand_voice" | "target_audience">; label: string; helper: string }> = [
  { key: "required_messages", label: "Required Messages", helper: "Mandatory product or campaign messages." },
  { key: "required_ctas", label: "Required CTAs", helper: "Required CTA language or destination." },
  { key: "approved_claims", label: "Approved Claims", helper: "Claims allowed by the brief or product source." },
  { key: "forbidden_claims", label: "Forbidden Claims", helper: "Claims or policy language that must not appear." },
  { key: "brand_guidelines", label: "Brand Guidelines", helper: "Logo, color, typography, and visual rules." },
  { key: "policy_requirements", label: "Policy Requirements", helper: "Disclaimers, regulatory constraints, platform rules, or category restrictions." },
];

type AdvancedFieldsSectionProps = {
  value: AdvancedBriefFields;
  onChange: (value: AdvancedBriefFields) => void;
};

export default function AdvancedFieldsSection({ value, onChange }: AdvancedFieldsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700"
      >
        Advanced brief details (optional)
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-slate-200 p-4">
          {TEXT_FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={field.key} className="block text-sm font-medium text-slate-700 mb-1">
                {field.label}
              </label>
              <p className="text-xs text-[#9B9A97] mb-1">{field.helper}</p>
              <input
                id={field.key}
                type="text"
                value={value[field.key]}
                onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
                className="w-full bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm text-slate-900 placeholder-[#9B9A97] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
              />
            </div>
          ))}

          {LIST_FIELDS.map((field) => (
            <TagListField
              key={field.key}
              id={field.key}
              label={field.label}
              helper={field.helper}
              values={value[field.key]}
              onChange={(values) => onChange({ ...value, [field.key]: values })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type TagListFieldProps = {
  id: string;
  label: string;
  helper: string;
  values: string[];
  onChange: (values: string[]) => void;
};

function TagListField({ id, label, helper, values, onChange }: TagListFieldProps) {
  const [draft, setDraft] = useState("");

  function commit() {
    const value = draft.trim();
    if (!value) return;
    onChange([...values, value]);
    setDraft("");
  }

  function removeAt(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </label>
      <p className="text-xs text-[#9B9A97] mb-1">{helper}</p>

      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="Type a value and press Enter or Add"
          className="flex-1 bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm text-slate-900 placeholder-[#9B9A97] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
        />
        <button
          type="button"
          onClick={commit}
          className="rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Add
        </button>
      </div>

      {values.length > 0 && (
        <ul className="mt-2 space-y-1">
          {values.map((value, index) => (
            <li
              key={`${value}-${index}`}
              className="flex items-center justify-between rounded-lg border border-[#E2E1DC] bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              <span>{value}</span>
              <button
                type="button"
                onClick={() => removeAt(index)}
                aria-label={`Remove ${value}`}
                className="text-[#9B9A97] hover:text-slate-700"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
