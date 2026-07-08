import UploadedVideos from "./UploadedVideos";
import UploadDropzone from "./UploadDropzone";

type Video = {
  id: number
  filename: string
  thumbnailClassName: string
  uploaded: boolean
}

type UploadSectionProps = {
    videos: Video[]
}

export default function UploadSection({ videos }: UploadSectionProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-semibold flex gap-2 mb-4"><span className="bg-[#534AB7] text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>Upload Your Video ad(s)</h3>
      <UploadDropzone />

      <UploadedVideos videos={videos} />
      <p className="text-sm text-[#9B9A97] mt-2">
        {videos.length} videos uploaded  ·  Accepted formats: MP4, MOV
      </p>
    </section>
  )
}