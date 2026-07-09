type VideoCardProps = {
  filename: string
  thumbnailClassName: string
  uploaded: boolean
}

export default function VideoCard({ filename, thumbnailClassName, uploaded }: VideoCardProps) {

    return (
        <div className=" bg-white w-full">
            <div className="border rounded-lg border-[#E2E1DC] relative aspect-video w-full" style={{ backgroundColor: thumbnailClassName }}>
                <div className="absolute top-2 right-2">
                    {uploaded ? (
                        <div className="bg-[#1D9E75] w-6 h-6 p-1 rounded-full text-white text-center text-xs">
                            ✓
                        </div>
                    ) : (
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
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