import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getErrorMessage } from "../../../lib/errorMessage";
import { supabase } from "../../../lib/supabaseClient";
import type { UploadedVideo, UploadedImage } from "../../../pages/UploadPage";
import type { ParsedCreativeBrief } from "../../../types/brief";
import AdvancedFieldsSection from "./AdvancedFieldsSection";

type CampaignMode = "create" | "existing";

const CAMPAIGN_GOALS = [
  "Brand Awareness",
  "Lead Generation",
  "Conversions",
  "Engagement",
  "Video Views",
  "App Installs",
];

const PLATFORMS = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram_reels", label: "Instagram Reels" },
  { value: "meta_feed", label: "Meta Feed" },
  { value: "youtube_shorts", label: "YouTube Shorts" },
];

const MOCK_CAMPAIGNS = [
  "Summer Sale 2026",
  "Product Launch - Widget Pro",
  "Holiday Campaign",
  "Brand Refresh",
];

type CampaignFormProps = {
  videos: UploadedVideo[];
  images: UploadedImage[];
  batchId: string;
};

export default function CampaignForm({ videos, images, batchId }: CampaignFormProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<CampaignMode>("create");
  const [productUrl, setProductUrl] = useState("");
  const [campaignGoal, setCampaignGoal] = useState("");
  const [destinationPlatform, setDestinationPlatform] = useState("");
  const [creativeBrief, setCreativeBrief] = useState("");
  const [advancedFields, setAdvancedFields] = useState<ParsedCreativeBrief>({
    brand_voice: "",
    target_audience: "",
    required_messages: [],
    required_ctas: [],
    approved_claims: [],
    forbidden_claims: [],
    brand_guidelines: [],
    policy_requirements: [],
  });
  const [parsing, setParsing] = useState(false);
  const lastParsedRef = useRef("");
  const [advancedFieldsEdited, setAdvancedFieldsEdited] = useState<Set<string>>(new Set());
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasCompletedVideo = videos.some((v) => v.status === "done");
  const noneUploading = videos.every((v) => v.status !== "uploading");

  const isCreateValid = productUrl.trim() && campaignGoal && destinationPlatform && creativeBrief.trim();
  const isExistingValid = selectedCampaign;
  const isFormValid =
    (mode === "create" ? isCreateValid : isExistingValid) && hasCompletedVideo && noneUploading;

  async function handleBlurBrief() {
    const text = creativeBrief.trim();
    if (!text || text === lastParsedRef.current) return;

    setParsing(true);
    setSubmitError(null);

    try {
      const { data, error } = await supabase.functions.invoke("parse-creative-brief", {
        body: { raw_text: text },
      });

      if (error || !data?.ok) {
        setSubmitError("Brief parsing unavailable — fill in the advanced fields manually.");
        return;
      }

      lastParsedRef.current = text;
      const parsed: ParsedCreativeBrief = {
        brand_voice: data.data.brand_voice ?? "",
        target_audience: data.data.target_audience ?? "",
        required_messages: data.data.required_messages ?? [],
        required_ctas: data.data.required_ctas ?? [],
        approved_claims: data.data.approved_claims ?? [],
        forbidden_claims: data.data.forbidden_claims ?? [],
        brand_guidelines: data.data.brand_guidelines ?? [],
        policy_requirements: data.data.policy_requirements ?? [],
      };

      setAdvancedFields((prev) => {
        const next = { ...prev };
        const newAi = new Set(aiFilled);
        for (const key of Object.keys(parsed) as (keyof ParsedCreativeBrief)[]) {
          if (advancedFieldsEdited.has(key)) continue;
          const val = parsed[key];
          if (Array.isArray(val) ? val.length > 0 : Boolean(val)) {
            (next as Record<string, unknown>)[key] = val;
            newAi.add(key);
          }
        }
        setAiFilled(newAi);
        return next;
      });
    } catch {
      setSubmitError("Brief parsing unavailable — fill in the advanced fields manually.");
    } finally {
      setParsing(false);
    }
  }

  function handleAdvancedChange(field: keyof ParsedCreativeBrief, value: string | string[]) {
    setAdvancedFields((prev) => ({ ...prev, [field]: value }));
    setAdvancedFieldsEdited((prev) => new Set(prev).add(field));
  }

  function handleAdvancedUndo(field: keyof ParsedCreativeBrief) {
    const empty: string | string[] = Array.isArray(advancedFields[field]) ? [] : "";
    setAdvancedFields((prev) => ({ ...prev, [field]: empty }));
    setAiFilled((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const videoPaths = videos
      .filter((v) => v.status === "done" && v.storagePath)
      .map((v) => v.storagePath as string);

    const doneImages = images.filter((img) => img.status === "done" && img.storagePath);
    const productImagePaths = doneImages
      .filter((img) => img.kind === "product_image")
      .map((img) => img.storagePath as string);
    const logoPaths = doneImages
      .filter((img) => img.kind === "logo")
      .map((img) => img.storagePath as string);

    if (mode === "existing") {
      // No `requests` column corresponds to an existing-campaign selection yet —
      // this path stays mock until that concept has a real place to land.
      navigate("/result", { state: { videoPaths, selectedCampaign } });
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    // One `requests` row per video, not one row holding all N paths — the
    // pipeline's video_processing table is UNIQUE(request_id, task_name), so
    // each video needs its own request_id. batch_id ties the group back
    // together for the loading/results UI.
    const { data: requests, error } = await supabase
      .from("requests")
      .insert(
        videoPaths.map((videoPath) => ({
          batch_id: batchId,
          video_storage_paths: [videoPath],
          product_image_paths: productImagePaths,
          logo_paths: logoPaths,
          user_brief: creativeBrief,
          product_url: productUrl,
          campaign_goal: campaignGoal,
        }))
      )
      .select();

    if (error) {
      setSubmitError(getErrorMessage(error, "Failed to submit request"));
      setSubmitting(false);
      return;
    }

    // Persist parsed creative brief — exactly one row per batch, not per request.
    // ⚠️ Insert order matters: requests first (above), then brief. The RLS
    // INSERT policy on parsed_creative_briefs proves ownership by joining
    // through requests.batch_id. Reverse the order and the insert is denied.
    //
    // Also note: trg_enqueue_job_on_request_insert fires inside the requests
    // INSERT transaction above, so the pipeline starts before this row lands.
    // In practice brief-alignment-agent runs late enough that the row is always
    // there by the time it reads it.
    // Upsert (not insert) so a retry after a network blip doesn't dead-end on
    // a batch_id PK conflict when the first attempt actually committed.
    const { error: briefError } = await supabase
      .from("parsed_creative_briefs")
      .upsert(
        {
          batch_id: batchId,
          raw_text: creativeBrief,
          destination_platform: destinationPlatform,
          brand_voice: advancedFields.brand_voice,
          target_audience: advancedFields.target_audience,
          required_messages: advancedFields.required_messages,
          required_ctas: advancedFields.required_ctas,
          approved_claims: advancedFields.approved_claims,
          forbidden_claims: advancedFields.forbidden_claims,
          brand_guidelines: advancedFields.brand_guidelines,
          policy_requirements: advancedFields.policy_requirements,
        },
        { onConflict: "batch_id" }
      );

    setSubmitting(false);

    if (briefError) {
      // Don't navigate — stay on the form so the error below stays visible.
      // Navigating here would unmount the error <p> and silently orphan the
      // batch (requests inserted + pipeline enqueued, but no brief row for
      // brief-alignment-agent to read). The requests are already in flight
      // regardless; retry is safe because the brief write is an upsert.
      setSubmitError(
        "Campaign submitted but brief save failed: " + getErrorMessage(briefError, "unknown error"),
      );
      return;
    }

    navigate("/result", {
      state: {
        batchId,
        requestIds: requests.map((r) => r.request_id),
        productUrl,
        campaignGoal,
        creativeBrief,
        destinationPlatform,
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-6">
      <div className="flex rounded-lg border border-slate-200 bg-slate-50">
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "create"
              ? "bg-[#534AB7] text-white shadow-sm"
              : "bg-[#F0EFF9] text-[#5F5E5A] hover:text-slate-700"
          }`}
        >
          Create new campaign
        </button>
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "existing"
              ? "bg-[#534AB7] text-white shadow-sm"
              : "bg-[#F0EFF9] text-[#5F5E5A] hover:text-slate-700"
          }`}
        >
          Use existing campaign
        </button>
      </div>

      {mode === "create" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="productUrl" className="block text-sm font-medium text-slate-700 mb-1">
                Product URL
              </label>
              <input
                id="productUrl"
                type="url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://your-product-page.com"
                className="w-full bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm text-slate-900 placeholder-[#9B9A97] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="campaignGoal" className="block text-sm font-medium text-slate-700 mb-1">
                Campaign Goal
              </label>
              <select
                id="campaignGoal"
                value={campaignGoal}
                onChange={(e) => setCampaignGoal(e.target.value)}
                className="w-full bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 placeholder-[#9B9A97] text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
              >
                <option value="" disabled>Select a goal</option>
                {CAMPAIGN_GOALS.map((goal) => (
                  <option key={goal} value={goal}>{goal}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="destinationPlatform" className="block text-sm font-medium text-slate-700 mb-1">
                Destination Platform
              </label>
              <select
                id="destinationPlatform"
                value={destinationPlatform}
                onChange={(e) => setDestinationPlatform(e.target.value)}
                className="w-full bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
              >
                <option value="" disabled>Select a platform</option>
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="creativeBrief" className="block text-sm font-medium text-slate-700 mb-1">
              Creative Brief
            </label>
            <textarea
              id="creativeBrief"
              value={creativeBrief}
              onChange={(e) => setCreativeBrief(e.target.value)}
              onBlur={handleBlurBrief}
              placeholder="Describe your ad’s goal, key message, and target audience…"
              rows={4}
              className="w-full bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm text-slate-900 placeholder-[#9B9A97] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent resize-none"
            />
          </div>

          <AdvancedFieldsSection
            values={advancedFields}
            onChange={handleAdvancedChange}
            onUndo={handleAdvancedUndo}
            aiFilled={aiFilled}
            loading={parsing}
          />
        </div>
      ) : (
        <div>
          <label htmlFor="existingCampaign" className="block text-sm font-medium text-slate-700 mb-1">
            Select campaign
          </label>
          <select
            id="existingCampaign"
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            className="w-full bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
          >
            <option value="" disabled>Choose a campaign</option>
            {MOCK_CAMPAIGNS.map((campaign) => (
              <option key={campaign} value={campaign}>{campaign}</option>
            ))}
          </select>
        </div>
      )}

      {submitError && <p className="text-sm text-red-600">{submitError}</p>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[#9B9A97]">🔒  Your videos are secure and never shared.</p>
        <button
          type="submit"
          disabled={!isFormValid || submitting || parsing}
          className="rounded-lg bg-[#534AB7] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#463E9E] transition-colors disabled:text-[#808080] disabled:bg-[#CCCCCC] disabled:cursor-not-allowed"
        >
          {submitting ? "Submitting..." : "Run AdReady Review  →"}
        </button>
      </div>
    </form>
  );
}
