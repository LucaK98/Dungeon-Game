/**
 * Draws the few tiles the DCSS pack does not have (barrel, lever, chandelier, secrets, …)
 * as 32×32 pixel art in the same style: dark outline, light from the top left.
 *   npx tsx scripts/assets/draw-custom.ts   (then npm run import:assets)
 * Output: scripts/assets/custom/*.png (own work, CC0 like the rest of the tiles).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "custom");
const S = 32;

type Rgba = [number, number, number, number];

function hex(c: string, a = 255): Rgba {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

class Tile {
  data = new Uint8Array(S * S * 4);

  px(x: number, y: number, c: Rgba): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    const a = c[3] / 255;
    const b = this.data[i + 3]! / 255;
    const out = a + b * (1 - a);
    if (out <= 0) return;
    for (let k = 0; k < 3; k++) this.data[i + k] = Math.round((c[k]! * a + this.data[i + k]! * b * (1 - a)) / out);
    this.data[i + 3] = Math.round(out * 255);
  }

  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= S || y >= S) return 0;
    return this.data[(y * S + x) * 4 + 3]!;
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: Rgba): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.px(x, y, c);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgba | ((x: number, y: number) => Rgba)): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        if (d <= 1) this.px(x, y, typeof c === "function" ? c(x, y) : c);
      }
    }
  }

  ring(cx: number, cy: number, rx: number, ry: number, width: number, c: (x: number, y: number) => Rgba): void {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const outer = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        const inner = ((x + 0.5 - cx) / (rx - width)) ** 2 + ((y + 0.5 - cy) / (ry - width)) ** 2;
        if (outer <= 1 && inner > 1) this.px(x, y, c(x, y));
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Rgba, thick = 1): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      for (let t = 0; t < thick; t++) this.px(x + (t % 2), y + Math.floor(t / 2), c);
    }
  }

  /** Dark 1 px outline around everything drawn so far (the DCSS look). */
  outline(c: Rgba = hex("#140f0b")): void {
    const edge: [number, number][] = [];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (this.alpha(x, y) > 40) continue;
        if (this.alpha(x - 1, y) > 120 || this.alpha(x + 1, y) > 120 || this.alpha(x, y - 1) > 120 || this.alpha(x, y + 1) > 120) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.px(x, y, c);
  }

  /** Soft drop shadow to the lower right, under what is already drawn. */
  shadow(dx = 2, dy = 2): void {
    const copy = this.data.slice();
    this.data.fill(0);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (copy[(y * S + x) * 4 + 3]! > 120) this.px(x + dx, y + dy, [0, 0, 0, 90]);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        if (copy[i + 3]) this.px(x, y, [copy[i]!, copy[i + 1]!, copy[i + 2]!, copy[i + 3]!]);
      }
    }
  }

  save(name: string): void {
    const png = new PNG({ width: S, height: S });
    png.data.set(this.data);
    writeFileSync(join(OUT, name), PNG.sync.write(png));
  }
}

const mix = (a: Rgba, b: Rgba, t: number): Rgba => [0, 1, 2, 3].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as Rgba;

// ---------------------------------------------------------------- barrel

function barrel(): Tile {
  const t = new Tile();
  const dark = hex("#4a2c12");
  const mid = hex("#8a5a2b");
  const light = hex("#c08a4a");
  const top = 7;
  const bottom = 28;
  for (let y = top + 2; y <= bottom; y++) {
    const bulge = Math.sin((Math.PI * (y - top)) / (bottom - top));
    const half = 6 + Math.round(bulge * 2);
    for (let x = 16 - half; x < 16 + half; x++) {
      // Round body: light on the left third, dark on the right.
      const u = (x - (16 - half)) / (half * 2);
      let c = u < 0.3 ? mix(mid, light, 1 - Math.abs(u - 0.25) * 3) : mix(mid, dark, (u - 0.3) / 0.7);
      if ((x - (16 - half)) % 4 === 3) c = mix(c, dark, 0.45); // staves
      t.px(x, y, c);
    }
  }
  // Iron bands.
  for (const by of [11, 12, 23, 24]) {
    const bulge = Math.sin((Math.PI * (by - top)) / (bottom - top));
    const half = 6 + Math.round(bulge * 2);
    for (let x = 16 - half; x < 16 + half; x++) {
      const u = (x - (16 - half)) / (half * 2);
      t.px(x, by, mix(hex(by % 2 ? "#9aa0a8" : "#5d6168"), hex("#2d3034"), Math.max(0, u - 0.3)));
    }
  }
  // Lid: an ellipse with rings.
  t.ellipse(16, top + 2.5, 7, 3, hex("#a8743a"));
  t.ring(16, top + 2.5, 7, 3, 1, () => hex("#5d6168"));
  t.ellipse(16, top + 2.5, 3.5, 1.4, hex("#7a4c22"));
  t.px(14, top + 1, hex("#e0b070"));
  t.outline();
  t.shadow();
  return t;
}

