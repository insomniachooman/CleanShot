
export const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".bmp", ".webp", ".jfif"];

export const isSupportedImageFile = (file) => {
  if (!file) {
    return false;
  }

  if (file.type && file.type.startsWith("image/")) {
    return true;
  }

  const fileName = typeof file.name === "string" ? file.name.toLowerCase() : "";
  return SUPPORTED_IMAGE_EXTENSIONS.some((ext) => fileName.endsWith(ext));
};

export const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file provided."));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("Unsupported file result."));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error("Unable to read file."));
    };

    try {
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error);
    }
  });

export const loadImageFromDataUrl = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
    