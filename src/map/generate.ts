/**
 * Builds a dungeon from room modules: places them one after another, connected by corridors,
 * and optionally hangs side rooms (treasure, traps) off free exits.
 */
import type { Rng } from "../engine/rng";
import type { GridPos } from "../shared/game";
import type { CellKind, DungeonMap, MapObject, ObjectKind, PlacedRoom, RoomModule, RoomTag } from "../shared/map";
import { getModule, moduleExits, moduleSize, MODULES, OPPOSITE, STEP, THEMES, VARIANTS, type ModuleExit, type Side } from "./modules";

export interface DungeonPlan {
  /** Main path, in order (module IDs). */
  path: string[];
  /** Side rooms attached anywhere a free exit allows. */
  branches?: string[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Placement {
  module: RoomModule;
  x: number;
  y: number;
  exits: ModuleExit[];
  used: Set<number>;
}

interface Corridor {
  cells: GridPos[];
  floor: string;
}

const MARGIN = 1;

function overlaps(a: Rect, b: Rect, margin = MARGIN): boolean {
  return a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Picks a stable variant of a frame family for a cell (grass gets flowers only now and then). */
export function variantFrame(family: string, x: number, y: number, seed: number): string {
  const n = VARIANTS[family] ?? 1;
  const r = hash(x, y, seed);
  if (family === "floor.grass") return `${family}.${r % 12 === 0 ? 3 + (r >> 4) % 3 : r % 3}`;
  return `${family}.${r % n}`;
}

/**
 * Cells of a corridor between two exits: one L-shaped 1-wide path per exit lane,
 * all lanes together form a corridor as wide as the narrower exit.
 */
function corridorPath(fromCells: GridPos[], fromSide: Side, toCells: GridPos[], toSide: Side): GridPos[] {
  const out: GridPos[] = [];
  const lanes = Math.min(fromCells.length, toCells.length);
  const vertical = fromSide === "N" || fromSide === "S";
  if (OPPOSITE[fromSide] !== toSide) {
    // Perpendicular exits: straight out, then one turn into the other exit.
    for (let k = 0; k < lanes; k++) {
      const a = fromCells[k]!;
      const b = toCells[k]!;
      const cur = { ...a };
      out.push({ ...cur });
      if (vertical) {
        while (cur.y !== b.y) (cur.y += Math.sign(b.y - cur.y), out.push({ ...cur }));
        while (cur.x !== b.x) (cur.x += Math.sign(b.x - cur.x), out.push({ ...cur }));
      } else {
        while (cur.x !== b.x) (cur.x += Math.sign(b.x - cur.x), out.push({ ...cur }));
        while (cur.y !== b.y) (cur.y += Math.sign(b.y - cur.y), out.push({ ...cur }));
      }
    }
    return out;
  }
  for (let k = 0; k < lanes; k++) {
    const a = fromCells[k]!;
    const b = toCells[k]!;
    const along = vertical ? b.y - a.y : b.x - a.x;
    const s = Math.sign(along) || 1;
    const d = Math.abs(along);
    const turn = Math.max(0, Math.min(d, Math.floor(d / 2) - Math.floor(lanes / 2) + k));
    const cur = { ...a };
    out.push({ ...cur });
    if (vertical) {
      const t = a.y + s * turn;
      while (cur.y !== t) (cur.y += s, out.push({ ...cur }));
      while (cur.x !== b.x) (cur.x += Math.sign(b.x - cur.x), out.push({ ...cur }));
      while (cur.y !== b.y) (cur.y += Math.sign(b.y - cur.y), out.push({ ...cur }));
    } else {
      const t = a.x + s * turn;
      while (cur.x !== t) (cur.x += s, out.push({ ...cur }));
      while (cur.y !== b.y) (cur.y += Math.sign(b.y - cur.y), out.push({ ...cur }));
      while (cur.x !== b.x) (cur.x += Math.sign(b.x - cur.x), out.push({ ...cur }));
    }
  }
  return out;
}

function outsideCells(p: { x: number; y: number }, exit: ModuleExit): GridPos[] {
  const step = STEP[exit.side];
  return exit.cells.map((c) => ({ x: p.x + c.x + step.x, y: p.y + c.y + step.y }));
}

function rectOf(p: Placement): Rect {
  const { w, h } = moduleSize(p.module);
  return { x: p.x, y: p.y, w, h };
}

function shuffled<T>(rng: Rng, list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Tries to attach `module` to a free exit of one of `anchors`. */
function attach(rng: Rng, placed: Placement[], corridors: Corridor[], anchors: Placement[], module: RoomModule): Placement | undefined {
  const exits = moduleExits(module);
  const size = moduleSize(module);
  for (const anchor of anchors) {
    const freeExits = shuffled(rng, anchor.exits.map((e, i) => ({ e, i })).filter(({ i }) => !anchor.used.has(i)));
    for (const { e: fromExit, i: fromIndex } of freeExits) {
      // Opposite exits first (straight corridors), then perpendicular ones (L-shaped).
      const all = exits.map((e, i) => ({ e, i }));
      const candidates = [
        ...shuffled(rng, all.filter(({ e }) => e.side === OPPOSITE[fromExit.side])),
        ...shuffled(rng, all.filter(({ e }) => e.side !== OPPOSITE[fromExit.side] && e.side !== fromExit.side)),
      ];
      for (const { e: toExit, i: toIndex } of candidates) {
        for (let attempt = 0; attempt < 12; attempt++) {
          const length = rng.int(2, 6);
          const lateral = attempt < 2 ? 0 : rng.int(-4, 4);
          const fromOut = outsideCells(anchor, fromExit);
          const step = STEP[fromExit.side];
          const first = fromOut[0]!;
          // Where the new room's first exit outside-cell must land.
          const toStep = STEP[toExit.side];
          const perpendicular = toExit.side !== OPPOSITE[fromExit.side];
          // Perpendicular: the new room sits beside the corridor's end, its exit facing back at the corridor.
          const sideways = rng.int(2, 5);
          const target = perpendicular
            ? { x: first.x + step.x * length - toStep.x * sideways, y: first.y + step.y * length - toStep.y * sideways }
            : {
                x: first.x + step.x * length + (step.x === 0 ? lateral : 0),
                y: first.y + step.y * length + (step.y === 0 ? lateral : 0),
              };
          const c = toExit.cells[0]!;
          const pos = { x: target.x - c.x - toStep.x, y: target.y - c.y - toStep.y };
          const rect = { x: pos.x, y: pos.y, w: size.w, h: size.h };
          if (placed.some((p) => overlaps(rect, rectOf(p)))) continue;
          // Don't build over an existing corridor either.
          const inRect = (cell: GridPos, r: Rect, m = 0) => cell.x >= r.x - m && cell.x < r.x + r.w + m && cell.y >= r.y - m && cell.y < r.y + r.h + m;
          if (corridors.some((c) => c.cells.some((cell) => inRect(cell, rect, 1)))) continue;
          const cells = corridorPath(fromOut, fromExit.side, outsideCells(pos, toExit), toExit.side);
          const blocked = cells.some((cell) =>
            [...placed.map(rectOf), rect].some((r) => cell.x >= r.x && cell.x < r.x + r.w && cell.y >= r.y && cell.y < r.y + r.h),
          );
          if (blocked) continue;
          const placement: Placement = { module, x: pos.x, y: pos.y, exits, used: new Set([toIndex]) };
          anchor.used.add(fromIndex);
          corridors.push({ cells, floor: THEMES[anchor.module.theme].corridor });
          return placement;
        }
      }
    }
  }
  return undefined;
}

const OBJECTS: Record<string, { kind: ObjectKind; frame: string; blocking: boolean; state?: MapObject["state"] }> = {
  "+": { kind: "door", frame: "door.closed", blocking: true, state: "closed" },
  "'": { kind: "door", frame: "door.open", blocking: false, state: "open" },
  C: { kind: "chest", frame: "chest.closed", blocking: true, state: "closed" },
  S: { kind: "statue", frame: "statue.hero", blocking: true },
  A: { kind: "altar", frame: "altar", blocking: true },
  F: { kind: "fountain", frame: "fountain", blocking: true },
  K: { kind: "column", frame: "column", blocking: true },
  H: { kind: "throne", frame: "throne", blocking: true },
  O: { kind: "boulder", frame: "boulder", blocking: true },
  b: { kind: "box", frame: "box", blocking: true },
  T: { kind: "tree", frame: "tree.0", blocking: true },
  ">": { kind: "stairs-down", frame: "stairs.down", blocking: false },
  "<": { kind: "stairs-up", frame: "stairs.up", blocking: false },
  "^": { kind: "trap", frame: "trap.plate", blocking: false, state: "hidden" },
  g: { kind: "gold", frame: "item.gold", blocking: false },
  p: { kind: "potion", frame: "item.potion", blocking: false },
  L: { kind: "item", frame: "item.lance", blocking: false },
};

/** Builds the dungeon. Throws if the plan can't be laid out (the caller may retry with another seed). */
export function generateDungeon(rng: Rng, plan: DungeonPlan): DungeonMap {
  const seed = rng.int(0, 1_000_000);
  const placed: Placement[] = [];
  const corridors: Corridor[] = [];

  const first = getModule(plan.path[0]!);
  placed.push({ module: first, x: 0, y: 0, exits: moduleExits(first), used: new Set() });
  for (const id of plan.path.slice(1)) {
    // Attach to the previous room; if that is boxed in, to an earlier one (the path then forks).
    const p =
      attach(rng, placed, corridors, [placed[placed.length - 1]!], getModule(id)) ??
      attach(rng, placed, corridors, [...placed].reverse().slice(1, 3), getModule(id));
    if (!p) throw new Error(`Raum "${id}" passt nicht an den Weg.`);
    placed.push(p);
  }
  for (const id of plan.branches ?? []) {
    // Side rooms hang off the middle of the path, never off the start or the boss room.
    const anchors = shuffled(rng, placed.slice(1, Math.max(2, placed.length - 1)));
    const p = attach(rng, placed, corridors, anchors, getModule(id));
    if (p) placed.push(p);
  }

  // Normalize coordinates.
  const allRects = placed.map(rectOf);
  const allCells = corridors.flatMap((c) => c.cells);
  const minX = Math.min(...allRects.map((r) => r.x), ...allCells.map((c) => c.x)) - 1;
  const minY = Math.min(...allRects.map((r) => r.y), ...allCells.map((c) => c.y)) - 1;
  const maxX = Math.max(...allRects.map((r) => r.x + r.w), ...allCells.map((c) => c.x + 1)) + 1;
  const maxY = Math.max(...allRects.map((r) => r.y + r.h), ...allCells.map((c) => c.y + 1)) + 1;
  const width = maxX - minX;
  const height = maxY - minY;
  const cells: CellKind[] = new Array(width * height).fill("void");
  const frames: string[] = new Array(width * height).fill("");
  const overlays: Record<number, string> = {};
  const roomOf: number[] = new Array(width * height).fill(-1);
  const objects: MapObject[] = [];
  const rooms: PlacedRoom[] = [];
  const idx = (x: number, y: number) => y * width + x;

  placed.forEach((p, roomIndex) => {
    const style = THEMES[p.module.theme];
    const { w, h } = moduleSize(p.module);
    const ox = p.x - minX;
    const oy = p.y - minY;
    const usedCells = new Set<string>();
    p.exits.forEach((e, i) => {
      if (p.used.has(i)) e.cells.forEach((c) => usedCells.add(`${c.x},${c.y}`));
    });
    const room: PlacedRoom = {
      id: `${p.module.id}#${roomIndex}`,
      moduleId: p.module.id,
      name: p.module.name,
      theme: p.module.theme,
      tags: p.module.tags as RoomTag[],
      x: ox,
      y: oy,
      w,
      h,
      spots: { party: [], monster: [], npc: [], boss: [] },
    };
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const ch = p.module.map[ly]![lx]!;
        if (ch === " ") continue;
        const x = ox + lx;
        const y = oy + ly;
        const i = idx(x, y);
        roomOf[i] = roomIndex;
        const floor = () => {
          cells[i] = "floor";
          frames[i] = variantFrame(style.floor, x, y, seed);
        };
        const wall = () => {
          cells[i] = "wall";
          frames[i] = variantFrame(style.wall, x, y, seed);
          if (style.treeWalls) overlays[i] = variantFrame("tree", x, y, seed);
        };
        switch (ch) {
          case "#":
            wall();
            break;
          case "t":
            wall();
            overlays[i] = "torch.1";
            break;
          case "B":
            wall();
            overlays[i] = "banner";
            break;
          case "E":
            if (usedCells.has(`${lx},${ly}`)) {
              cells[i] = "floor";
              frames[i] = variantFrame(style.corridor, x, y, seed);
            } else wall();
            break;
          case ",":
            cells[i] = "floor";
            frames[i] = variantFrame(style.alt, x, y, seed);
            break;
          case "~":
            cells[i] = "deep";
            frames[i] = (x + y) % 2 ? "water.deep" : "water.deep.1";
            break;
          case "-":
            cells[i] = "water";
            frames[i] = (x + y) % 2 ? "water.shallow" : "water.shallow.1";
            break;
          case "=":
            cells[i] = "floor";
            frames[i] = variantFrame("floor.castle", x, y, seed);
            break;
          default: {
            // Objects and markers stand on whatever floor surrounds them (grass, carpet, …).
            const around = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => p.module.map[ly + dy!]?.[lx + dx!]);
            const alt = around.filter((a) => a === ",").length;
            const main = around.filter((a) => a === ".").length;
            if (alt > main) {
              cells[i] = "floor";
              frames[i] = variantFrame(style.alt, x, y, seed);
            } else floor();
            if (ch === "P") room.spots.party.push({ x, y });
            else if (ch === "m") room.spots.monster.push({ x, y });
            else if (ch === "n") room.spots.npc.push({ x, y });
            else if (ch === "X") room.spots.boss.push({ x, y });
            const obj = OBJECTS[ch];
            if (obj) {
              const frame = obj.kind === "tree" ? variantFrame("tree", x, y, seed) : obj.frame;
              objects.push({
                id: `o${objects.length}`,
                kind: obj.kind,
                x,
                y,
                frame,
                blocking: obj.blocking,
                ...(obj.state ? { state: obj.state } : {}),
                roomId: room.id,
              });
            }
          }
        }
      }
    }
    rooms.push(room);
  });

  for (const c of corridors) {
    for (const cell of c.cells) {
      const x = cell.x - minX;
      const y = cell.y - minY;
      const i = idx(x, y);
      if (cells[i] !== "void") continue;
      cells[i] = "floor";
      frames[i] = variantFrame(c.floor, x, y, seed);
    }
  }
  // Walls around corridors (outdoor paths get hedges).
  const corridorWalls = new Map<number, string>();
  corridors.forEach((c) => {
    const wallFamily = c.floor === "floor.path" ? "wall.hedge" : c.floor === "floor.dirt" ? "wall.brick" : c.floor === "floor.cave" ? "wall.cave" : c.floor === "floor.crypt" ? "wall.crypt" : "wall.stone";
    for (const cell of c.cells) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const x = cell.x - minX + dx;
          const y = cell.y - minY + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const i = idx(x, y);
          if (cells[i] === "void") corridorWalls.set(i, wallFamily);
        }
      }
    }
  });
  for (const [i, family] of corridorWalls) {
    cells[i] = "wall";
    frames[i] = variantFrame(family, i % width, Math.floor(i / width), seed);
  }

  const map: DungeonMap = {
    width,
    height,
    cells,
    frames,
    roomOf,
    rooms,
    objects,
    explored: new Array(width * height).fill(false),
    overlays,
  };
  return map;
}

