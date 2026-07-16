import MediaCard from "../MediaCard";

type VideoCardProps = {
  filename: string
  status: "uploading" | "done" | "error"
  onRemove: () => void
}

export default function VideoCard({ filename, status, onRemove }: VideoCardProps) {
  return (
    <MediaCard filename={filename} status={status} onRemove={onRemove}>
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <span className="text-[#534AB7] h-8 w-8 rounded-full text-xl">▶</span>
      </div>
    </MediaCard>
  )
}
