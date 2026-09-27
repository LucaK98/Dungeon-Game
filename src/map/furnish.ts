/**
 * Furnishes the rooms: tables and stools in the tavern, pews in the church, coffins in the crypt,
 * bushes and herbs in the forest … plus decals on the floor (moss, cracks, leaves, bones, rugs),
 * puddles and oil, and the weather. Everything with rules lives in props.ts.
 * Uses its own random numbers (from the map seed), and never blocks a way.
 */
import { seededRng, type Rng } from "../engine/rng";
import type { GridPos } from "../shared/game";
import { cellIndex, type DungeonMap, type PlacedRoom, type PropId, type SurfaceKind, type Theme, type Weather } from "../shared/map";
import { placer } from "./decorate";
import { THEMES } from "./modules";
import { PROPS } from "./props";

type Where = "wall" | "corner" | "open" | "any";

interface Recipe {
  prop: PropId;
  /** How many per room: [min, max]; more in big rooms. */
  count: [number, number];
  where: Where;
}

const RECIPES: Partial<Record<Theme, Recipe[]>> = {
  tavern: [
    { prop: "counter", count: [1, 2], where: "wall" },
    { prop: "candles", count: [1, 1], where: "corner" },
    { prop: "pot", count: [1, 2], where: "corner" },
    { prop: "stage", count: [0, 1], where: "corner" },
  ],
  church: [
    { prop: "candles", count: [2, 3], where: "wall" },
    { prop: "bookshelf", count: [0, 1], where: "wall" },
    { prop: "pot", count: [0, 1], where: "corner" },
  ],
  crypt: [
    { prop: "coffin", count: [2, 3], where: "wall" },
    { prop: "candles", count: [1, 1], where: "corner" },
    { prop: "web", count: [1, 2], where: "corner" },
    { prop: "pot", count: [0, 1], where: "corner" },
  ],
  throne: [
    { prop: "brazier", count: [2, 2], where: "open" },
    { prop: "weapon-rack", count: [1, 1], where: "wall" },
    { prop: "candles", count: [1, 2], where: "wall" },
    { prop: "column-broken", count: [0, 1], where: "open" },
  ],
  castle: [
    { prop: "crate", count: [1, 3], where: "corner" },
    { prop: "weapon-rack", count: [0, 1], where: "wall" },
    { prop: "brazier", count: [0, 1], where: "open" },
    { prop: "bookshelf", count: [0, 1], where: "wall" },
    { prop: "hay", count: [0, 1], where: "any" },
    { prop: "pot", count: [0, 1], where: "corner" },
  ],
  stone: [
    { prop: "rubble", count: [1, 2], where: "any" },
    { prop: "crate", count: [0, 1], where: "corner" },
    { prop: "pot", count: [0, 2], where: "corner" },
    { prop: "web", count: [0, 2], where: "corner" },
    { prop: "brazier", count: [0, 1], where: "open" },
  ],
  mine: [
    { prop: "crate", count: [1, 2], where: "corner" },
    { prop: "rubble", count: [1, 2], where: "any" },
    { prop: "rock-ledge", count: [0, 1], where: "any" },
    { prop: "stalagmite", count: [0, 1], where: "open" },
    { prop: "pot", count: [0, 1], where: "corner" },
  ],
  cave: [
    { prop: "stalagmite", count: [1, 3], where: "open" },
    { prop: "mushrooms-glow", count: [1, 2], where: "any" },
    { prop: "mushrooms", count: [0, 1], where: "any" },
    { prop: "rock-ledge", count: [0, 1], where: "any" },
    { prop: "web", count: [0, 1], where: "corner" },
    { prop: "rubble", count: [0, 1], where: "any" },
  ],
  lair: [
    { prop: "stalagmite", count: [1, 2], where: "open" },
    { prop: "rubble", count: [1, 2], where: "any" },
    { prop: "rock-ledge", count: [0, 1], where: "any" },
    { prop: "brazier", count: [0, 1], where: "open" },
  ],
  forest: [
    { prop: "bush", count: [2, 4], where: "any" },
    { prop: "thorns", count: [0, 1], where: "any" },
    { prop: "herbs", count: [1, 2], where: "any" },
    { prop: "mushrooms", count: [0, 1], where: "any" },
    { prop: "stump", count: [1, 2], where: "any" },
  ],
  meadow: [
    { prop: "bush", count: [1, 3], where: "any" },
    { prop: "herbs", count: [1, 1], where: "any" },
    { prop: "stump", count: [0, 1], where: "any" },
    { prop: "hay", count: [0, 2], where: "any" },
  ],
  village: [
    { prop: "hay", count: [1, 2], where: "any" },
    { prop: "crate", count: [0, 1], where: "corner" },
    { prop: "pot", count: [1, 2], where: "corner" },
    { prop: "well", count: [0, 1], where: "open" },
    { prop: "bush", count: [0, 2], where: "any" },
    { prop: "herbs", count: [0, 1], where: "any" },
  ],
  town: [
    { prop: "crate", count: [1, 2], where: "corner" },
    { prop: "pot", count: [1, 2], where: "corner" },
    { prop: "well", count: [0, 1], where: "open" },
    { prop: "stage", count: [0, 1], where: "any" },
    { prop: "hay", count: [0, 1], where: "any" },
  ],
  peak: [
    { prop: "rock-ledge", count: [1, 2], where: "any" },
    { prop: "rubble", count: [1, 1], where: "any" },
    { prop: "bush", count: [0, 1], where: "any" },
    { prop: "thorns", count: [0, 1], where: "any" },
    { prop: "herbs", count: [0, 1], where: "any" },
  ],
};

