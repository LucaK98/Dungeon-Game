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

// ---------------------------------------------------------------- furniture and props (map decoration)

const WOOD_D = hex("#4a2c12");
const WOOD_M = hex("#8a5a2b");
const WOOD_L = hex("#c08a4a");

/** Wooden plank rectangle with grain, lit from the top left. */
function planks(t: Tile, x0: number, y0: number, x1: number, y1: number, vertical = false): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const along = vertical ? x - x0 : y - y0;
      let c = mix(WOOD_M, WOOD_L, 0.35 - (x - x0 + y - y0) / ((x1 - x0 + y1 - y0) * 3));
      if (along % 4 === 3) c = mix(c, WOOD_D, 0.5);
      if (((x * 7 + y * 13) % 11) === 0) c = mix(c, WOOD_D, 0.25);
      t.px(x, y, c);
    }
  }
}

function table(): Tile {
  const t = new Tile();
  // Legs.
  t.rect(5, 20, 7, 28, WOOD_D);
  t.rect(24, 20, 26, 28, WOOD_D);
  // Top with a front edge.
  planks(t, 3, 9, 28, 20);
  t.rect(3, 21, 28, 23, mix(WOOD_M, WOOD_D, 0.5));
  // A mug and a plate.
  t.rect(8, 11, 11, 15, hex("#b8b4a8"));
  t.rect(8, 11, 11, 11, hex("#f0e8c8"));
  t.px(12, 13, hex("#8a867c"));
  t.ellipse(20, 14, 4, 2.5, hex("#d8d2c4"));
  t.ellipse(20, 14, 2, 1.2, hex("#b04a2a"));
  t.outline();
  t.shadow();
  return t;
}

function tableFlipped(): Tile {
  const t = new Tile();
  // Tipped on its side: the top faces us as a wall of planks, legs sticking out.
  t.rect(6, 6, 8, 12, WOOD_D);
  t.rect(23, 6, 25, 12, WOOD_D);
  planks(t, 3, 11, 28, 25, true);
  t.rect(3, 26, 28, 27, mix(WOOD_M, WOOD_D, 0.6));
  // Spilled mug.
  t.rect(22, 27, 26, 29, hex("#b8b4a8"));
  t.ellipse(15, 29, 6, 1.5, hex("#c9a13a", 170));
  t.outline();
  t.shadow();
  return t;
}

function stool(): Tile {
  const t = new Tile();
  t.line(11, 18, 9, 27, WOOD_D, 2);
  t.line(20, 18, 22, 27, WOOD_D, 2);
  t.line(16, 19, 16, 26, WOOD_D, 2);
  t.ellipse(16, 17, 7, 3.5, (x) => (x < 14 ? WOOD_L : WOOD_M));
  t.ring(16, 17, 7, 3.5, 1, () => WOOD_D);
  t.outline();
  t.shadow(1, 1);
  return t;
}

function bench(): Tile {
  const t = new Tile();
  // Church pew: a back rest and a seat.
  planks(t, 2, 8, 29, 14);
  t.rect(2, 15, 29, 16, WOOD_D);
  planks(t, 2, 17, 29, 22);
  t.rect(3, 23, 5, 28, WOOD_D);
  t.rect(26, 23, 28, 28, WOOD_D);
  t.outline();
  t.shadow();
  return t;
}

function bookshelf(): Tile {
  const t = new Tile();
  t.rect(3, 2, 28, 30, WOOD_D);
  planks(t, 4, 3, 27, 29, true);
  const colors = ["#8c2a2a", "#2a4d8c", "#2f7a3a", "#b08a2a", "#5a2a7a", "#7a4a2a", "#2a6a6a"];
  for (const [row, y] of [[0, 4], [1, 13], [2, 22]] as const) {
    t.rect(4, y + 7, 27, y + 8, WOOD_D);
    let x = 5;
    let k = row * 3;
    while (x < 26) {
      const w = 2 + ((k * 5) % 2);
      const h = 5 + ((k * 3) % 3);
      const c = hex(colors[k % colors.length]!);
      t.rect(x, y + 7 - h, x + w - 1, y + 6, c);
      t.px(x, y + 7 - h, mix(c, hex("#ffffff"), 0.4));
      x += w + (k % 4 === 0 ? 1 : 0);
      k++;
    }
  }
  t.outline();
  t.shadow();
  return t;
}