// ---------------------------------------------------------------- lever

function lever(on: boolean): Tile {
  const t = new Tile();
  // Stone base with a slot.
  t.rect(9, 22, 22, 28, hex("#7d7a74"));
  t.rect(9, 22, 22, 22, hex("#a9a59d"));
  t.rect(9, 28, 22, 28, hex("#4f4c47"));
  t.rect(12, 24, 19, 25, hex("#2a2826"));
  // The stick.
  const end = on ? [24, 9] : [8, 9];
  t.line(16, 24, end[0]!, end[1]!, hex("#6b3f1c"), 2);
  t.line(16, 24, end[0]!, end[1]!, hex("#9a6634"), 1);
  // Knob.
  t.ellipse(end[0]!, end[1]!, 2.8, 2.8, hex(on ? "#3fa34d" : "#c0392b"));
  t.px(end[0]! - 1, end[1]! - 1, hex("#ffffff", 200));
  t.outline();
  t.shadow();
  return t;
}

// ---------------------------------------------------------------- chandelier

function candle(t: Tile, x: number, y: number, lit: boolean): void {
  t.rect(x, y, x + 1, y + 3, hex("#efe6cf"));
  t.px(x + 1, y + 3, hex("#bdb29a"));
  if (!lit) return;
  t.px(x, y - 1, hex("#ffd24a"));
  t.px(x + 1, y - 1, hex("#ffb02e"));
  t.px(x, y - 2, hex("#fff2a8"));
  t.px(x, y - 3, hex("#ff9a1f", 180));
}

function chandelier(): Tile {
  const t = new Tile();
  // Chains up to the ceiling.
  for (const [x, y] of [[6, 16], [26, 16], [16, 12]] as const) {
    t.line(x, y, 16, 0, hex("#55585d"));
  }
  t.ring(16, 17, 11, 5, 2, (x, y) => (y < 16 ? hex("#8a8e94") : x < 16 ? hex("#55585d") : hex("#3a3c40")));
  for (const [x, y] of [[5, 14], [11, 11], [20, 11], [26, 14], [8, 19], [15, 20], [23, 19]] as const) candle(t, x, y, true);
  t.outline();
  // Warm glow.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 16, (y - 15) * 1.6);
      if (d < 15 && t.alpha(x, y) === 0) t.px(x, y, [255, 200, 90, Math.round(40 * (1 - d / 15))]);
    }
  }
  return t;
}

function chandelierDown(): Tile {
  const t = new Tile();
  // Crashed on the floor: bent ring, scattered candles, a small fire.
  t.ring(16, 22, 12, 5, 2, (x) => (x < 16 ? hex("#55585d") : hex("#3a3c40")));
  t.line(6, 25, 11, 27, hex("#55585d"));
  t.line(20, 17, 28, 14, hex("#55585d"));
  for (const [x, y] of [[6, 20], [24, 26], [13, 26], [27, 20]] as const) {
    t.rect(x, y, x + 3, y + 1, hex("#efe6cf"));
  }
  // Glass and wax splinters.
  for (const [x, y] of [[4, 28], [9, 16], [22, 29], [29, 24], [18, 15]] as const) t.px(x, y, hex("#d8f0ff"));
  // Flames.
  for (const [x, y] of [[14, 20], [19, 23]] as const) {
    t.ellipse(x, y, 2, 3, hex("#ff8a1f"));
    t.ellipse(x, y + 0.5, 1, 2, hex("#ffe070"));
  }
  t.outline();
  t.shadow(1, 1);
  return t;
}

// ---------------------------------------------------------------- secrets

