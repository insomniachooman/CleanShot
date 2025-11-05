
"use strict";

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const toArrayBufferLike = async (blob) => {
  if (!blob) {
    return null;
  }
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
};

export const sanitizeFileName = (value, fallback) => {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  return value.replace(/[<>:"/\\|?*]/g, "").trim().slice(0, 120) || fallback;
};

export const formatTimestampedName = () => {
  const now = new Date();
  const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `CleanShot Recording ${datePart} ${timePart}.webm`;
};

export const resolveMimeType = () => {
  const MIME_TYPE_ORDER = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  
  for (const candidate of MIME_TYPE_ORDER) {
    if (
      typeof window.MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(candidate)
    ) {
      return candidate;
    }
  }
  return "video/webm";
};

export const getVideoFrameSize = (video) => ({
  width: Math.max(1, video?.videoWidth || 0),
  height: Math.max(1, video?.videoHeight || 0),
});
