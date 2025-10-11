
import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureOptions, CaptureResult, Settings } from '@shared/contracts';

const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (payload: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', payload)
  },
  overlay: {
    freezeFrame: (): Promise<{ dataUrl: string; width: number; height: number; scale: number }> => ipcRenderer.invoke('overlay:freezeFrame')
  },
  capture: {
    request: (opts: CaptureOptions): Promise<CaptureResult> => ipcRenderer.invoke('capture:request', opts)
  },
  pin: {
    create: (payload: { imagePath?: string; fromClipboard?: boolean }) => ipcRenderer.invoke('pin:create', payload)
  },
  onNotify: (cb: (msg: any) => void) => {
    ipcRenderer.on('app:notify', (_e, data) => cb(data));
  }
};

contextBridge.exposeInMainWorld('appApi', api);

declare global {
  interface Window {
    appApi: typeof api;
  }
}
    