
export type CaptureKind = 'region' | 'window' | 'display' | 'scrolling';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DropShadow {
  radius: number;
  offsetX: number;
  offsetY: number;
  colorHex: string;
  opacity: number;
}

export interface OutputOptions {
  format: 'png' | 'jpeg';
  quality?: number;
  background?: { mode: 'transparent' | 'color'; colorHex?: string };
  dropShadow?: DropShadow;
  padding?: number;
}

export interface CaptureOptions {
  kind: CaptureKind;
  includeCursor?: boolean;
  freezeScreen?: boolean;
  displayId?: string;
  windowHandle?: number;
  region?: Region;
  output?: OutputOptions;
}

export interface CaptureResult {
  filePath?: string;
  buffer?: ArrayBuffer;
  width: number;
  height: number;
  dpiScale: number;
  cursorIncluded: boolean;
  metadata: Record<string, any>;
}

export interface UploadProvider {
  id: string;
  name: string;
  configure(opts: Record<string, any>): Promise<void>;
  upload(input: { buffer: ArrayBuffer; fileName: string; mime: string }): Promise<{ url: string; deleteUrl?: string }>;
}

export interface Settings {
  outputFolder: string;
  autoCopyToClipboard: boolean;
  defaultFormat: 'png' | 'jpeg';
  defaultQuality: number;
  includeCursorByDefault: boolean;
  hotkeys: Record<string, string>;
}
    