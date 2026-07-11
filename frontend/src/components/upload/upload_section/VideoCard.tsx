type VideoCardProps = {
  filename: string
  status: "uploading" | "done" | "error"
  onRemove: () => void
}

export default function VideoCard({ filename, status, onRemove }: VideoCardProps) {

    return (
        <div className=" bg-white w-full">
            <div className="border rounded-lg border-[#E2E1DC] relative aspect-video w-full bg-[#F0EFEB]">
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Remove ${filename}`}
                    className="absolute top-2 left-2 bg-white/90 text-slate-600 w-6 h-6 rounded-full text-center text-xs hover:bg-white"
                >
                    ✕
                </button>
                <div className="absolute top-2 right-2">
                    {status === "done" && (
                        <div className="bg-[#1D9E75] w-6 h-6 p-1 rounded-full text-white text-center text-xs">
                            ✓
                        </div>
                    )}
                    {status === "uploading" && (
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                    )}
                    {status === "error" && (
                        <div className="bg-red-600 w-6 h-6 p-1 rounded-full text-white text-center text-xs">
                            !
                        </div>
                    )}
                </div>
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <span className=" text-[#534AB7] h-8 w-8 rounded-full text-xl">▶</span>
                </div>
            </div>
            <p className="text-xs text-slate-600 mt-2"> {filename} </p>
        </div>
    )

}
