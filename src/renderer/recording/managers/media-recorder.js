
"use strict";

import { 
  toArrayBufferLike, 
  sanitizeFileName, 
  formatTimestampedName 
} from "../utils/general.js";

export const releaseStream = (state) => {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_err) {
        // ignore
      }
    });
  }
  state.mediaStream = null;
};

export const finalizeRecording = async (state, api, updateStatus) => {
  if (!state.recordedChunks.length) {
    updateStatus("Recording stopped.", "neutral");
    return;
  }

  const blob = new Blob(state.recordedChunks, {
    type: state.recordingMimeType,
  });

  try {
    const data = await toArrayBufferLike(blob);
    if (!data) {
      throw new Error("Unable to serialize recording.");
    }

    const payload = {
      data,
      mimeType: state.recordingMimeType,
      defaultPath: formatTimestampedName(),
    };

    if (typeof api?.saveVideo === "function") {
      await api.saveVideo(payload);
      updateStatus("Recording saved.", "success");
    } else {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = sanitizeFileName(payload.defaultPath, "cleanshot-recording.webm");
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      updateStatus("Recording ready for download.", "success");
    }
  } catch (error) {
    console.error("Failed to persist recording", error);
    updateStatus("Recording saved to memory only. Export failed.", "error");
  } finally {
    state.recordedChunks = [];
  }
};

export const createRecorder = (captureStream, mimeType, onDataAvailable, onStop) => {
  const recorder = new MediaRecorder(captureStream, {
    mimeType: mimeType,
  });

  recorder.ondataavailable = (event) => {
    if (event?.data && event.data.size > 0) {
      onDataAvailable(event.data);
    }
  };
  recorder.onstop = onStop;

  return recorder;
};