function loosePlate(): Tile {
  // Overlay on a floor tile: a slightly raised slab with a crack.
  const t = new Tile();
  const dark: Rgba = [0, 0, 0, 150];
  const light: Rgba = [255, 255, 255, 60];
  t.line(9, 9, 23, 9, light);
  t.line(9, 9, 9, 23, light);
  t.line(9, 24, 24, 24, dark);
  t.line(24, 9, 24, 24, dark);
  t.line(10, 25, 25, 25, [0, 0, 0, 80]);
  t.line(13, 13, 16, 17, dark);
  t.line(16, 17, 15, 21, dark);
  return t;
}

function runes(): Tile {
  // Overlay on a wall tile: faintly glowing carved signs.
  const t = new Tile();
  const glow: Rgba = [120, 200, 255, 70];
  const ink: Rgba = [170, 225, 255, 230];
  const glyphs: [number, number][][] = [
    [[0, 0], [0, 6], [0, 3], [2, 1], [2, 5]],
    [[0, 0], [2, 3], [0, 6], [2, 6]],
    [[1, 0], [1, 6], [0, 2], [2, 2], [0, 4], [2, 4]],
  ];
  glyphs.forEach((g, i) => {
    const ox = 6 + i * 8;
    const oy = 12;
    for (let k = 0; k + 1 < g.length; k++) {
      const [ax, ay] = g[k]!;
      const [bx, by] = g[k + 1]!;
      t.line(ox + ax - 1, oy + ay, ox + bx - 1, oy + by, glow, 2);
      t.line(ox + ax, oy + ay, ox + bx, oy + by, ink);
    }
  });
  return t;
}

function secretFound(): Tile {
  // The lifted slab and the dark hole below it.
  const t = new Tile();
  t.rect(10, 12, 22, 23, hex("#0c0a09"));
  t.rect(10, 12, 22, 13, hex("#2a2420"));
  t.rect(10, 12, 11, 23, hex("#2a2420"));
  // Slab leaning at the side.
  t.rect(23, 8, 28, 22, hex("#8d8a83"));
  t.rect(23, 8, 23, 22, hex("#b5b1a8"));
  t.rect(28, 8, 28, 22, hex("#5b5853"));
  // A glint inside.
  t.px(17, 19, hex("#ffd24a"));
  t.px(18, 18, hex("#fff2a8"));
  t.outline();
  return t;
}

// ---------------------------------------------------------------- cauldron, campfire

function cauldron(): Tile {
  const t = new Tile();
  // Fire under the pot.
  t.ellipse(16, 28, 7, 2.5, hex("#ff7a1a"));
  t.ellipse(16, 28, 4, 1.5, hex("#ffd24a"));
  t.ellipse(16, 20, 10, 8, (x, y) => mix(hex("#4a4d52"), hex("#15171a"), Math.min(1, Math.max(0, (x - 9) / 16 + (y - 16) / 30))));
  t.ellipse(16, 14, 10, 3.5, hex("#2b2e32"));
  t.ellipse(16, 14.5, 8.5, 2.5, hex("#5fbf3a"));
  for (const [x, y] of [[12, 14], [18, 13], [20, 15]] as const) t.px(x, y, hex("#b7f07a"));
  t.px(14, 10, hex("#b7f07a", 200));
  t.px(19, 8, hex("#b7f07a", 150));
  t.outline();
  t.shadow(1, 1);
  return t;
}

function campfire(): Tile {
  const t = new Tile();
  // Stones around.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    t.ellipse(16 + Math.cos(a) * 10, 22 + Math.sin(a) * 5, 2, 1.6, hex(i % 2 ? "#8d8a83" : "#6f6c66"));
  }
  // Crossed logs.
  t.line(9, 25, 23, 19, hex("#5b3718"), 3);
  t.line(9, 19, 23, 25, hex("#6f4520"), 3);
  // Flames.
  t.ellipse(16, 17, 5, 7, hex("#ff6a1a"));
  t.ellipse(16, 18, 3.5, 5, hex("#ffa92e"));
  t.ellipse(16, 19, 2, 3, hex("#ffe98a"));
  t.outline();
  return t;
}

mkdirSync(OUT, { recursive: true });
barrel().save("barrel.png");
lever(false).save("lever_off.png");
lever(true).save("lever_on.png");
chandelier().save("chandelier.png");
chandelierDown().save("chandelier_down.png");
loosePlate().save("loose_plate.png");
runes().save("runes.png");
secretFound().save("secret_found.png");
cauldron().save("cauldron.png");
campfire().save("campfire.png");
console.log(`custom tiles → ${OUT}`);
