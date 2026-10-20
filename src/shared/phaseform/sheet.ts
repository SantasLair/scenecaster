// Frame layout of a spritesheet, as Phaser cuts it: frames run left to right, then top to bottom, inside the image
// minus `margin`, with `spacing` pixels between frames. Pure, so the preview and the tests share it.

export interface SheetSpec {
  frameWidth: number;
  frameHeight: number;
  margin?: number;
  spacing?: number;
}

export interface FrameRect { index: number; x: number; y: number; w: number; h: number }

const whole = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback);

/** Reads the sheet fields of a manifest entry; null if the frame size is missing or not positive. */
export function sheetSpec(asset: { frameWidth?: unknown; frameHeight?: unknown; margin?: unknown; spacing?: unknown }): SheetSpec | null {
  const frameWidth = whole(asset.frameWidth, 0);
  const frameHeight = whole(asset.frameHeight, 0);
  if (frameWidth < 1 || frameHeight < 1) return null;
  return { frameWidth, frameHeight, margin: whole(asset.margin, 0), spacing: whole(asset.spacing, 0) };
}

/** Every full frame that fits in an image of `imageW` x `imageH` pixels. Empty if the frame is bigger than the image. */
export function sheetFrames(imageW: number, imageH: number, spec: SheetSpec): FrameRect[] {
  const { frameWidth: w, frameHeight: h } = spec;
  const margin = spec.margin ?? 0;
  const spacing = spec.spacing ?? 0;
  const cols = Math.floor((imageW - margin + spacing) / (w + spacing));
  const rows = Math.floor((imageH - margin + spacing) / (h + spacing));
  const out: FrameRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ index: r * cols + c, x: margin + c * (w + spacing), y: margin + r * (h + spacing), w, h });
  }
  return out;
}
