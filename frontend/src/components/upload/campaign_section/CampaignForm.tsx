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
  // State, not a ref: the Parse button's enabled/disabled look is derived from
  // this, so React has to re-render when it changes.
  const [lastParsed, setLastParsed] = useState("");
  // video.id → request_id, minted client-side so the requests insert is
  // idempotent (see handleSubmit). Keyed by video id rather than array index
  // so adding or removing a video between a failed submit and a retry can't
  // shift ids onto the wrong rows. A ref, not state, because handleSubmit
  // reads it in the same async pass that writes it — a state update wouldn't
  // be visible in that closure.
  const requestIdsRef = useRef<Map<string, string>>(new Map());
  const [advancedFieldsEdited, setAdvancedFieldsEdited] = useState<Set<string>>(new Set());
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasCompletedVideo = videos.some((v) => v.status === "done");
  const noneUploading = videos.every((v) => v.status !== "uploading");

  // Nothing typed → nothing to parse. Same text as last time → the answer is
  // already on screen, so don't spend another LLM call on it.
  const trimmedBrief = creativeBrief.trim();
  const canParseBrief = Boolean(trimmedBrief) && trimmedBrief !== lastParsed && !parsing;
  const briefAlreadyParsed = Boolean(trimmedBrief) && trimmedBrief === lastParsed;

  const isCreateValid = productUrl.trim() && campaignGoal && destinationPlatform && creativeBrief.trim();
  const isExistingValid = selectedCampaign;
  const isFormValid =
    (mode === "create" ? isCreateValid : isExistingValid) && hasCompletedVideo && noneUploading;

  // Parsing is user-triggered (the "Parse brief" button) rather than fired on
  // blur: blur meant every tab-out or stray click spent an LLM call, and the
  // user had no way to ask for a re-parse or to skip parsing entirely.
  async function handleParseBrief() {
    const text = creativeBrief.trim();
    if (!text || text === lastParsed) return;

    setParsing(true);
    setSubmitError(null);

    try {
      const { data, error } = await supabase.functions.invoke("parse-creative-brief", {
        body: { raw_text: text },
      });

      if (error || !data?.ok) {
        // PARSE_FAILED, SCHEMA_MISMATCH and INTERNAL_ERROR are indistinguishable
        // to the user, so log the code — otherwise a bug report tells us nothing.
        console.error("parse-creative-brief failed:", error ?? data?.error);
        setSubmitError("Brief parsing unavailable — fill in the advanced fields manually.");
        return;
      }

      setLastParsed(text);
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
    } catch (cause) {
      console.error("parse-creative-brief threw:", cause);
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

    const doneVideos = videos.filter((v) => v.status === "done" && v.storagePath);
    const videoPaths = doneVideos.map((v) => v.storagePath as string);

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
    //
    // request_id is minted here instead of by the column's gen_random_uuid()
    // default, which is what makes this insert idempotent. A retry (see the
    // briefError branch below) re-sends the same primary keys, and
    // ignoreDuplicates turns that into ON CONFLICT DO NOTHING rather than a
    // 23505 error. Skipped rows are never inserted, so
    // trg_enqueue_job_on_request_insert (FOR EACH ROW) doesn't fire for them
    // either — a retry can't kick off a second pipeline run per video.
    //
    // DO NOTHING rather than catching 23505 on a plain insert, because the
    // conflict isn't always total: if a video finishes uploading between a
    // failed attempt and the retry, the already-inserted rows must be skipped
    // while the new one still lands. A plain insert would abort the whole
    // statement on the first conflict and silently drop the new video.
    const requestIds = doneVideos.map((v) => {
      const existing = requestIdsRef.current.get(v.id);
      if (existing) return existing;

      const minted = crypto.randomUUID();
      requestIdsRef.current.set(v.id, minted);
      return minted;
    });

    const { error } = await supabase
      .from("requests")
      .upsert(
        doneVideos.map((v, i) => ({
          request_id: requestIds[i],
          batch_id: batchId,
          video_storage_paths: [v.storagePath as string],
          product_image_paths: productImagePaths,
          logo_paths: logoPaths,
          user_brief: creativeBrief,
          product_url: productUrl,
          campaign_goal: campaignGoal,
        })),
        { onConflict: "request_id", ignoreDuplicates: true }
      );

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
      // brief-alignment-agent to read).
      //
      // Clicking submit again from here re-enters handleSubmit from the top,
      // which is safe: the requests insert reuses the same client-minted
      // request_ids and no-ops on conflict, and the brief write is an upsert
      // keyed on batch_id. Both writes are idempotent, so retry is free.
      setSubmitError(
        "Campaign submitted but brief save failed: " + getErrorMessage(briefError, "unknown error"),
      );
      return;
    }

    // batchId goes in the path, not just router state: ResultPage reads it from
    // the URL so a refresh, bookmark, or shared link still resolves the batch.
    navigate(`/result/${batchId}`, {
      state: {
        batchId,
        requestIds,
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
              placeholder="Describe your ad’s goal, key message, and target audience…"
              rows={4}
              className="w-full bg-[#F0EFEB] rounded-lg border border-[#E2E1DC] px-3 py-2 text-sm text-slate-900 placeholder-[#9B9A97] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent resize-none"
            />
            <div className="mt-2 flex items-center gap-3">
              {/* type="button" is load-bearing: the default inside a <form> is
                  "submit", which would fire handleSubmit instead of parsing. */}
              <button
                type="button"
                onClick={handleParseBrief}
                disabled={!canParseBrief}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#534AB7] px-3 py-1.5 text-sm font-medium text-[#534AB7] hover:bg-[#F0EFF9] transition-colors disabled:border-[#E2E1DC] disabled:text-[#9B9A97] disabled:hover:bg-transparent disabled:cursor-not-allowed"
              >
                {parsing ? (
                  <>
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Parsing brief…
                  </>
                ) : (
                  <>✨ {lastParsed ? "Re-parse brief" : "Parse brief"}</>
                )}
              </button>
              <p className="text-xs text-[#9B9A97]">
                {parsing
                  ? "Reading your brief…"
                  : briefAlreadyParsed
                    ? "Brief parsed — edit the text to parse again."
                    : "Fills the advanced fields below automatically. Optional."}
              </p>
            </div>
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
          {parsing ? "Parsing brief…" : submitting ? "Submitting..." : "Run AdReady Review  →"}
        </button>
      </div>
    </form>
  );
}