function crate(): Tile {
  const t = new Tile();
  planks(t, 6, 8, 26, 27);
  t.rect(6, 8, 26, 9, WOOD_D);
  t.rect(6, 26, 26, 27, WOOD_D);
  t.rect(6, 8, 7, 27, WOOD_D);
  t.rect(25, 8, 26, 27, WOOD_D);
  t.line(8, 10, 24, 25, WOOD_D, 2);
  t.px(16, 12, hex("#9aa0a8"));
  t.outline();
  t.shadow();
  return t;
}

function debris(): Tile {
  // Splinters of a smashed crate or pot.
  const t = new Tile();
  for (const [x0, y0, x1, y1] of [[6, 22, 13, 20], [15, 26, 22, 25], [20, 18, 26, 21], [8, 27, 11, 24], [23, 26, 27, 27]] as const) t.line(x0, y0, x1, y1, WOOD_M, 2);
  for (const [x, y] of [[12, 17], [18, 22], [25, 23], [10, 24]] as const) t.rect(x, y, x + 1, y + 1, WOOD_D);
  t.outline();
  return t;
}

function pot(): Tile {
  const t = new Tile();
  const c0 = hex("#b8683a");
  const c1 = hex("#6e3418");
  t.ellipse(16, 20, 8, 8, (x, y) => mix(mix(c0, hex("#e09a62"), 0.3), c1, Math.min(1, Math.max(0, (x - 10) / 14 + (y - 16) / 24))));
  t.rect(12, 9, 19, 13, c0);
  t.ellipse(16, 9, 4.5, 1.6, c1);
  t.rect(9, 19, 23, 20, mix(c0, c1, 0.6));
  t.px(11, 16, hex("#f0c090"));
  t.outline();
  t.shadow(1, 1);
  return t;
}

function potShards(): Tile {
  const t = new Tile();
  for (const [x, y, w] of [[8, 22, 4], [15, 25, 5], [21, 20, 3], [12, 18, 2], [24, 26, 3]] as const) {
    t.rect(x, y, x + w, y + 1, hex("#b8683a"));
    t.px(x, y + 2, hex("#6e3418"));
  }
  t.outline();
  return t;
}

function weaponRack(): Tile {
  const t = new Tile();
  t.rect(4, 8, 27, 10, WOOD_M);
  t.rect(4, 24, 27, 26, WOOD_M);
  t.rect(4, 8, 5, 28, WOOD_D);
  t.rect(26, 8, 27, 28, WOOD_D);
  // Spear, sword, axe.
  t.line(9, 3, 9, 27, hex("#7a5a3a"));
  t.line(8, 3, 10, 3, hex("#c8ccd2"));
  t.rect(8, 1, 10, 4, hex("#c8ccd2"));
  t.line(16, 5, 16, 22, hex("#d8dce2"), 2);
  t.rect(13, 21, 19, 22, hex("#b08a2a"));
  t.rect(16, 23, 17, 27, hex("#5a3a1a"));
  t.line(23, 4, 23, 27, hex("#7a5a3a"));
  t.ellipse(21, 7, 3, 4, hex("#9aa0a8"));
  t.outline();
  t.shadow();
  return t;
}

function hay(): Tile {
  const t = new Tile();
  const straw0 = hex("#e0c05a");
  const straw1 = hex("#a8822a");
  for (let y = 10; y <= 27; y++) {
    for (let x = 4; x <= 27; x++) {
      const edge = Math.min(y - 10, 27 - y, x - 4, 27 - x);
      if (edge < 0 || (edge === 0 && (x + y) % 3 === 0)) continue;
      let c = mix(straw0, straw1, (x - 4) / 40 + (y - 10) / 30);
      if ((x * 3 + y * 7) % 5 === 0) c = mix(c, hex("#fff0a0"), 0.5);
      if ((x * 5 + y) % 7 === 0) c = mix(c, straw1, 0.6);
      t.px(x, y, c);
    }
  }
  // Two cords.
  t.rect(10, 10, 11, 27, hex("#6a4a2a"));
  t.rect(20, 10, 21, 27, hex("#6a4a2a"));
  for (const [x, y] of [[3, 12], [28, 20], [6, 28], [25, 9]] as const) t.line(x, y, x + 2, y - 1, straw0);
  t.outline();
  t.shadow();
  return t;
}

