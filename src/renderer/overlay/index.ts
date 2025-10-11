
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'region';

const overlay = document.getElementById('overlay-root') as HTMLDivElement;
const mask = document.getElementById('mask') as HTMLDivElement;
const selection = document.getElementById('selection') as HTMLDivElement;
const dims = document.getElementById('dims') as HTMLDivElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const toast = document.getElementById('toast') as HTMLDivElement;
const magnifier = document.getElementById('magnifier') as HTMLDivElement;
const magCanvas = document.getElementById('mag-canvas') as HTMLCanvasElement;
const magReadout = document.getElementById('mag-readout') as HTMLDivElement;
const freezeCanvas = document.getElementById('freeze-canvas') as HTMLCanvasElement;

let dragging = false;
let moving = false;
let resizing: null | string = null;
let start: Point | null = null;
let rect: Rect | null = null;
let frozen = false;
let freezeCtx: CanvasRenderingContext2D | null = null;

init();

async function init() {
  if ((window as any).appApi && mode !== 'window' && mode !== 'display') {
    await freezeScreen();
  }
  bindEvents();
}

async function freezeScreen() {
  try {
    const frame = await (window as any).appApi.overlay.freezeFrame();
    const img = new Image();
    img.src = frame.dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
    });
    freezeCanvas.width = img.naturalWidth;
    freezeCanvas.height = img.naturalHeight;
    const ctx = freezeCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    freezeCtx = ctx;
    frozen = true;
  } catch (e) {
    frozen = false;
  }
}

function bindEvents() {
  overlay.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  hud.addEventListener('click', onHudClick);
  selection.addEventListener('pointerdown', onSelectionPointerDown);
}

function onPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement;
  const handle = target.dataset.handle;
  if (handle) {
    resizing = handle;
    start = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    return;
  }
  if (rect && pointInRect({ x: e.clientX, y: e.clientY }, rect)) {
    moving = true;
    start = { x: e.clientX - rect.x, y: e.clientY - rect.y };
    return;
  }
  dragging = true;
  start = { x: e.clientX, y: e.clientY };
  rect = { x: start.x, y: start.y, width: 0, height: 0 };
  updateUI();
}

function onPointerMove(e: PointerEvent) {
  if (!start) {
    updateCrosshair(e.clientX, e.clientY);
    updateMagnifier(e.clientX, e.clientY);
    return;
  }
  if (dragging && rect) {
    rect.width = Math.abs(e.clientX - start.x);
    rect.height = Math.abs(e.clientY - start.y);
    rect.x = Math.min(start.x, e.clientX);
    rect.y = Math.min(start.y, e.clientY);
    updateUI();
  } else if (moving && rect && start) {
    rect.x = e.clientX - start.x;
    rect.y = e.clientY - start.y;
    updateUI();
  } else if (resizing && rect) {
    resizeRect(resizing, e.clientX, e.clientY);
    updateUI();
  }
  updateMagnifier(e.clientX, e.clientY);
}

function onPointerUp(_e: PointerEvent) {
  dragging = false;
  moving = false;
  resizing = null;
  start = null;
  if (rect && rect.width > 4 && rect.height > 4) {
    showHud();
  } else {
    hideHud();
  }
}

function onSelectionPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement;
  const handle = target.dataset.handle;
  if (handle) {
    resizing = handle;
    start = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (!rect) return;
  const step = e.shiftKey ? 10 : 1;
  let changed = false;
  if (e.key === 'ArrowLeft') { rect.x -= step; changed = true; }
  if (e.key === 'ArrowRight') { rect.x += step; changed = true; }
  if (e.key === 'ArrowUp') { rect.y -= step; changed = true; }
  if (e.key === 'ArrowDown') { rect.y += step; changed = true; }
  if (e.key === 'Escape') { cancelSelection(); }
  if (changed) { updateUI(); }
}

function cancelSelection() {
  rect = null;
  hideHud();
  selection.classList.add('hidden');
}