/** Random plan for testing and quick games: start room, a few rooms, boss. */
export function randomPlan(rng: Rng, rooms = 5, branches = 1): DungeonPlan {
  const pick = (tag: RoomTag, exclude: string[] = [], throughRoom = false) => {
    // Rooms in the middle of the path need a way in and a way out.
    const ok = (m: (typeof MODULES)[number]) => m.tags.includes(tag) && (!throughRoom || moduleExits(m).length >= 2);
    let list = MODULES.filter((m) => ok(m) && !exclude.includes(m.id));
    if (!list.length) list = MODULES.filter(ok);
    return list[rng.int(0, list.length - 1)]!.id;
  };
  const path = [pick("start")];
  const middleTags: RoomTag[] = ["fight", "corridor", "trap", "fight", "rest"];
  while (path.length < rooms - 1) {
    const tag = middleTags[rng.int(0, middleTags.length - 1)]!;
    path.push(pick(tag, [...path, "burghof", "drachenhort"], true));
  }
  path.push(pick("boss"));
  const side: string[] = [];
  for (let i = 0; i < branches; i++) side.push(pick("treasure", [...path, ...side, "drachenhort"]));
  return { path, branches: side };
}

/** Tries several layouts until one fits. */
export function generateWithRetries(rng: Rng, plan: DungeonPlan, attempts = 40): DungeonMap {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return generateDungeon(rng, plan);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
