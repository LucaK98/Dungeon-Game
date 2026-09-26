/**
 * Loads the texture atlas for DOM/canvas UIs (phones, TV lobby).
 * Phaser loads the same files itself.
 */
import { dollFrames, type DollLook } from "../shared/doll";

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
}

export interface Atlas {
  image: HTMLImageElement;
  frames: Record<string, AtlasFrame>;
}

let loading: Promise<Atlas> | undefined;

export function assetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}assets/${file}`;
}

export function loadAtlas(): Promise<Atlas> {
  loading ??= (async () => {
    const [json, image] = await Promise.all([
      fetch(assetUrl("atlas.json")).then((r) => r.json() as Promise<{ frames: Record<string, AtlasFrame> }>),
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("atlas.png konnte nicht geladen werden"));
        img.src = assetUrl("atlas.png");
      }),
    ]);
    return { image, frames: json.frames };
  })();
  return loading;
}

export function drawFrame(ctx: CanvasRenderingContext2D, atlas: Atlas, name: string, dx: number, dy: number, scale: number): void {
  const f = atlas.frames[name];
  if (!f) return;
  const { x, y, w, h } = f.frame;
  ctx.drawImage(atlas.image, x, y, w, h, dx, dy, w * scale, h * scale);
}

/** Draws a character figure into a canvas (32×32 scaled by `scale`, pixel-perfect). */
export function drawDoll(canvas: HTMLCanvasElement, atlas: Atlas, look: DollLook, scale: number): void {
  canvas.width = 32 * scale;
  canvas.height = 32 * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const frame of dollFrames(look)) drawFrame(ctx, atlas, frame, 0, 0, scale);
}

/** Creates a canvas showing a figure; draws as soon as the atlas is loaded. */
export function dollCanvas(look: DollLook, scale: number, className = "doll"): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.width = canvas.height = 32 * scale;
  void loadAtlas().then((atlas) => drawDoll(canvas, atlas, look, scale));
  return canvas;
}

export function spriteCanvas(frame: string, scale: number, className = "sprite"): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.width = canvas.height = 32 * scale;
  void loadAtlas().then((atlas) => {
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    drawFrame(ctx, atlas, frame, 0, 0, scale);
  });
  return canvas;
}
