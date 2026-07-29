import Dropzone from "../Dropzone";
import MediaGrid from "../MediaGrid";
import ImageCard from "./ImageCard";
import type { UploadedImage } from "../../../pages/UploadPage";

type ImageUploadSectionProps = {
  images: UploadedImage[];
  onImagesSelected: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
};

export default function ImageUploadSection({ images, onImagesSelected, onRemoveImage }: ImageUploadSectionProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold flex text-slate-900 text-lg items-center gap-2 mb-4">
        <span className="bg-[#534AB7] text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>
        Upload product images & logo
      </h2>
      <Dropzone
        onFilesSelected={onImagesSelected}
        accept="image/png,image/jpeg,image/webp"
        label="Drag & drop product images or your logo here or click to browse"
      />
      <MediaGrid
        items={images}
        renderItem={(image) => (
          <ImageCard
            key={image.id}
            file={image.file}
            filename={image.filename}
            status={image.status}
            onRemove={() => onRemoveImage(image.id)}
          />
        )}
      />
      <p className="text-sm text-[#9B9A97] mt-2">
        {images.length} images uploaded  ·  Accepted formats: PNG, JPEG, WEBP
      </p>
    </section>
  );
}
