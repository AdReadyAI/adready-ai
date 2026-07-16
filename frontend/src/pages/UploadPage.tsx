import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import CampaignSection from "../components/upload/campaign_section/CampaignSection";
import Sidebar from "../components/upload/Sidebar";
import UploadSection from "../components/upload/upload_section/UploadSection";

export type UploadedVideo = {
  id: string;
  file: File;
  filename: string;
  storagePath: string | null;
  status: "uploading" | "done" | "error";
};

export default function UploadPage() {
  const { user } = useAuth();
  const [videos, setVideos] = useState<UploadedVideo[]>([]);

  function handleFilesSelected(files: File[]) {
    const validFiles = files.filter((f) => f.type.startsWith("video/"));

    const newVideos: UploadedVideo[] = validFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      filename: file.name,
      storagePath: null,
      status: "uploading",
    }));

    setVideos((prev) => [...prev, ...newVideos]);
    newVideos.forEach(uploadVideo);
  }

  async function uploadVideo(video: UploadedVideo) {
    if (!user) {
      console.error("User not authenticated");
      return;
    }
    const path = `${user.id}/${video.id}/${video.file.name}`;
    const { error } = await supabase.storage
      .from("uploads")
      .upload(path, video.file, { contentType: video.file.type });

    setVideos((prev) =>
      prev.map((v) =>
        v.id === video.id
          ? { ...v, status: error ? "error" : "done", storagePath: error ? null : path }
          : v
      )
    );
  }

  async function removeVideo(id: string) {
    const video = videos.find((v) => v.id === id);
    if (video?.storagePath) {
      await supabase.storage.from("uploads").remove([video.storagePath]);
    }
    setVideos((prev) => prev.filter((v) => v.id !== id));
  }

  return (
    <div className="space-y-6">
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
          <UploadSection videos={videos} onFilesSelected={handleFilesSelected} onRemoveVideo={removeVideo} />
          <CampaignSection videos={videos} />
        </div>
        <Sidebar />
      </div>
    </div>
  );
}
