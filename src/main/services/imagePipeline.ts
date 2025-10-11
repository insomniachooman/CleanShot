
import { nativeImage } from 'electron';
import type { OutputOptions } from '@shared/contracts';

// Simple CPU pipeline with drop shadow, padding, and background
export async function performComposite(input: Electron.NativeImage, output: OutputOptions): Promise<Electron.NativeImage> {
  const size = input.getSize();
  const padding = output.padding || 0;
  const canvas = createOffscreen(size.width + padding * 2, size.height + padding * 2);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return input;
  }

  if (output.background?.mode === 'color' && output.background.colorHex) {
    ctx.fillStyle = output.background.colorHex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (output.dropShadow) {
    ctx.save();
    ctx.shadowColor = hexWithOpacity(output.dropShadow.colorHex, output.dropShadow.opacity);
    ctx.shadowBlur = output.dropShadow.radius;
    ctx.shadowOffsetX = output.dropShadow.offsetX;
    ctx.shadowOffsetY = output.dropShadow.offsetY;
    const img = new Image();
    img.src = input.toDataURL();
    await imagePromise(img);
    ctx.drawImage(img, padding, padding);
    ctx.restore();
  } else {
    const img = new Image();
    img.src = input.toDataURL();
    await imagePromise(img);
    ctx.drawImage(img, padding, padding);
  }

  const dataUrl = canvas.toDataURL('image/png');
  return nativeImage.createFromDataURL(dataUrl);
}

function hexWithOpacity(hex: string, opacity: number) {
  const o = Math.max(0, Math.min(1, opacity));
  const alpha = Math.round(o * 255);
  const a = alpha.toString(16).padStart(2, '0');
  const clean = hex.replace('#', '');
  if (clean.length === 6) {
    return `#${clean}${a}`;
  }
  return hex;
}

// Offscreen canvas using node-canvas like pattern via DOM in Electron
function createOffscreen(width: number, height: number): HTMLCanvasElement {
  const canvas = globalThis.document?.createElement('canvas');
  if (!canvas) {
    // Fallback by creating an in memory canvas via DOM-less implementation not available here
    // Return a minimal canvas like object using any
    const fake: any = {};
    fake.width = width;
    fake.height = height;
    fake.getContext = () => null;
    return fake as HTMLCanvasElement;
  }
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function imagePromise(img: HTMLImageElement) {
  return new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
  });
}
    