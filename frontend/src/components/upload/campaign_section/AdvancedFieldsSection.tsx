import { useEffect, useState } from "react";
import type { AdvancedBriefFields } from "../../../types/brief";
import { EMPTY_ADVANCED_BRIEF_FIELDS } from "../../../types/brief";

const LEFT_FIELDS: Array<{ fieldKey: keyof AdvancedBriefFields; label: string; helper: string; placeholder: string }> = [
  { fieldKey: "brand_voice", label: "Brand Voice", helper: "Tone and personality of the brand.", placeholder: "e.g. Friendly, professional, bold…" },
  { fieldKey: "target_audience", label: "Target Audience", helper: "Intended demographic and psychographic profile.", placeholder: "e.g. Women 25-34, health-conscious…" },
  { fieldKey: "approved_claims", label: "Approved Claims", helper: "Pre-approved statements for use in ad content.", placeholder: "e.g. Clinically tested, dermatologist approved…" },
  { fieldKey: "required_messages", label: "Required Messages", helper: "Mandatory product or campaign messages.", placeholder: "e.g. Free shipping over $50, limited time offer…" },
];

const RIGHT_FIELDS: Array<{ fieldKey: keyof AdvancedBriefFields; label: string; helper: string; placeholder: string }> = [
  { fieldKey: "forbidden_claims", label: "Forbidden Claims", helper: "Statements that must not appear in any ad.", placeholder: "e.g. Guaranteed results, FDA approved…" },
  { fieldKey: "brand_guidelines", label: "Brand Guidelines", helper: "Rules for visual identity, tone, and messaging.", placeholder: "e.g. No red backgrounds, always use logo…" },
  { fieldKey: "policy_requirements", label: "Policy Requirements", helper: "Legal or platform compliance rules.", placeholder: "e.g. Include disclaimer, follow ASA guidelines…" },
  { fieldKey: "required_ctas", label: "Required CTAs", helper: "Required CTA language or destination.", placeholder: "e.g. Shop now, Visit our website…" },
];

type AdvancedFieldsSectionProps = {
  isOpen: boolean;
  value: AdvancedBriefFields;
  onSave: (value: AdvancedBriefFields) => void;
  onClose: () => void;
};

export default function AdvancedFieldsSection({ isOpen, value, onSave, onClose }: AdvancedFieldsSectionProps) {
  const [draft, setDraft] = useState<AdvancedBriefFields>(value);

  useEffect(() => {
    if (isOpen) setDraft(value);
  }, [isOpen, value]);

  if (!isOpen) return null;

  function handleFieldChange(key: keyof AdvancedBriefFields, fieldValue: string) {
    setDraft((prev) => ({ ...prev, [key]: fieldValue }));
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div role="dialog" aria-modal="true" aria-labelledby="advanced-settings-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex shrink-0 items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 id="advanced-settings-title" className="text-lg font-semibold text-slate-900">Advanced Settings</h2>
            <p className="mt-1 text-sm text-[#9B9A97]">Auto-populated from your brief. All fields are optional — override as needed.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 overflow-y-auto sm:grid-cols-2">
          <div className="space-y-4">
            {LEFT_FIELDS.map((field) => (
              <Field key={field.fieldKey} {...field} value={draft[field.fieldKey]} onChange={handleFieldChange} />
            ))}
          </div>
          <div className="space-y-4">
            {RIGHT_FIELDS.map((field) => (
              <Field key={field.fieldKey} {...field} value={draft[field.fieldKey]} onChange={handleFieldChange} />
            ))}
          </div>
        </div>

        <div className="mt-6 flex shrink-0 gap-3">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-[#534AB7] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#463E9E] transition-colors"
          >
            Save changes
          </button>
          <button
            type="button"
            onClick={() => setDraft(EMPTY_ADVANCED_BRIEF_FIELDS)}
            className="rounded-lg border border-[#534AB7] px-6 py-2.5 text-sm font-medium text-[#534AB7] hover:bg-[#F0EFF9] transition-colors"
          >
            Reset All
          </button>
        </div>
      </div>
    </div>
  );
}

type FieldProps = {
  fieldKey: keyof AdvancedBriefFields;
  label: string;
  helper: string;
  placeholder: string;
  value: string;
  onChange: (key: keyof AdvancedBriefFields, value: string) => void;
};

function Field({ fieldKey, label, helper, placeholder, value, onChange }: FieldProps) {
  return (
    <div>
      <label htmlFor={fieldKey} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <p className="text-xs text-[#9B9A97] mb-1">{helper}</p>
      <input
        id={fieldKey}
        type="text"
        value={value}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm text-slate-900 placeholder-[#9B9A97] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
      />
    </div>
  );
}
