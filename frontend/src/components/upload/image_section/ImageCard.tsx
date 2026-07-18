import { useEffect, useState } from "react";
import MediaCard from "../MediaCard";

type ImageCardProps = {
  file: File;
  filename: string;
  status: "uploading" | "done" | "error";
  onRemove: () => void;
};

export default function ImageCard({ file, filename, status, onRemove }: ImageCardProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <MediaCard filename={filename} status={status} onRemove={onRemove}>
      {previewUrl && (
        <img src={previewUrl} alt={filename} className="absolute inset-0 h-full w-full object-cover" />
      )}
    </MediaCard>
  );
}
