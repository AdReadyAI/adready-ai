// Route: /upload — entry point of the flow.
// TODO: build the upload form here — file input for the video, brand/title
// fields, a submit handler that uploads to Supabase Storage and inserts an
// `evaluations` row, then navigates to /loading.
import CampaignSection from "../components/upload/CampaignSection";
import Sidebar from "../components/upload/Sidebar";
import UploadSection from "../components/upload/UploadSection";

export default function UploadPage() {

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-slate-900">
          Let's review your ad creatives.
        </h1>
        <p className="mt-2 text-slate-600">
          Upload your videos and fill in the required details below.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <UploadSection />
          <CampaignSection />
        </div>
        <Sidebar />
      </div>
    </div>
  );
}
