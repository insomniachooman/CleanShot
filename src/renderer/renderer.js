const api = window.cleanShot;

const state = {
  sources: [],
  filterValue: "",
  selectedSourceId: null,
  selectedCapture: null,
  screenshotImage: null,
  backgroundMode: "color",
  backgroundColor: "#0f172a",
  padding: 80,
  withShadow: true,
  customImage: null,
  customImageName: "",
  desktopImages: new Map(),
  backgroundDesktopId: null,
  renderQueued: false,
  lastRenderDataUrl: null,
  isCapturing: false,
};

const elements = {
  sourceList: document.getElementById("sourceList"),
  sourceFilterInput: document.getElementById("sourceFilterInput"),
  refreshButton: document.getElementById("refreshSourcesBtn"),
  previewCanvas: document.getElementById("previewCanvas"),
  previewPlaceholder: document.getElementById("previewPlaceholder"),
  previewLoading: document.getElementById("previewLoading"),
  paddingSlider: document.getElementById("paddingSlider"),
  paddingValueLabel: document.getElementById("paddingValueLabel"),
  shadowToggle: document.getElementById("shadowToggle"),
  shadowSwitch: document.querySelector(".toggle-field .switch"),
  statusMessage: document.getElementById("statusMessage"),
  saveButton: document.getElementById("saveImageBtn"),
  segmentButtons: Array.from(
    document.querySelectorAll(".segment-control .segment"),
  ),
  colorPickerField: document.getElementById("colorPickerField"),
  backgroundColorInput: document.getElementById("backgroundColorInput"),
  imagePickerField: document.getElementById("imagePickerField"),
  chooseImageBtn: document.getElementById("chooseImageBtn"),
  backgroundImageInput: document.getElementById("backgroundImageInput"),
  imageNameLabel: document.getElementById("imageNameLabel"),
};

const canvasContext = elements.previewCanvas.getContext("2d");
let statusTimeoutHandle = undefined;

const setStatus = (message, tone = "neutral", persistMs = 3800) => {
  if (!elements.statusMessage) {
    return;
  }

  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.remove("success", "error");

  if (tone === "success") {
    elements.statusMessage.classList.add("success");
  } else if (tone === "error") {
    elements.statusMessage.classList.add("error");
  }

  if (statusTimeoutHandle) {
    clearTimeout(statusTimeoutHandle);
    statusTimeoutHandle = undefined;
  }

  if (message && tone !== "error" && persistMs > 0) {
    statusTimeoutHandle = window.setTimeout(() => {
      elements.statusMessage.textContent = "";
      elements.statusMessage.classList.remove("success", "error");
      statusTimeoutHandle = undefined;
    }, persistMs);
  }
};

const togglePreviewLoading = (show) => {
  elements.previewLoading.style.display = show ? "flex" : "none";
};

const showPlaceholder = (show) => {
  elements.previewPlaceholder.style.display = show ? "block" : "none";
  elements.previewCanvas.style.display = show ? "none" : "block";
};

const syncShadowSwitch = () => {
  if (!elements.shadowSwitch) {
    return;
  }

  if (state.withShadow) {
    elements.shadowSwitch.classList.add("is-active");
  } else {
    elements.shadowSwitch.classList.remove("is-active");
  }
};

const updateBackgroundFields = () => {
  elements.colorPickerField.classList.toggle(
    "is-hidden",
    state.backgroundMode !== "color",
  );
  elements.imagePickerField.classList.toggle(
    "is-hidden",
    state.backgroundMode !== "image",
  );
};

const updateSegmentControls = () => {
  elements.segmentButtons.forEach((button) => {
    const mode = button.dataset.mode;
    const isActive = mode === state.backgroundMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-checked", isActive ? "true" : "false");
  });
};

const filterSources = (sources, query) => {
  if (!query) {
    return sources;
  }

  const lowerQuery = query.toLowerCase();
  return sources.filter((source) =>
    source.name.toLowerCase().includes(lowerQuery),
  );
};

const createSourceCard = (source) => {
  const button = document.createElement("button");
  button.className = "source-card";
  button.type = "button";
  button.dataset.id = source.id;
  if (source.id === state.selectedSourceId) {
    button.classList.add("active");
  }

  const thumb = document.createElement("div");
  thumb.className = "source-thumb";

  if (source.thumbnail) {
    const img = document.createElement("img");
    img.src = source.thumbnail;
    img.alt = `${source.name} preview`;
    thumb.appendChild(img);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "fallback-icon";
    fallback.textContent = source.type === "screen" ? "🖥" : "🗔";
    thumb.appendChild(fallback);
  }

  const meta = document.createElement("div");
  meta.className = "source-meta";

  const title = document.createElement("div");
  title.className = "source-title";
  title.textContent =
    source.name.length > 48
      ? `${source.name.slice(0, 45)}...`
      : source.name || "Untitled";

  const subtitle = document.createElement("div");
  subtitle.className = "source-subtitle";

  const typeBadge = document.createElement("span");
  typeBadge.className = "source-badge";
  typeBadge.textContent =
    source.type === "screen" ? "Display" : "Window";

  subtitle.appendChild(typeBadge);
  if (source.displayId) {
    const displayLabel = document.createElement("span");
    displayLabel.textContent = `Display ${source.displayId}`;
    subtitle.appendChild(displayLabel);
  }

  meta.appendChild(title);
  meta.appendChild(subtitle);

  button.appendChild(thumb);
  button.appendChild(meta);
  return button;
};