function updateUI() {
  if (!rect) return;
  selection.classList.remove('hidden');
  selection.style.left = `${rect.x}px`;
  selection.style.top = `${rect.y}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
  dims.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} at ${Math.round(rect.x)}, ${Math.round(rect.y)}`;
  updateMask();
}

function updateMask() {
  if (!rect) return;
  mask.style.clipPath = `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${rect.x}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y + rect.height}px, ${rect.x}px ${rect.y + rect.height}px, ${rect.x}px ${rect.y}px)`;
}

function updateCrosshair(x: number, y: number) {
  const v = document.querySelector('.crosshair .v') as HTMLDivElement;
  const h = document.querySelector('.crosshair .h') as HTMLDivElement;
  v.style.left = `${x}px`;
  h.style.top = `${y}px`;
}

function updateMagnifier(x: number, y: number) {
  if (!frozen || !freezeCtx) {
    magnifier.classList.add('hidden');
    return;
  }
  magnifier.classList.remove('hidden');
  const sz = 16;
  const zoom = 8;
  const sx = Math.max(0, Math.min(freezeCanvas.width - sz, x - Math.floor(sz / 2)));
  const sy = Math.max(0, Math.min(freezeCanvas.height - sz, y - Math.floor(sz / 2)));
  const ctx = magCanvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, magCanvas.width, magCanvas.height);
  ctx.drawImage(freezeCanvas, sx, sy, sz, sz, 0, 0, sz * zoom, sz * zoom);
  const pixel = freezeCtx.getImageData(x, y, 1, 1).data;
  const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
  magReadout.textContent = `${x}, ${y} ${hex}`;
  magnifier.style.left = `${x + 18}px`;
  magnifier.style.top = `${y + 18}px`;
}

function pointInRect(p: Point, r: Rect) {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

function resizeRect(handle: string, mx: number, my: number) {
  if (!rect) return;
  const minSize = 4;
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  let nx = left;
  let ny = top;
  let nr = right;
  let nb = bottom;

  if (handle.includes('t')) ny = Math.min(my, bottom - minSize);
  if (handle.includes('b')) nb = Math.max(my, top + minSize);
  if (handle.includes('l')) nx = Math.min(mx, right - minSize);
  if (handle.includes('r')) nr = Math.max(mx, left + minSize);
  if (handle === 'tm') { ny = Math.min(my, bottom - minSize); }
  if (handle === 'bm') { nb = Math.max(my, top + minSize); }
  if (handle === 'ml') { nx = Math.min(mx, right - minSize); }
  if (handle === 'mr') { nr = Math.max(mx, left + minSize); }

  rect.x = nx;
  rect.y = ny;
  rect.width = nr - nx;
  rect.height = nb - ny;
}

function showHud() {
  if (!rect) return;
  hud.classList.remove('hidden');
  const gap = 14;
  hud.style.left = `${rect.x + rect.width - hud.clientWidth}px`;
  hud.style.top = `${rect.y + rect.height + gap}px`;
}

function hideHud() {
  hud.classList.add('hidden');
}

function onHudClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.tagName !== 'BUTTON') return;
  const action = target.getAttribute('data-action');
  if (!rect) return;
  if (action === 'copy' || action === 'save' || action === 'pin' || action === 'annotate' || action === 'upload' || action === 'open-in') {
    requestCapture(action);
  }
}

async function requestCapture(action: string) {
  if (!(window as any).appApi) return;
  if (!rect) return;
  const opts = {
    kind: 'region',
    includeCursor: false,
    freezeScreen: true,
    region: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    output: { format: 'png', background: { mode: 'transparent' } }
  };
  const res = await (window as any).appApi.capture.request(opts);
  if (action === 'copy') {
    showToast('Copied to clipboard');
  }
  if (action === 'save') {
    showToast(`Saved ${res.width}×${res.height}`);
  }
  if (action === 'pin') {
    await (window as any).appApi.pin.create({ imagePath: res.filePath });
  }
}

function showToast(message: string) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 1600);
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
    