function web(): Tile {
  const t = new Tile();
  const silk: Rgba = [235, 235, 240, 190];
  const cx = 9;
  const cy = 9;
  for (let k = 0; k < 7; k++) {
    const a = (k / 6) * (Math.PI / 2) + 0.05;
    t.line(cx - 8, cy - 8, cx - 8 + Math.cos(a) * 30, cy - 8 + Math.sin(a) * 30, silk);
  }
  for (const r of [8, 14, 20, 26]) {
    for (let k = 0; k <= 20; k++) {
      const a = (k / 20) * (Math.PI / 2);
      t.px(cx - 8 + Math.cos(a) * r, cy - 8 + Math.sin(a) * r, [235, 235, 240, 150]);
    }
  }
  return t;
}

function rubble(): Tile {
  const t = new Tile();
  const stones: [number, number, number][] = [[8, 22, 4], [16, 25, 5], [23, 20, 3.5], [12, 15, 3], [22, 12, 2.5], [6, 10, 2], [27, 26, 2.5], [17, 18, 2]];
  for (const [x, y, r] of stones) {
    t.ellipse(x, y, r, r * 0.75, (px, py) => mix(hex("#a09a90"), hex("#4f4b45"), Math.min(1, Math.max(0, (px - x + r) / (r * 3) + (py - y + r) / (r * 3)))));
  }
  t.outline();
  t.shadow(1, 1);
  return t;
}

function puddle(kind: "water" | "oil" | "ice"): Tile {
  const t = new Tile();
  const base: Rgba = kind === "water" ? [70, 120, 170, 150] : kind === "oil" ? [30, 24, 30, 200] : [190, 230, 255, 200];
  const hi: Rgba = kind === "water" ? [180, 220, 255, 170] : kind === "oil" ? [150, 90, 200, 150] : [255, 255, 255, 230];
  t.ellipse(15, 18, 12, 8, base);
  t.ellipse(22, 22, 6, 4, base);
  t.ellipse(9, 13, 5, 3, base);
  if (kind === "oil") {
    // Rainbow sheen.
    t.line(9, 17, 16, 15, [80, 160, 200, 140]);
    t.line(11, 19, 19, 17, hi);
    t.line(14, 21, 22, 20, [200, 180, 60, 120]);
  } else if (kind === "ice") {
    t.line(8, 14, 14, 20, [150, 190, 220, 255]);
    t.line(14, 20, 12, 25, [150, 190, 220, 255]);
    t.line(14, 20, 24, 18, [150, 190, 220, 255]);
    t.line(9, 15, 12, 13, hi);
    t.line(19, 13, 23, 14, hi);
  } else {
    t.line(9, 15, 13, 13, hi);
    t.line(19, 20, 23, 19, hi);
  }
  return t;
}

function scorch(): Tile {
  const t = new Tile();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 16, (y - 17) * 1.2) + (((x * 13 + y * 7) % 5) - 2);
      if (d < 14) t.px(x, y, [12, 8, 6, Math.round(245 * Math.min(1, 1.4 * (1 - d / 14)))]);
    }
  }
  for (const [x, y] of [[13, 16], [18, 19], [16, 14]] as const) t.px(x, y, hex("#ff7a2a", 200));
  return t;
}

function crack(variant: number): Tile {
  const t = new Tile();
  const c: Rgba = [0, 0, 0, 120];
  const l: Rgba = [255, 255, 255, 35];
  const paths = [
    [[5, 8], [11, 13], [10, 19], [16, 24], [22, 25]],
    [[26, 6], [20, 11], [22, 16], [15, 20]],
    [[4, 22], [10, 20], [14, 24], [21, 22], [27, 27]],
  ][variant % 3]!;
  for (let k = 0; k + 1 < paths.length; k++) {
    t.line(paths[k]![0]!, paths[k]![1]!, paths[k + 1]![0]!, paths[k + 1]![1]!, c);
    t.line(paths[k]![0]! + 1, paths[k]![1]! + 1, paths[k + 1]![0]! + 1, paths[k + 1]![1]! + 1, l);
  }
  return t;
}

