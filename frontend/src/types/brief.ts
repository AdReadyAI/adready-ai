// Parsed Creative Brief advanced fields — see docs/agents-md/expected-input-format.md.
// Not yet persisted: `public.requests` has no matching columns until the DB
// migration for these lands, so this only feeds local form state for now.
export type AdvancedBriefFields = {
  brand_voice: string;
  target_audience: string;
  required_messages: string;
  required_ctas: string;
  approved_claims: string;
  forbidden_claims: string;
  brand_guidelines: string;
  policy_requirements: string;
};

export const EMPTY_ADVANCED_BRIEF_FIELDS: AdvancedBriefFields = {
  brand_voice: "",
  target_audience: "",
  required_messages: "",
  required_ctas: "",
  approved_claims: "",
  forbidden_claims: "",
  brand_guidelines: "",
  policy_requirements: "",
};