const renderSourceList = () => {
  if (!elements.sourceList) {
    return;
  }

  elements.sourceList.innerHTML = "";

  const visibleSources = filterSources(state.sources, state.filterValue);

  if (visibleSources.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "preview-placeholder";
    emptyState.innerHTML = `
      <h3>No matching windows</h3>
      <p>Try refreshing the list or search for a different window title.</p>
    `;
    elements.sourceList.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleSources.forEach((source) => {
    fragment.appendChild(createSourceCard(source));
  });

  elements.sourceList.appendChild(fragment);
};

const loadImageFromDataUrl = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });

const getRoundedRectPath = (ctx, x, y, width, height, radius) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

const drawCoverImage = (ctx, image, width, height) => {
  const imageRatio = image.width / image.height;
  const canvasRatio = width / height;

  let drawWidth = width;
  let drawHeight = height;
  let offsetX = 0;
  let offsetY = 0;

  if (imageRatio > canvasRatio) {
    drawHeight = height;
    drawWidth = imageRatio * drawHeight;
    offsetX = (width - drawWidth) / 2;
  } else {
    drawWidth = width;
    drawHeight = drawWidth / imageRatio;
    offsetY = (height - drawHeight) / 2;
  }

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
};

const ensureDesktopBackground = async (targetDisplayId) => {
  const candidate =
    state.sources.find(
      (source) =>
        source.type === "screen" &&
        source.displayId &&
        targetDisplayId &&
        source.displayId === targetDisplayId,
    ) ||
    state.sources.find((source) => source.type === "screen");

  if (!candidate) {
    setStatus(
      "No desktop sources available. Try refreshing the sources list.",
      "error",
      6000,
    );
    return null;
  }

  if (state.desktopImages.has(candidate.id)) {
    state.backgroundDesktopId = candidate.id;
    return state.desktopImages.get(candidate.id).image;
  }

  try {
    const capture =
      typeof api.captureDesktopWallpaper === "function"
        ? await api.captureDesktopWallpaper({
            sourceId: candidate.id,
            displayId: candidate.displayId || null,
            name: candidate.name || "",
          })
        : await api.captureSource(candidate.id);
    const image = await loadImageFromDataUrl(capture.dataURL);
    state.desktopImages.set(candidate.id, { image, capture });
    state.backgroundDesktopId = candidate.id;
    return image;
  } catch (error) {
    console.error("Failed to capture desktop background", error);
    setStatus("Unable to capture desktop background.", "error", 6000);
    return null;
  }
};