function leaves(): Tile {
  const t = new Tile();
  const cols = ["#b8542a", "#d8902a", "#8a3a1a", "#c8a03a", "#6a7a2a"];
  for (let k = 0; k < 9; k++) {
    const x = 4 + ((k * 11) % 24);
    const y = 5 + ((k * 7) % 22);
    const c = hex(cols[k % cols.length]!);
    t.ellipse(x, y, 2, 1.2, c);
    t.px(x + 2, y + 1, mix(c, hex("#000000"), 0.5));
  }
  return t;
}

function bones(): Tile {
  const t = new Tile();
  const b = hex("#e8e2cc");
  const d = hex("#a8a08a");
  t.ellipse(11, 20, 4, 3.5, b);
  t.px(10, 20, hex("#2a2420"));
  t.px(12, 20, hex("#2a2420"));
  t.rect(10, 22, 12, 23, d);
  t.line(17, 23, 26, 18, b, 2);
  t.ellipse(17, 23, 1.5, 1.5, b);
  t.ellipse(26, 18, 1.5, 1.5, b);
  t.line(19, 13, 24, 15, d, 1);
  t.outline();
  return t;
}

function mushrooms(glow: boolean): Tile {
  const t = new Tile();
  const caps: [number, number, number][] = [[10, 20, 5], [20, 16, 4], [22, 25, 3], [14, 26, 2.5]];
  const cap = glow ? hex("#4ad8a0") : hex("#c83a2a");
  const dot = glow ? hex("#c8fff0") : hex("#f8f0e0");
  if (glow) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 16, y - 20);
      if (d < 16) t.px(x, y, [80, 255, 180, Math.round(45 * (1 - d / 16))]);
    }
  }
  for (const [x, y, r] of caps) {
    t.rect(x - 1, y, x, y + r + 1, hex("#ece2cc"));
    t.ellipse(x - 0.5, y, r, r * 0.6, (px) => (px < x - 1 ? mix(cap, hex("#ffffff"), 0.25) : cap));
    t.px(x - 2, y - 1, dot);
    t.px(x + 1, y, dot);
  }
  t.outline();
  return t;
}

function herbs(): Tile {
  const t = new Tile();
  const stem = hex("#3a7a2a");
  for (let k = 0; k < 7; k++) {
    const x = 8 + k * 2.6;
    const top = 10 + ((k * 5) % 7);
    t.line(16, 27, x, top, stem);
    t.ellipse(x, top, 2, 1.3, hex(k % 2 ? "#5ab83a" : "#7ad84a"));
  }
  for (const [x, y] of [[10, 12], [19, 11], [24, 15]] as const) {
    t.ellipse(x, y, 1.6, 1.6, hex("#e8e0ff"));
    t.px(x, y, hex("#f8d84a"));
  }
  t.outline();
  t.shadow(1, 1);
  return t;
}

function stalagmite(): Tile {
  const t = new Tile();
  const spikes: [number, number, number][] = [[12, 28, 5], [21, 28, 4], [17, 28, 3]];
  spikes.forEach(([x, base, w], k) => {
    const h = [22, 16, 10][k]!;
    for (let y = base - h; y <= base; y++) {
      const half = (w * (y - (base - h))) / h;
      for (let px = Math.round(x - half); px <= Math.round(x + half); px++) t.px(px, y, mix(hex("#a89c8a"), hex("#4a4238"), (px - x + half) / (2 * half + 0.01)));
    }
  });
  t.outline();
  t.shadow();
  return t;
}

function candles(): Tile {
  const t = new Tile();
  // A tall iron candle stand with three candles.
  t.rect(15, 10, 16, 27, hex("#3a3c40"));
  t.ellipse(15.5, 28, 5, 1.8, hex("#2a2c30"));
  t.rect(8, 12, 23, 13, hex("#55585d"));
  for (const x of [8, 15, 22]) candle(t, x, 7, true);
  t.outline();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 16, (y - 6) * 1.4);
    if (d < 13 && t.alpha(x, y) === 0) t.px(x, y, [255, 200, 90, Math.round(35 * (1 - d / 13))]);
  }
  return t;
}

