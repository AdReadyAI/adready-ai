// Route: /upload — entry point of the flow.
// TODO: build the upload form here — file input for the video, brand/title
// fields, a submit handler that uploads to Supabase Storage and inserts an
// `evaluations` row, then navigates to /loading.
import CampaignSection from "../components/upload/CampaignSection";
import Sidebar from "../components/upload/Sidebar";
import UploadSection from "../components/upload/UploadSection";

const mockVideos = [
{
  id: 1,
  filename: "Video_1.mp4",
  thumbnailClassName: "#DDD6FE",
  uploaded: true,
},
{
  id: 2,
  filename: "Video_2.mp4",
  thumbnailClassName: "#BBF7D0",
  uploaded: true,
},
{
  id: 3,
  filename: "Video_3.mp4",
  thumbnailClassName: "#FDE68A",
  uploaded: true,
},
{
  id: 4,
  filename: "Video_4.mp4",
  thumbnailClassName: "#FECACA",
  uploaded: true,
}
]

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
          <UploadSection videos={mockVideos} />
          <CampaignSection />
        </div>
        <Sidebar />
      </div>
    </div>
  );
}
