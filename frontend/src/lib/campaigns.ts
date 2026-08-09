import { supabase } from "./supabaseClient";
import { getErrorMessage } from "./errorMessage";
import type { ParsedCreativeBrief } from "../types/brief";

export type CampaignSummary = {
  batchId: string;
  campaignGoal: string | null;
  createdAt: string;
  videoCount: number;
};

export type CampaignDetail = {
  productUrl: string | null;
  campaignGoal: string | null;
  userBrief: string | null;
  /** raw_text from parsed_creative_briefs — the authoritative brief for the batch. */
  rawText: string | null;
  destinationPlatform: string | null;
  advancedFields: ParsedCreativeBrief | null;
};

/**
 * Lists the current user's previous batches — one entry per batch_id — newest
 * first. RLS on `requests` (auth.uid() = user_id) scopes the rows, so a denied
 * read shows up as an empty array, not an error.
 */
export async function fetchCampaignSummaries(): Promise<CampaignSummary[]> {
  const { data, error } = await supabase
    .from("requests")
    .select("batch_id, campaign_goal, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(getErrorMessage(error, "Failed to load your campaigns"));
  }

  const byBatch = new Map<
    string,
    { campaignGoal: string | null; createdAt: string; videoCount: number }
  >();

  for (const row of data ?? []) {
    const existing = byBatch.get(row.batch_id);
    if (existing) {
      existing.videoCount += 1;
    } else {
      byBatch.set(row.batch_id, {
        campaignGoal: (row.campaign_goal as string | null) ?? null,
        createdAt: row.created_at as string,
        videoCount: 1,
      });
    }
  }

  return [...byBatch.entries()].map(([batchId, info]) => ({
    batchId,
    ...info,
  }));
}

/**
 * Loads everything needed to prefill the campaign form from a previous batch:
 * the batch's shared request fields plus its parsed_creative_briefs row.
 */
export async function fetchCampaignDetail(batchId: string): Promise<CampaignDetail> {
  const [{ data: briefRow, error: briefError }, { data: requestRow, error: requestError }] =
    await Promise.all([
      supabase
        .from("parsed_creative_briefs")
        .select(
          "raw_text, destination_platform, brand_voice, target_audience, required_messages, required_ctas, approved_claims, forbidden_claims, brand_guidelines, policy_requirements"
        )
        .eq("batch_id", batchId)
        .maybeSingle(),
      supabase
        .from("requests")
        .select("product_url, campaign_goal, user_brief")
        .eq("batch_id", batchId)
        .maybeSingle(),
    ]);

  if (briefError) {
    throw new Error(getErrorMessage(briefError, "Failed to load campaign brief"));
  }
  if (requestError) {
    throw new Error(getErrorMessage(requestError, "Failed to load campaign"));
  }

  const advancedFields: ParsedCreativeBrief | null = briefRow
    ? {
        brand_voice: briefRow.brand_voice ?? "",
        target_audience: briefRow.target_audience ?? "",
        required_messages: briefRow.required_messages ?? [],
        required_ctas: briefRow.required_ctas ?? [],
        approved_claims: briefRow.approved_claims ?? [],
        forbidden_claims: briefRow.forbidden_claims ?? [],
        brand_guidelines: briefRow.brand_guidelines ?? [],
        policy_requirements: briefRow.policy_requirements ?? [],
      }
    : null;

  return {
    productUrl: requestRow?.product_url ?? null,
    campaignGoal: requestRow?.campaign_goal ?? null,
    userBrief: requestRow?.user_brief ?? null,
    rawText: briefRow?.raw_text ?? null,
    destinationPlatform: briefRow?.destination_platform ?? null,
    advancedFields,
  };
}