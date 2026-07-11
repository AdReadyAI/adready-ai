import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { UploadedVideo } from "../../../pages/UploadPage";

type CampaignMode = "create" | "existing";

const CAMPAIGN_GOALS = [
  "Brand Awareness",
  "Lead Generation",
  "Conversions",
  "Engagement",
  "Video Views",
  "App Installs",
];

const MOCK_CAMPAIGNS = [
  "Summer Sale 2026",
  "Product Launch - Widget Pro",
  "Holiday Campaign",
  "Brand Refresh",
];

type CampaignFormProps = {
  videos: UploadedVideo[];
};

export default function CampaignForm({ videos }: CampaignFormProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<CampaignMode>("create");
  const [productUrl, setProductUrl] = useState("");
  const [campaignGoal, setCampaignGoal] = useState("");
  const [creativeBrief, setCreativeBrief] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState("");

  const hasCompletedVideo = videos.some((v) => v.status === "done");
  const noneUploading = videos.every((v) => v.status !== "uploading");

  const isCreateValid = productUrl.trim() && campaignGoal && creativeBrief.trim();
  const isExistingValid = selectedCampaign;
  const isFormValid =
    (mode === "create" ? isCreateValid : isExistingValid) && hasCompletedVideo && noneUploading;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const videoPaths = videos
      .filter((v) => v.status === "done" && v.storagePath)
      .map((v) => v.storagePath as string);

    navigate("/loading", {
      state:
        mode === "create"
          ? { videoPaths, productUrl, campaignGoal, creativeBrief }
          : { videoPaths, selectedCampaign },
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
          <div className="grid grid-cols-2 gap-4">
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
          </div>
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-[#9B9A97]">🔒  Your videos are secure and never shared.</p>
        <button
          type="submit"
          disabled={!isFormValid}
          className="rounded-lg bg-[#534AB7] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#463E9E] transition-colors disabled:text-[#808080] disabled:bg-[#CCCCCC] disabled:cursor-not-allowed"
        >
          Run AdReady Review  →
        </button>
      </div>
    </form>
  );
}
