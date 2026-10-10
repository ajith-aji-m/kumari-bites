import { ChangeEvent, MouseEvent } from "react";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 800;

async function readImageAsDataUrl(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const webp = canvas.toDataURL("image/webp", 0.82);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.82);
}

type ImageUploadProps = {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  alt?: string;
  className?: string;
  onError?: (message: string) => void;
};

export function ImageUpload({ value, onChange, name, alt = "Selected image", className = "", onError }: ImageUploadProps) {
  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError?.("Please choose an image file.");
      event.currentTarget.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      onError?.("Please choose an image smaller than 5 MB.");
      event.currentTarget.value = "";
      return;
    }
    readImageAsDataUrl(file)
      .then(onChange)
      .catch(() => onError?.("Could not read that image. Please try another file."))
      .finally(() => { event.currentTarget.value = ""; });
  }

  function removeImage(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onChange("");
  }

  return (
    <div className={"menu-upload-preview category-upload-preview category-single-upload image-upload-component " + className.trim()}>
      {value ? (
        <>
          <img src={value} alt={alt} />
          <button type="button" className="category-image-remove" aria-label="Remove image" title="Remove image" onClick={removeImage}>×</button>
        </>
      ) : (
        <div className="menu-image-empty">
          <span className="menu-upload-plus" aria-hidden="true">+</span>
          <strong>Add image</strong>
          <small>PNG, JPG or WEBP · Max 5 MB</small>
        </div>
      )}
      <label className="image-upload-hit-area" aria-label={value ? "Change image" : "Add image"}>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} />
      </label>
      {name && <input type="hidden" name={name} value={value} readOnly />}
    </div>
  );
}