function candlesOut(): Tile {
  const t = new Tile();
  t.rect(15, 10, 16, 27, hex("#3a3c40"));
  t.ellipse(15.5, 28, 5, 1.8, hex("#2a2c30"));
  t.rect(8, 12, 23, 13, hex("#55585d"));
  for (const x of [8, 15, 22]) candle(t, x, 7, false);
  t.px(16, 4, [200, 200, 200, 120]);
  t.px(17, 2, [200, 200, 200, 80]);
  t.outline();
  return t;
}

function brazier(lit: boolean): Tile {
  const t = new Tile();
  // Three iron legs and a bowl.
  t.line(10, 28, 13, 18, hex("#2a2c30"), 2);
  t.line(22, 28, 19, 18, hex("#2a2c30"), 2);
  t.line(16, 29, 16, 19, hex("#3a3c40"), 2);
  t.ellipse(16, 17, 9, 4.5, (x) => (x < 14 ? hex("#6a6e74") : hex("#3a3c40")));
  t.ellipse(16, 15, 7.5, 2.5, hex(lit ? "#8a2a0a" : "#2a2420"));
  for (const [x, y] of [[13, 15], [17, 14], [19, 16]] as const) t.px(x, y, hex(lit ? "#ffb02e" : "#4a4440"));
  if (lit) {
    t.ellipse(16, 10, 5, 6, hex("#ff6a1a"));
    t.ellipse(16, 11, 3.2, 4.2, hex("#ffa92e"));
    t.ellipse(16, 12, 1.8, 2.5, hex("#ffe98a"));
  }
  t.outline();
  t.shadow(1, 1);
  return t;
}

function well(): Tile {
  const t = new Tile();
  // Round stone wall, dark water, a little roof on posts.
  t.ellipse(16, 22, 11, 6, (x, y) => ((x + y * 3) % 4 === 0 ? hex("#6a665e") : x < 14 ? hex("#a8a298") : hex("#7d786e")));
  t.ellipse(16, 21, 8, 3.8, hex("#1a2a3a"));
  t.ellipse(14, 20.5, 3, 1, hex("#4a7aa0"));
  t.rect(6, 6, 7, 21, WOOD_D);
  t.rect(25, 6, 26, 21, WOOD_D);
  t.line(4, 7, 16, 1, hex("#8a3a2a"), 2);
  t.line(28, 7, 16, 1, hex("#6a2a1a"), 2);
  t.line(7, 10, 25, 10, WOOD_M);
  t.line(16, 10, 16, 18, hex("#c8b89a"));
  t.rect(14, 15, 18, 18, WOOD_M);
  t.outline();
  t.shadow();
  return t;
}

function rug(): Tile {
  const t = new Tile();
  const red = hex("#8a1f24");
  const gold = hex("#d8a83a");
  t.rect(2, 4, 29, 27, red);
  t.rect(2, 4, 29, 5, gold);
  t.rect(2, 26, 29, 27, gold);
  t.rect(5, 8, 26, 23, hex("#6a1419"));
  t.ring(15.5, 15.5, 7, 5, 1, () => gold);
  t.ellipse(15.5, 15.5, 2, 2, gold);
  for (let x = 3; x < 29; x += 3) {
    t.px(x, 3, gold);
    t.px(x, 28, gold);
  }
  return t;
}

function ledge(kind: "wood" | "rock"): Tile {
  const t = new Tile();
  if (kind === "wood") {
    // A low wooden stage.
    planks(t, 1, 4, 30, 24);
    t.rect(1, 25, 30, 30, mix(WOOD_M, WOOD_D, 0.6));
    for (let x = 1; x <= 30; x += 5) t.rect(x, 25, x, 30, WOOD_D);
  } else {
    // A flat-topped rock to climb on.
    t.ellipse(16, 16, 14, 10, (x, y) => mix(hex("#a8a090"), hex("#6a6258"), Math.min(1, Math.max(0, (x - 4) / 40 + (y - 8) / 30))));
    t.rect(4, 18, 28, 27, hex("#4f4b45"));
    t.ellipse(16, 16, 12, 8, (x, y) => mix(hex("#b8b0a0"), hex("#7a7268"), Math.min(1, Math.max(0, (x - 4) / 40 + (y - 8) / 30))));
    t.line(8, 14, 12, 17, hex("#5a544a"));
    t.line(19, 12, 23, 15, hex("#5a544a"));
  }
  t.outline();
  return t;
}