/** Module boxes ("b") become fitting furniture. */
const BOX_AS: Partial<Record<Theme, PropId>> = { tavern: "table", church: "bench", castle: "crate", town: "crate", village: "crate", mine: "crate", stone: "crate" };

const DECALS: Partial<Record<Theme, { frames: string[]; share: number }>> = {
  cave: { frames: ["moss.0", "moss.1", "bones", "crack.0"], share: 0.1 },
  mine: { frames: ["crack.0", "crack.1", "moss.2"], share: 0.08 },
  crypt: { frames: ["bones", "moss.3", "crack.1", "crack.2"], share: 0.12 },
  lair: { frames: ["bones", "scorch", "crack.2"], share: 0.1 },
  stone: { frames: ["crack.0", "crack.1", "crack.2", "moss.0"], share: 0.08 },
  castle: { frames: ["crack.0", "crack.2"], share: 0.05 },
  throne: { frames: ["crack.1"], share: 0.03 },
  church: { frames: ["crack.0"], share: 0.03 },
  tavern: { frames: ["crack.2"], share: 0.03 },
  forest: { frames: ["leaves"], share: 0.1 },
  meadow: { frames: ["leaves"], share: 0.04 },
  village: { frames: ["leaves", "crack.0"], share: 0.05 },
  town: { frames: ["crack.0", "crack.1", "leaves"], share: 0.06 },
  peak: { frames: ["crack.1"], share: 0.05 },
};

/** Puddles (and oil) on the floor: [kind, chance per room]. */
const PUDDLES: Partial<Record<Theme, [SurfaceKind, number][]>> = {
  cave: [["puddle", 0.8]],
  mine: [["puddle", 0.5], ["oil", 0.5]],
  crypt: [["puddle", 0.5]],
  stone: [["puddle", 0.5], ["oil", 0.3]],
  castle: [["oil", 0.4]],
  town: [["puddle", 0.7]],
  village: [["puddle", 0.5]],
  forest: [["puddle", 0.3]],
  tavern: [["puddle", 0.3]],
};

const RUG: Theme[] = ["throne", "tavern", "church"];

