import { useRef } from "react";

type UploadDropzoneProps = {
  onFilesSelected: (files: File[]) => void;
};

export default function UploadDropzone({ onFilesSelected }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    onFilesSelected(Array.from(e.dataTransfer.files));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      onFilesSelected(Array.from(e.target.files));
      e.target.value = "";
    }
  }

  return (
    <div
      className="rounded-lg border-2 border-dashed h-24 border-[#7B74D4] bg-[#EEEDFE] p-6 text-center flex items-center justify-center cursor-pointer"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/mp4,video/quicktime"
        className="hidden"
        onChange={handleChange}
      />
      <p className="text-[#534AB7] inline-block">
        ↑  Drag & drop your videos here  or  click to browse
      </p>
    </div>
  );
}