function chicken(): Tile {
  const t = new Tile();
  t.ellipse(15, 19, 6, 5, hex("#f4efe4"));
  t.ellipse(20, 13, 3, 3, hex("#f4efe4"));
  t.rect(20, 9, 21, 10, hex("#d82a2a"));
  t.px(23, 13, hex("#f0a82a"));
  t.px(24, 13, hex("#f0a82a"));
  t.px(21, 12, hex("#1a1a1a"));
  t.ellipse(10, 17, 3, 3.5, hex("#d8d0c0"));
  t.line(14, 24, 13, 27, hex("#f0a82a"));
  t.line(17, 24, 18, 27, hex("#f0a82a"));
  t.outline();
  return t;
}

function cat(): Tile {
  const t = new Tile();
  const fur = hex("#d8883a");
  const dark = hex("#8a4a1a");
  t.ellipse(15, 21, 7, 4.5, fur);
  t.ellipse(22, 15, 4, 3.5, fur);
  t.line(19, 12, 20, 9, fur, 2);
  t.line(24, 12, 25, 9, fur, 2);
  t.px(21, 15, hex("#2a6a2a"));
  t.px(23, 15, hex("#2a6a2a"));
  t.line(8, 20, 5, 13, fur, 2);
  for (const x of [11, 15, 19]) t.line(x, 18, x, 23, dark);
  t.rect(10, 25, 11, 26, fur);
  t.rect(19, 25, 20, 26, fur);
  t.outline();
  return t;
}

function shelf(): Tile {
  // Bar counter with bottles.
  const t = new Tile();
  planks(t, 1, 12, 30, 27);
  t.rect(1, 12, 30, 14, WOOD_L);
  t.rect(1, 26, 30, 27, WOOD_D);
  const bottles = ["#2a7a3a", "#8a2a2a", "#2a4a8a", "#a88a2a"];
  bottles.forEach((c, k) => {
    const x = 5 + k * 7;
    t.rect(x, 5, x + 2, 11, hex(c));
    t.rect(x + 1, 2, x + 1, 4, hex(c));
    t.px(x, 6, hex("#ffffff", 150));
  });
  t.outline();
  t.shadow();
  return t;
}

function danger(): Tile {
  // A red warning circle with cracks: something is about to fall here.
  const t = new Tile();
  t.ring(16, 16, 13, 13, 2, () => [230, 40, 30, 220]);
  t.ring(16, 16, 9, 9, 1, () => [255, 90, 60, 160]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 16, y - 16);
    if (d < 12 && t.alpha(x, y) === 0) t.px(x, y, [200, 30, 20, Math.round(70 * (1 - d / 12))]);
  }
  t.line(10, 12, 15, 16, [40, 10, 10, 200]);
  t.line(15, 16, 13, 22, [40, 10, 10, 200]);
  t.line(15, 16, 22, 14, [40, 10, 10, 200]);
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
table().save("table.png");
tableFlipped().save("table_flipped.png");
stool().save("stool.png");
bench().save("bench.png");
bookshelf().save("bookshelf.png");
crate().save("crate.png");
debris().save("debris.png");
pot().save("pot.png");
potShards().save("pot_shards.png");
weaponRack().save("weapon_rack.png");
hay().save("hay.png");
web().save("web.png");
rubble().save("rubble.png");
puddle("water").save("puddle.png");
puddle("oil").save("oil.png");
puddle("ice").save("ice.png");
scorch().save("scorch.png");
for (let k = 0; k < 3; k++) crack(k).save(`crack_${k}.png`);
leaves().save("leaves.png");
bones().save("bones.png");
mushrooms(false).save("mushrooms.png");
mushrooms(true).save("mushrooms_glow.png");
herbs().save("herbs.png");
stalagmite().save("stalagmite.png");
candles().save("candles.png");
candlesOut().save("candles_out.png");
brazier(true).save("brazier_lit.png");
brazier(false).save("brazier_out.png");
well().save("well.png");
rug().save("rug.png");
ledge("wood").save("stage.png");
ledge("rock").save("rock_ledge.png");
chicken().save("chicken.png");
cat().save("cat.png");
shelf().save("counter.png");
danger().save("danger.png");
console.log(`custom tiles → ${OUT}`);
