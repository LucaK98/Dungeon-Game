/**
 * Sharp graphics on every screen.
 *
 * The board is laid out in 1920×1080 "board pixels". The canvas itself is created at the
 * screen's real resolution (factor RES), and both scenes zoom their cameras by RES: text and
 * shapes are drawn with every physical pixel, nothing gets blurred by the browser.
 *
 * The 32×32 pixel art is upscaled once with Scale2x ("HD" graphics, smoother edges) to match
 * the size a tile has on screen. "Pixel" keeps the classic blocky look.
 */
import Phaser from "phaser";
import { measureRes, scale2x, upscaleFor } from "./upscale";

export type GraphicsMode = "hd" | "pixel";

const KEY = "couch-dungeon.graphics";

export function loadGraphicsMode(): GraphicsMode {
  try {
    return localStorage.getItem(KEY) === "pixel" ? "pixel" : "hd";
  } catch {
    return "hd";
  }
}

export function saveGraphicsMode(mode: GraphicsMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/** Look of the board: "stimmung" (light and shadow, textures, outlines) or "klassisch" (as before). */
export type LookMode = "stimmung" | "klassisch";

const LOOK_KEY = "couch-dungeon.look";

export function loadLookMode(): LookMode {
  try {
    return localStorage.getItem(LOOK_KEY) === "klassisch" ? "klassisch" : "stimmung";
  } catch {
    return "stimmung";
  }
}

export function saveLookMode(mode: LookMode): void {
  try {
    localStorage.setItem(LOOK_KEY, mode);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/** Screen pixels per board pixel (0.5 … 2), set once when the board starts. */
export let RES = 1;
/** Texture key and upscale factor of the tile atlas used by the scenes. */
export let TILES = "tiles";
export let UP = 1;

export function initRes(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  RES = measureRes(rect.width || window.innerWidth, rect.height || window.innerHeight, window.devicePixelRatio || 1);
  return RES;
}

/** Text style with the screen resolution, so text stays crisp at any zoom. */
export function crisp<T extends Phaser.Types.GameObjects.Text.TextStyle>(style: T): T {
  return { ...style, resolution: Math.max(1, RES * 1.5) };
}

/** Space around each upscaled frame, filled with its edge pixels (no seams with smooth filtering). */
const PAD = 2;

/**
 * Builds the upscaled tile texture from the loaded atlas (once per page) and sets TILES/UP.
 * Every frame is upscaled on its own and gets an extruded border, so smooth filtering
 * never picks up a neighbour's pixels.
 */
export function prepareTiles(scene: Phaser.Scene): void {
  const textures = scene.textures;
  const up = loadGraphicsMode() === "pixel" ? 1 : upscaleFor(RES);
  UP = up;
  if (up === 1) {
    TILES = "tiles";
    return;
  }
  const key = `tiles-hd${up}`;
  TILES = key;
  if (textures.exists(key)) return;

  const base = textures.get("tiles");
  const img = base.getSourceImage() as HTMLImageElement;
  const src = document.createElement("canvas");
  src.width = img.width;
  src.height = img.height;
  const sctx = src.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(img, 0, 0);

  const names = base.getFrameNames();
  const cell = 32 * up + PAD * 2;
  const cols = Math.max(1, Math.floor(4096 / cell));
  const width = cols * cell;
  const height = Math.ceil(names.length / cols) * cell;
  const canvas = textures.createCanvas(key, width, height)!;
  const ctx = canvas.context;
  names.forEach((name, n) => {
    const f = base.get(name);
    const w = f.cutWidth;
    const h = f.cutHeight;
    let pixels: Uint32Array<ArrayBuffer> = new Uint32Array(sctx.getImageData(f.cutX, f.cutY, w, h).data.buffer);
    let pw = w;
    let ph = h;
    for (let k = 1; k < up; k *= 2) {
      pixels = scale2x(pixels, pw, ph);
      pw *= 2;
      ph *= 2;
    }
    // Extrude: clamp every padded pixel to the nearest frame pixel.
    const ow = pw + PAD * 2;
    const oh = ph + PAD * 2;
    const out = new Uint32Array(ow * oh);
    for (let y = 0; y < oh; y++) {
      const sy = Math.min(ph - 1, Math.max(0, y - PAD));
      for (let x = 0; x < ow; x++) out[y * ow + x] = pixels[sy * pw + Math.min(pw - 1, Math.max(0, x - PAD))]!;
    }
    const x0 = (n % cols) * cell;
    const y0 = Math.floor(n / cols) * cell;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(out.buffer), ow, oh), x0, y0);
    canvas.add(name, 0, x0 + PAD, y0 + PAD, pw, ph);
  });
  canvas.refresh();
  // Smooth filtering: the upscaled art is already detailed, and odd scales stay soft instead of jagged.
  canvas.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

const CRUDE_KEY = "couch-dungeon.crude";

/** Enemies swear in their trash talk (on unless switched off). */
export function loadCrude(): boolean {
  try {
    return localStorage.getItem(CRUDE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveCrude(on: boolean): void {
  try {
    localStorage.setItem(CRUDE_KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
}
