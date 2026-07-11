import UploadedVideos from "./UploadedVideos";
import UploadDropzone from "./UploadDropzone";
import type { UploadedVideo } from "../../../pages/UploadPage";

type UploadSectionProps = {
  videos: UploadedVideo[];
  onFilesSelected: (files: File[]) => void;
};

export default function UploadSection({ videos, onFilesSelected }: UploadSectionProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold flex text-slate-900 text-lg items-center gap-2 mb-4"><span className="bg-[#534AB7] text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>Upload Your Video ad(s)</h2>
      <UploadDropzone onFilesSelected={onFilesSelected} />

      <UploadedVideos videos={videos} />
      <p className="text-sm text-[#9B9A97] mt-2">
        {videos.length} videos uploaded  ·  Accepted formats: MP4, MOV
      </p>
    </section>
  )
}
