import VideoCard from "./VideoCard";

type Video = {
  id: number
  filename: string
  thumbnailClassName: string
  uploaded: boolean
}

type UploadedVideosProps = {
    videos: Video[]
}

export default function UploadedVideos({ videos }: UploadedVideosProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
            {videos.map((video) => (
                <VideoCard
                    key={video.id}
                    filename={video.filename}
                    thumbnailClassName={video.thumbnailClassName}
                    uploaded={video.uploaded}
                />
            ))}
        </div>
    )
}