export function furnish(map: DungeonMap, seed: number): void {
  const rng = seededRng(seed ^ 0xf00d);
  const P = placer(map);
  map.decals ??= {};
  map.surface ??= {};
  const addProp = (prop: PropId, p: GridPos, room: PlacedRoom) => {
    const def = PROPS[prop];
    const frame = def.frames[rng.int(0, def.frames.length - 1)]!;
    P.add({ kind: "prop", prop, x: p.x, y: p.y, frame, blocking: def.blocking, roomId: room.id, ...(prop === "table" ? { uses: 3 } : prop === "weapon-rack" ? { uses: 3 } : {}) });
  };

  // No walls of furniture: blocking things keep a square apart from each other and from where monsters stand.
  const spotSet = new Set(map.rooms.flatMap((r) => [...r.spots.monster, ...r.spots.boss, ...r.spots.npc, ...r.spots.party]).map((p) => `${p.x},${p.y}`));
  const crowded = (p: GridPos) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.objects.some((o) => o.blocking && o.x === p.x + dx! && o.y === p.y + dy!) || spotSet.has(`${p.x + dx!},${p.y + dy!}`));

  map.rooms.forEach((room, index) => {
    // Boxes become tables, pews or crates.
    const as = BOX_AS[room.theme];
    if (as) {
      for (const o of map.objects) {
        if (o.kind !== "box" || o.roomId !== room.id) continue;
        const def = PROPS[as];
        Object.assign(o, { kind: "prop", prop: as, frame: def.frames[0]!, blocking: true, ...(as === "table" ? { uses: 3 } : {}) });
      }
    }
    const cells = P.inside(room);
    const free = () => cells.filter((p) => P.usable(p));
    const area = cells.length;
    const scale = area > 60 ? 1 : 0;
    for (const r of RECIPES[room.theme] ?? []) {
      const n = rng.int(r.count[0], r.count[1] + scale);
      for (let k = 0; k < n; k++) {
        const def = PROPS[r.prop];
        const fits = (p: GridPos) =>
          (r.where === "wall" ? P.wall({ x: p.x, y: p.y - 1 }) : r.where === "corner" ? P.corner(p) || P.wall({ x: p.x, y: p.y - 1 }) : r.where === "open" ? P.open(p) : true) &&
          (!def.blocking || (P.safe(p) && !crowded(p))) &&
          // Keep the way in and out of every room easy: nothing difficult right at the walls' openings.
          !(def.difficult && P.nearDoor(p));
        const c = P.pick(free().filter(fits), rng);
        if (c) addProp(r.prop, c, room);
      }
    }
    // Stools around the tavern tables.
    if (room.theme === "tavern") {
      for (const t of map.objects.filter((o) => o.prop === "table" && o.roomId === room.id)) {
        const around = [{ x: t.x - 1, y: t.y }, { x: t.x + 1, y: t.y }, { x: t.x, y: t.y + 1 }].filter((p) => P.usable(p));
        for (const p of around.slice(0, rng.int(0, 2))) addProp("stool", p, room);
      }
    }
    // Floor decals.
    const d = DECALS[room.theme];
    if (d) {
      for (const p of cells) if (rng.next() < d.share) map.decals![cellIndex(map, p.x, p.y)] = d.frames[rng.int(0, d.frames.length - 1)]!;
    }
    if (RUG.includes(room.theme) && room.w >= 6 && room.h >= 6) {
      const mid = { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) };
      for (const p of [mid, { x: mid.x, y: mid.y + 1 }, { x: mid.x, y: mid.y - 1 }]) if (P.at(p) === "floor") map.decals![cellIndex(map, p.x, p.y)] = "rug";
    }
    // Puddles and oil.
    for (const [kind, chance] of PUDDLES[room.theme] ?? []) {
      if (rng.next() >= chance) continue;
      const c = P.pick(free().filter((p) => !map.surface![cellIndex(map, p.x, p.y)]), rng);
      if (!c) continue;
      map.surface![cellIndex(map, c.x, c.y)] = { kind };
      // Sometimes it spreads over a neighbouring square.
      const n = { x: c.x + (rng.next() < 0.5 ? 1 : 0), y: c.y + (rng.next() < 0.5 ? 0 : 1) };
      if ((n.x !== c.x || n.y !== c.y) && P.at(n) === "floor" && rng.next() < 0.6) map.surface![cellIndex(map, n.x, n.y)] = { kind };
    }
    void index;
  });

  // A few cracks in the corridors too.
  for (let i = 0; i < map.cells.length; i++) {
    if (map.cells[i] === "floor" && map.roomOf[i] === -1 && !map.decals[i] && rng.next() < 0.04) map.decals[i] = `crack.${rng.int(0, 2)}`;
  }
  map.weather = pickWeather(map, rng);
}

function pickWeather(map: DungeonMap, rng: Rng): Weather | undefined {
  const themes = map.rooms.map((r) => r.theme);
  const outdoor = themes.filter((t) => THEMES[t].outdoor).length;
  if (themes.includes("lair")) return "ash";
  if (outdoor * 2 < themes.length) return themes.some((t) => t === "cave" || t === "mine") ? "dust" : undefined;
  if (map.dark) return rng.next() < 0.6 ? "fireflies" : "fog";
  if (themes.includes("forest")) return rng.next() < 0.6 ? "leaves" : rng.next() < 0.5 ? "rain" : undefined;
  if (themes.includes("peak")) return rng.next() < 0.5 ? "fog" : "snow";
  const r = rng.next();
  return r < 0.3 ? "rain" : r < 0.5 ? "fog" : r < 0.65 ? "leaves" : undefined;
}