const drawScene = async () => {
  if (!state.screenshotImage) {
    showPlaceholder(true);
    state.lastRenderDataUrl = null;
    return;
  }

  const img = state.screenshotImage;
  const baseWidth = img.naturalWidth || img.width;
  const baseHeight = img.naturalHeight || img.height;
  const padding = state.padding;
  const cornerRadius = 26;
  const shadowEnabled = state.withShadow;

  const shadowBlur = shadowEnabled ? Math.min(90, Math.max(24, padding * 0.65)) : 0;
  const shadowOffsetY = shadowEnabled ? Math.min(70, Math.round(padding * 0.55)) : 0;
  const shadowPadX = shadowEnabled ? shadowBlur : 0;
  const shadowPadYTop = shadowEnabled ? shadowBlur : 0;
  const shadowPadYBottom = shadowEnabled ? shadowBlur + shadowOffsetY : 0;

  const canvasWidth =
    baseWidth + padding * 2 + shadowPadX * 2;
  const canvasHeight =
    baseHeight + padding * 2 + shadowPadYTop + shadowPadYBottom;

  elements.previewCanvas.width = canvasWidth;
  elements.previewCanvas.height = canvasHeight;

  canvasContext.save();
  canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);

  // Background treatment
  switch (state.backgroundMode) {
    case "transparent":
      canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);
      break;
    case "color":
      canvasContext.fillStyle = state.backgroundColor;
      canvasContext.fillRect(0, 0, canvasWidth, canvasHeight);
      break;
    case "desktop": {
      const imageEntry =
        (state.backgroundDesktopId &&
          state.desktopImages.get(state.backgroundDesktopId)) ||
        null;
      if (!imageEntry) {
        await ensureDesktopBackground(
          state.selectedCapture?.displayId || null,
        );
        const refreshedEntry =
          state.backgroundDesktopId &&
          state.desktopImages.get(state.backgroundDesktopId);
        if (refreshedEntry) {
          drawCoverImage(canvasContext, refreshedEntry.image, canvasWidth, canvasHeight);
        } else {
          const gradient = canvasContext.createLinearGradient(
            0,
            0,
            canvasWidth,
            canvasHeight,
          );
          gradient.addColorStop(0, "#141932");
          gradient.addColorStop(1, "#090b1b");
          canvasContext.fillStyle = gradient;
          canvasContext.fillRect(0, 0, canvasWidth, canvasHeight);
        }
      } else {
        drawCoverImage(canvasContext, imageEntry.image, canvasWidth, canvasHeight);
      }
      break;
    }
    case "image":
      if (state.customImage) {
        drawCoverImage(canvasContext, state.customImage, canvasWidth, canvasHeight);
      } else {
        const gradient = canvasContext.createLinearGradient(
          0,
          0,
          canvasWidth,
          canvasHeight,
        );
        gradient.addColorStop(0, "#141932");
        gradient.addColorStop(1, "#090b1b");
        canvasContext.fillStyle = gradient;
        canvasContext.fillRect(0, 0, canvasWidth, canvasHeight);
      }
      break;
    default: {
      const gradient = canvasContext.createLinearGradient(
        0,
        0,
        canvasWidth,
        canvasHeight,
      );
      gradient.addColorStop(0, "#141932");
      gradient.addColorStop(1, "#090b1b");
      canvasContext.fillStyle = gradient;
      canvasContext.fillRect(0, 0, canvasWidth, canvasHeight);
      break;
    }
  }

  const drawX = padding + shadowPadX;
  const drawY = padding + shadowPadYTop;

  if (shadowEnabled) {
    canvasContext.save();
    canvasContext.fillStyle = "rgba(11, 15, 34, 0.01)";
    canvasContext.shadowColor = "rgba(8, 12, 32, 0.55)";
    canvasContext.shadowBlur = shadowBlur;
    canvasContext.shadowOffsetX = 0;
    canvasContext.shadowOffsetY = shadowOffsetY;
    getRoundedRectPath(
      canvasContext,
      drawX,
      drawY,
      baseWidth,
      baseHeight,
      cornerRadius,
    );
    canvasContext.fill();
    canvasContext.restore();
  }

  canvasContext.save();
    getRoundedRectPath(
      canvasContext,
      drawX,
      drawY,
      baseWidth,
      baseHeight,
      cornerRadius,
    );
    canvasContext.clip();
    canvasContext.drawImage(
      img,
      drawX,
      drawY,
      baseWidth,
      baseHeight,
    );
  canvasContext.restore();
  canvasContext.restore();

  const maxPreviewWidth = 980;
  const maxPreviewHeight = 560;
  const scale = Math.min(
    1,
    maxPreviewWidth / canvasWidth,
    maxPreviewHeight / canvasHeight,
  );

  elements.previewCanvas.style.width = `${Math.round(canvasWidth * scale)}px`;
  elements.previewCanvas.style.height = `${Math.round(canvasHeight * scale)}px`;
  showPlaceholder(false);

  state.lastRenderDataUrl = elements.previewCanvas.toDataURL("image/png");
};

const scheduleRender = () => {
  if (!state.screenshotImage) {
    showPlaceholder(true);
    return;
  }

  if (state.renderQueued) {
    return;
  }

  state.renderQueued = true;
  window.requestAnimationFrame(async () => {
    state.renderQueued = false;
    await drawScene();
    elements.saveButton.disabled = !state.lastRenderDataUrl;
  });
};

const handleBackgroundModeChange = async (mode) => {
  if (state.backgroundMode === mode) {
    return;
  }

  state.backgroundMode = mode;
  updateSegmentControls();
  updateBackgroundFields();

  if (mode === "desktop") {
    await ensureDesktopBackground(state.selectedCapture?.displayId || null);
  } else if (mode === "image" && !state.customImage) {
    setStatus("Upload a custom background to activate this mode.", "neutral");
  } else if (mode === "transparent") {
    setStatus("Background set to transparent PNG.", "neutral");
  }

  scheduleRender();
};

