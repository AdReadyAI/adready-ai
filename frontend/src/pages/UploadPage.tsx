import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import CampaignSection from "../components/upload/campaign_section/CampaignSection";
import Sidebar from "../components/upload/Sidebar";
import UploadSection from "../components/upload/upload_section/UploadSection";
import ImageUploadSection from "../components/upload/image_section/ImageUploadSection";

export type UploadedVideo = {
  id: string;
  file: File;
  filename: string;
  storagePath: string | null;
  status: "uploading" | "done" | "error";
};

export type UploadedImage = UploadedVideo & {
  kind: "logo" | "product_image";
};

// Supabase Storage rejects non-ASCII characters in object keys (400
// InvalidKey), and an unencoded "#" truncates the URL at the fragment
// delimiter before the request is even sent. Strip diacritics down to their
// base letter, then replace anything else outside a safe ASCII set with "_" —
// this is only used to build the storage path; the original name is kept
// for display.
function sanitizeFilename(name: string): string {
  const withoutDiacritics = name.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return withoutDiacritics.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}

export default function UploadPage() {
  const { user } = useAuth();
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [productImages, setProductImages] = useState<UploadedImage[]>([]);
  const [requestId] = useState(() => crypto.randomUUID());

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
    const path = `${user.id}/${requestId}/video/${video.id}/${sanitizeFilename(video.file.name)}`;
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

  function handleProductImagesSelected(files: File[]) {
    const validFiles = files.filter((f) => f.type.startsWith("image/"));

    const newImages: UploadedImage[] = validFiles.map((file) => {
      // Naming convention (per PM): a file literally named "logo.<ext>" is
      // treated as the logo; everything else in this same field is a plain
      // product image.
      const stem = sanitizeFilename(file.name.replace(/\.[^./]+$/, "")).toLowerCase();
      return {
        id: crypto.randomUUID(),
        file,
        filename: file.name,
        storagePath: null,
        status: "uploading",
        kind: stem === "logo" ? "logo" : "product_image",
      };
    });

    setProductImages((prev) => [...prev, ...newImages]);
    newImages.forEach(uploadProductImage);
  }

  async function uploadProductImage(image: UploadedImage) {
    if (!user) {
      console.error("User not authenticated");
      return;
    }
    const path = `${user.id}/${requestId}/${image.kind}/${image.id}/${sanitizeFilename(image.file.name)}`;
    const { error } = await supabase.storage
      .from("uploads")
      .upload(path, image.file, { contentType: image.file.type });

    setProductImages((prev) =>
      prev.map((img) =>
        img.id === image.id
          ? { ...img, status: error ? "error" : "done", storagePath: error ? null : path }
          : img
      )
    );
  }

  async function removeProductImage(id: string) {
    const image = productImages.find((img) => img.id === id);
    if (image?.storagePath) {
      await supabase.storage.from("uploads").remove([image.storagePath]);
    }
    setProductImages((prev) => prev.filter((img) => img.id !== id));
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
          <ImageUploadSection
            images={productImages}
            onImagesSelected={handleProductImagesSelected}
            onRemoveImage={removeProductImage}
          />
          <CampaignSection videos={videos} images={productImages} requestId={requestId} />
        </div>
        <Sidebar />
      </div>
    </div>
  );
}
