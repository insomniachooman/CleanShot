
import { BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, nativeImage } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Settings, CaptureOptions, CaptureResult } from '@shared/contracts';
import { performComposite } from '../services/imagePipeline';
import { createPinWindow } from '../windows/pinWindow';

export function registerIpcHandlers(store: any) {
  ipcMain.handle('settings:get', () => {
    return store.store as Settings;
  });

  ipcMain.handle('settings:set', (_e, next: Partial<Settings>) => {
    Object.entries(next).forEach(([k, v]) => store.set(k, v));
    return store.store as Settings;
  });

  ipcMain.handle('overlay:freezeFrame', async () => {
    // Development fallback using desktopCapturer for a frozen frame
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 4096, height: 4096 } });
    const primary = sources[0];
    const image = primary.thumbnail;
    const dataUrl = image.toDataURL();
    return { dataUrl, width: image.getSize().width, height: image.getSize().height, scale: 1 };
  });

  ipcMain.handle('capture:request', async (_e, options: CaptureOptions): Promise<CaptureResult> => {
    // Development fallback path using desktopCapturer and cropping
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 8192, height: 8192 } });
    const src = sources.find(s => s.display_id === options.displayId) || sources[0];
    const full = src.thumbnail;
    let image = full;

    if (options.region) {
      const { x, y, width, height } = options.region;
      const cropped = nativeImage.createFromBuffer(full.toPNG()).crop({ x, y, width, height });
      image = cropped;
    }

    const output = options.output || { format: 'png' as const };
    const composed = await performComposite(image, output);

    const outputFolder = store.get('outputFolder') as string;
    const now = new Date();
     const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} at ${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}.${String(now.getSeconds()).padStart(2, '0')} ${options.kind} [${image.getSize().width}x${image.getSize().height}].${output.format}`;

     // If Save As requested, show Windows file picker and write to chosen path
     if (options.saveAs) {
       const filters = output.format === 'png'
         ? [{ name: 'PNG Image', extensions: ['png'] }]
         : [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }];
       const defaultPath = path.join(outputFolder, filename);
       const result = await dialog.showSaveDialog({
         title: 'Save Capture',
         defaultPath,
         filters
       });
       if (result.canceled || !result.filePath) {
         return {
           width: image.getSize().width,
           height: image.getSize().height,
           dpiScale: 1,
           cursorIncluded: !!options.includeCursor,
           metadata: { displayId: options.displayId },
           canceled: true
         };
       }
       const targetPath = ensureExtension(result.filePath, output.format);
       if (output.format === 'png') {
         fs.writeFileSync(targetPath, composed.toPNG());
       } else {
         const quality = typeof output.quality === 'number' ? Math.round(output.quality * 100) : 92;
         fs.writeFileSync(targetPath, composed.toJPEG(quality));
       }
       const autoCopy = store.get('autoCopyToClipboard') as boolean;
       if (autoCopy) {
         clipboard.writeImage(composed);
       }
       return {
         filePath: targetPath,
         width: image.getSize().width,
         height: image.getSize().height,
         dpiScale: 1,
         cursorIncluded: !!options.includeCursor,
         metadata: { displayId: options.displayId }
       };
     }

     // Default behavior: save into configured output folder (unchanged)
     const filePath = path.join(outputFolder, filename);

    if (output.format === 'png') {
      fs.writeFileSync(filePath, composed.toPNG());
    } else {
      const quality = typeof output.quality === 'number' ? Math.round(output.quality * 100) : 92;
      fs.writeFileSync(filePath, composed.toJPEG(quality));
    }

    const autoCopy = store.get('autoCopyToClipboard') as boolean;
    if (autoCopy) {
      clipboard.writeImage(composed);
    }

    return {
      filePath,
      width: image.getSize().width,
      height: image.getSize().height,
      dpiScale: 1,
      cursorIncluded: !!options.includeCursor,
      metadata: { displayId: options.displayId }
    };
  });

  ipcMain.handle('pin:create', async (_e, payload: { imagePath?: string; fromClipboard?: boolean }) => {
    if (payload.fromClipboard) {
      const img = clipboard.readImage();
      if (img.isEmpty()) {
        return { error: 'Clipboard does not contain an image' };
      }
      const tmp = path.join(process.cwd(), 'pin-temp.png');
      fs.writeFileSync(tmp, img.toPNG());
      const id = await createPinWindow({ imagePath: tmp });
      return { id };
    }
    if (payload.imagePath) {
      const id = await createPinWindow({ imagePath: payload.imagePath });
      return { id };
    }
    return { error: 'No image provided' };
  });
  
  function ensureExtension(filePathValue: string, format: 'png' | 'jpeg'): string {
    const lower = filePathValue.toLowerCase();
    if (format === 'png') {
      return lower.endsWith('.png') ? filePathValue : `${filePathValue}.png`;
    }
    // jpeg
    return (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) ? filePathValue : `${filePathValue}.jpg`;
  }
}
    