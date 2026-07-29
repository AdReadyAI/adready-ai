import type { ReactNode } from "react";

type MediaCardProps = {
  filename: string;
  status: "uploading" | "done" | "error";
  onRemove: () => void;
  children: ReactNode;
};

export default function MediaCard({ filename, status, onRemove, children }: MediaCardProps) {
  return (
    <div className="bg-white w-full">
      <div className="border rounded-lg border-[#E2E1DC] relative aspect-video w-full bg-[#F0EFEB] overflow-hidden">
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${filename}`}
          className="absolute top-2 left-2 z-10 bg-white/90 text-slate-600 w-6 h-6 rounded-full text-center text-xs hover:bg-white"
        >
          ✕
        </button>
        <div className="absolute top-2 right-2 z-10">
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
        {children}
      </div>
      <p className="text-xs text-slate-600 mt-2"> {filename} </p>
    </div>
  );
}
