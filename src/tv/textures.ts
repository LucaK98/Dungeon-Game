/**
 * "Stimmungsvoll": finer floor and wall textures for bricks and flagstones (64 px per square).
 *
 * The colours come from the original 32 px tile, so every theme keeps its look. The pattern is drawn in
 * world coordinates over 8 × 8 squares and tiles seamlessly: bricks and slabs run across square borders,
 * the grid of the old tiles disappears. One texture per material and page, cut into 64 frames.
 */
import type Phaser from "phaser";

/** Squares per pattern (the pattern repeats after this many squares). */
export const DETAIL_SPAN = 8;
/** Pixels per square in the detail textures. */
export const DETAIL_PX = 64;

const SIZE = DETAIL_SPAN * DETAIL_PX;

/** Materials that get the new look (the others – caves, grass, hedges, earth – keep their hand-drawn tiles). */
const WALLS = new Set(["brick", "stone", "castle", "church", "crypt"]);
const FLOORS = new Set(["stone", "castle", "crypt", "marble", "village"]);

/** The texture key for a map frame, or undefined if it keeps the original tile. */
export function detailKey(frame: string): string | undefined {
  const [kind, family] = frame.split(".");
  if (kind === "wall" && family && WALLS.has(family)) return `detail-wall-${family}`;
  if (kind === "floor" && family && FLOORS.has(family)) return `detail-floor-${family}`;
  return undefined;
}

/** Frame name inside a detail texture for the square (x, y). */
export function detailFrame(x: number, y: number): string {
  return `c${((x % DETAIL_SPAN) + DETAIL_SPAN) % DETAIL_SPAN}_${((y % DETAIL_SPAN) + DETAIL_SPAN) % DETAIL_SPAN}`;
}

type Rgb = [number, number, number];

/** Dark, middle and light colour of a tile (to keep the art's palette). */
function palette(scene: Phaser.Scene, frame: string): { dark: Rgb; mid: Rgb; light: Rgb } | undefined {
  const base = scene.textures.get("tiles");
  if (!base.has(frame)) return undefined;
  const f = base.get(frame);
  const img = base.getSourceImage() as HTMLImageElement;
  const c = document.createElement("canvas");
  c.width = f.cutWidth;
  c.height = f.cutHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const px: Rgb[] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 200) px.push([d[i]!, d[i + 1]!, d[i + 2]!]);
  if (!px.length) return undefined;
  px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const at = (q: number): Rgb => px[Math.min(px.length - 1, Math.floor(px.length * q))]!;
  return { dark: at(0.12), mid: at(0.5), light: at(0.88) };
}

function hash(a: number, b: number, c = 0): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise that repeats every SIZE pixels. */
function noise(x: number, y: number, cell: number, salt: number): number {
  const period = SIZE / cell;
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const w = (v: number) => ((v % period) + period) % period;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const a = hash(w(gx), w(gy), salt);
  const b = hash(w(gx + 1), w(gy), salt);
  const c = hash(w(gx), w(gy + 1), salt);
  const d = hash(w(gx + 1), w(gy + 1), salt);
  const u = sm(fx);
  const v = sm(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function mix(p: { dark: Rgb; mid: Rgb; light: Rgb }, t: number): Rgb {
  const [a, b, u] = t < 0.5 ? [p.dark, p.mid, t * 2] : [p.mid, p.light, (t - 0.5) * 2];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Builds (once) the detail texture for this map frame; returns its key or undefined. */
export function ensureDetailTexture(scene: Phaser.Scene, frame: string): string | undefined {
  const key = detailKey(frame);
  if (!key) return undefined;
  if (scene.textures.exists(key)) return key;
  const p = palette(scene, frame.replace(/\.\d+$/, ".0")) ?? palette(scene, frame);
  if (!p) return undefined;
  const wall = frame.startsWith("wall.");
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const grain = noise(x, y, 4, 1) * 0.5 + noise(x, y, 8, 2) * 0.35 + noise(x, y, 32, 3) * 0.15;
      let t: number;
      let shade = 1;
      if (wall) {
        // Bricks: 16 px courses, every other one shifted, mortar joints, bevelled edges.
        const row = Math.floor(y / 16);
        const off = (row % 2) * 16;
        const k = Math.floor((x + off) / 32);
        const bx = (x + off) % 32;
        const by = y % 16;
        const tone = hash(((k % 16) + 16) % 16, row, 5);
        if (bx < 2 || by < 2) {
          t = 0.03;
          shade = 0.55;
        } else {
          t = 0.25 + tone * 0.45 + (grain - 0.5) * 0.35;
          if (bx < 4 || by < 4) shade = 1.2;
          else if (bx > 29 || by > 13) shade = 0.74;
        }
      } else {
        // Flagstones: rows of 32 px, slabs of 32, 64 or 128 px per row, bevelled, with a few cracks.
        const row = Math.floor(y / 32);
        const width = [32, 64, 64, 128][Math.floor(hash(row, 22) * 4)]!;
        const off = Math.floor(hash(row, 21) * 4) * 16;
        const k = Math.floor((x + off) / width) % (SIZE / width);
        const bx = (x + off) % width;
        const by = y % 32;
        const tone = hash(k, row, 23);
        if (bx < 2 || by < 2) {
          t = 0.05;
          shade = 0.62;
        } else {
          t = 0.3 + tone * 0.4 + (grain - 0.5) * 0.45;
          if (bx < 4 || by < 4) shade = 1.14;
          else if (bx > width - 3 || by > 29) shade = 0.8;
          if (tone > 0.72 && Math.abs(noise(x, y, 16, 30 + k) - 0.5) < 0.012) shade *= 0.62;
        }
      }
      const c = mix(p, Math.max(0, Math.min(1, t)));
      const i = (y * SIZE + x) * 4;
      d[i] = Math.min(255, c[0] * shade);
      d[i + 1] = Math.min(255, c[1] * shade);
      d[i + 2] = Math.min(255, c[2] * shade);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = scene.textures.addCanvas(key, canvas);
  if (!tex) return undefined;
  for (let cy = 0; cy < DETAIL_SPAN; cy++) for (let cx = 0; cx < DETAIL_SPAN; cx++) tex.add(`c${cx}_${cy}`, 0, cx * DETAIL_PX, cy * DETAIL_PX, DETAIL_PX, DETAIL_PX);
  return key;
}