const handleSourceSelection = async (sourceId) => {
  if (state.isCapturing || !sourceId) {
    return;
  }

  state.isCapturing = true;
  togglePreviewLoading(true);
  setStatus("Capturing window...", "neutral", 0);

  try {
    const capture = await api.captureSource(sourceId);
    const image = await loadImageFromDataUrl(capture.dataURL);

    state.selectedSourceId = sourceId;
    state.selectedCapture = capture;
    state.screenshotImage = image;

    if (state.backgroundMode === "desktop") {
      await ensureDesktopBackground(capture.displayId || null);
    }

    renderSourceList();
    setStatus(
      `Captured ${capture.width} × ${capture.height} from ${capture.name}.`,
      "success",
    );
    scheduleRender();
  } catch (error) {
    console.error("Failed to capture source", error);
    setStatus("Unable to capture that window. Try again.", "error", 6000);
  } finally {
    togglePreviewLoading(false);
    state.isCapturing = false;
  }
};

const handleSave = async () => {
  if (!state.lastRenderDataUrl) {
    setStatus("Nothing to export yet. Capture a window first.", "error", 5000);
    return;
  }

  elements.saveButton.disabled = true;
  setStatus("Preparing export...", "neutral", 0);

  try {
    const defaultPath = state.selectedCapture?.name
      ? `${state.selectedCapture.name.replace(/[\\/:*?"<>|]/g, "")}.png`
      : undefined;
    const result = await api.saveImage({
      dataURL: state.lastRenderDataUrl,
      defaultPath,
    });

    if (result.canceled) {
      setStatus("Export cancelled.", "neutral");
    } else {
      setStatus(`Saved to ${result.filePath}`, "success", 6000);
    }
  } catch (error) {
    console.error("Failed to save image", error);
    setStatus("Export failed. Please try again.", "error", 6000);
  } finally {
    elements.saveButton.disabled = false;
  }
};

const handleCustomImageSelection = async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = async (loadEvent) => {
    try {
      const dataUrl = loadEvent.target?.result;
      if (typeof dataUrl !== "string") {
        throw new Error("Invalid file data");
      }
      const image = await loadImageFromDataUrl(dataUrl);
      state.customImage = image;
      state.customImageName = file.name;
      elements.imageNameLabel.textContent = file.name;
      await handleBackgroundModeChange("image");
    } catch (error) {
      console.error("Failed to load custom background image", error);
      setStatus("Could not load that image.", "error", 5000);
    }
  };
  reader.onerror = () => {
    setStatus("Could not read that file.", "error", 5000);
  };
  reader.readAsDataURL(file);
};

const bindEvents = () => {
  elements.refreshButton?.addEventListener("click", () => {
    loadSources();
  });

  elements.sourceFilterInput?.addEventListener("input", (event) => {
    state.filterValue = event.target.value || "";
    renderSourceList();
  });

  elements.sourceList?.addEventListener("click", (event) => {
    const card = event.target.closest(".source-card");
    if (card?.dataset?.id) {
      handleSourceSelection(card.dataset.id);
    }
  });

  elements.segmentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      handleBackgroundModeChange(button.dataset.mode);
    });
  });

  elements.backgroundColorInput?.addEventListener("input", (event) => {
    state.backgroundColor = event.target.value;
    scheduleRender();
  });

  elements.paddingSlider?.addEventListener("input", (event) => {
    const value = Number.parseInt(event.target.value, 10);
    state.padding = value;
    elements.paddingValueLabel.textContent = `${value} px`;
    scheduleRender();
  });

  elements.shadowToggle?.addEventListener("change", (event) => {
    state.withShadow = Boolean(event.target.checked);
    syncShadowSwitch();
    scheduleRender();
  });

  elements.saveButton?.addEventListener("click", () => {
    handleSave();
  });

  elements.chooseImageBtn?.addEventListener("click", () => {
    elements.backgroundImageInput?.click();
  });

  elements.backgroundImageInput?.addEventListener(
    "change",
    handleCustomImageSelection,
  );
};

const loadSources = async () => {
  try {
    setStatus("Scanning for windows...", "neutral", 0);
    const sources = await api.listSources();
    state.sources = sources;
    renderSourceList();
    setStatus(`Found ${sources.length} capture sources.`);
  } catch (error) {
    console.error("Failed to load sources", error);
    setStatus("Unable to list windows. Try refreshing.", "error", 5000);
  }
};

const init = () => {
  if (!api) {
    setStatus(
      "Renderer bridge unavailable. Please restart the application.",
      "error",
      0,
    );
    return;
  }

  if (elements.paddingSlider) {
    const sliderValue = Number.parseInt(elements.paddingSlider.value, 10);
    if (!Number.isNaN(sliderValue)) {
      state.padding = sliderValue;
      elements.paddingValueLabel.textContent = `${sliderValue} px`;
    }
  }

  if (elements.backgroundColorInput?.value) {
    state.backgroundColor = elements.backgroundColorInput.value;
  }

  if (elements.shadowToggle) {
    state.withShadow = Boolean(elements.shadowToggle.checked);
  }

  syncShadowSwitch();
  updateBackgroundFields();
  updateSegmentControls();
  bindEvents();
  loadSources();
};

document.addEventListener("DOMContentLoaded", init);
