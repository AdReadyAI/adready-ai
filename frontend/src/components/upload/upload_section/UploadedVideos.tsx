import VideoCard from "./VideoCard";
import type { UploadedVideo } from "../../../pages/UploadPage";

type UploadedVideosProps = {
    videos: UploadedVideo[]
    onRemoveVideo: (id: string) => void
}

export default function UploadedVideos({ videos, onRemoveVideo }: UploadedVideosProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
            {videos.map((video) => (
                <VideoCard
                    key={video.id}
                    filename={video.filename}
                    status={video.status}
                    onRemove={() => onRemoveVideo(video.id)}
                />
            ))}
        </div>
    )
}
