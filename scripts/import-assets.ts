/**
 * Copies only the tiles we need from the Dungeon Crawl Stone Soup pack (CC0) into one texture atlas.
 *   npm run import:assets
 *
 * Source: https://github.com/Snowdrama/CC0-Dungeon-Pack (cloned to raw-assets/ if missing),
 * or set DCSS_SOURCE=/path/to/CC0-Dungeon-Pack.
 * Output: public/assets/atlas.png, atlas.json (Phaser JSON hash) and tileset.json (logical name → frame).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { DOLL, MISC, MONSTERS } from "./assets/selection";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/assets");
const REPO = "https://github.com/Snowdrama/CC0-Dungeon-Pack";
const ATLAS_WIDTH = 1024;
const PADDING = 1;

function sourceDir(): string {
  if (process.env.DCSS_SOURCE) return process.env.DCSS_SOURCE;
  const dir = join(ROOT, "raw-assets/CC0-Dungeon-Pack");
  if (!existsSync(dir)) {
    console.log(`Cloning ${REPO} …`);
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", REPO, dir], { stdio: "inherit" });
  }
  return dir;
}

/** Some DCSS PNGs carry junk after the IEND chunk, which pngjs refuses. */
function readPng(file: string): PNG {
  let buf = readFileSync(file);
  const end = buf.indexOf("IEND");
  if (end > 0) buf = buf.subarray(0, end + 8);
  return PNG.sync.read(buf);
}

interface Entry {
  name: string;
  source: string;
  png: PNG;
  x: number;
  y: number;
}

function collect(): { name: string; source: string }[] {
  const list: { name: string; source: string }[] = [];
  for (const [layer, parts] of Object.entries(DOLL)) {
    for (const [id, source] of Object.entries(parts)) list.push({ name: `doll.${layer}.${id}`, source });
  }
  for (const [id, source] of Object.entries(MONSTERS)) list.push({ name: `monster.${id}`, source });
  for (const [name, source] of Object.entries(MISC)) list.push({ name, source });
  return list;
}

function pack(entries: Entry[]): number {
  // Shelf packing, tallest first.
  entries.sort((a, b) => b.png.height - a.png.height || a.name.localeCompare(b.name));
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const e of entries) {
    if (x + e.png.width > ATLAS_WIDTH) {
      x = 0;
      y += shelf + PADDING;
      shelf = 0;
    }
    e.x = x;
    e.y = y;
    x += e.png.width + PADDING;
    shelf = Math.max(shelf, e.png.height);
  }
  const height = y + shelf;
  // Power of two keeps old GPUs happy.
  let h = 32;
  while (h < height) h *= 2;
  return h;
}

function main(): void {
  const src = sourceDir();
  const entries: Entry[] = collect().map(({ name, source }) => {
    // "custom:" tiles are drawn for this game by scripts/assets/draw-custom.ts.
    const file = source.startsWith("custom:") ? join(ROOT, "scripts/assets/custom", source.slice(7)) : join(src, source);
    if (!existsSync(file)) throw new Error(`${name}: ${source} not found in ${src}`);
    return { name, source, png: readPng(file), x: 0, y: 0 };
  });
  const height = pack(entries);
  const atlas = new PNG({ width: ATLAS_WIDTH, height });
  atlas.data.fill(0);
  for (const e of entries) PNG.bitblt(e.png, atlas, 0, 0, e.png.width, e.png.height, e.x, e.y);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "atlas.png"), PNG.sync.write(atlas));

  const byName = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const frames = Object.fromEntries(
    byName.map((e) => [
      e.name,
      {
        frame: { x: e.x, y: e.y, w: e.png.width, h: e.png.height },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: e.png.width, h: e.png.height },
        sourceSize: { w: e.png.width, h: e.png.height },
      },
    ]),
  );
  writeFileSync(
    join(OUT, "atlas.json"),
    JSON.stringify({ frames, meta: { app: "scripts/import-assets.ts", image: "atlas.png", format: "RGBA8888", size: { w: ATLAS_WIDTH, h: height }, scale: "1" } }) + "\n",
  );
  writeFileSync(
    join(OUT, "tileset.json"),
    JSON.stringify(
      {
        name: "Dungeon Crawl Stone Soup (CC0)",
        tileSize: 32,
        image: "atlas.png",
        atlas: "atlas.json",
        frames: Object.fromEntries(byName.map((e) => [e.name, { frame: e.name, x: e.x, y: e.y, w: e.png.width, h: e.png.height, source: e.source }])),
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`${entries.length} tiles → public/assets/atlas.png (${ATLAS_WIDTH}×${height})`);
}

main();
