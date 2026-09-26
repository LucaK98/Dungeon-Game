/**
 * Loads the room modules from src/data/rooms/*.json and finds their exits.
 */
import type { GridPos } from "../shared/game";
import type { RoomModule, RoomTag, Theme } from "../shared/map";

const files = import.meta.glob<RoomModule>("../data/rooms/*.json", { eager: true, import: "default" });

export const MODULES: RoomModule[] = Object.values(files).sort((a, b) => a.id.localeCompare(b.id));

const byId = new Map(MODULES.map((m) => [m.id, m]));

export function getModule(id: string): RoomModule {
  const m = byId.get(id);
  if (!m) throw new Error(`unknown room module "${id}"`);
  return m;
}

export function modulesWithTag(tag: RoomTag): RoomModule[] {
  return MODULES.filter((m) => m.tags.includes(tag));
}

export type Side = "N" | "S" | "E" | "W";

export interface ModuleExit {
  side: Side;
  /** Local cells of the exit, in order along the wall. */
  cells: GridPos[];
}

export const OPPOSITE: Record<Side, Side> = { N: "S", S: "N", E: "W", W: "E" };
export const STEP: Record<Side, GridPos> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };

export function moduleSize(m: RoomModule): { w: number; h: number } {
  return { w: m.map[0]!.length, h: m.map.length };
}

/** Groups neighbouring "E" cells on each border into exits. */
export function moduleExits(m: RoomModule): ModuleExit[] {
  const { w, h } = moduleSize(m);
  const at = (x: number, y: number) => m.map[y]![x];
  const exits: ModuleExit[] = [];
  const scan = (side: Side, cells: GridPos[]) => {
    let run: GridPos[] = [];
    for (const c of cells) {
      if (at(c.x, c.y) === "E") run.push(c);
      else if (run.length) {
        exits.push({ side, cells: run });
        run = [];
      }
    }
    if (run.length) exits.push({ side, cells: run });
  };
  scan("N", Array.from({ length: w }, (_, x) => ({ x, y: 0 })));
  scan("S", Array.from({ length: w }, (_, x) => ({ x, y: h - 1 })));
  scan("W", Array.from({ length: h }, (_, y) => ({ x: 0, y })));
  scan("E", Array.from({ length: h }, (_, y) => ({ x: w - 1, y })));
  return exits;
}

export interface ThemeStyle {
  floor: string;
  alt: string;
  wall: string;
  /** Walls drawn as trees on grass (forest). */
  treeWalls?: boolean;
  /** Floor used for corridors leaving this room. */
  corridor: string;
  outdoor: boolean;
}

export const THEMES: Record<Theme, ThemeStyle> = {
  castle: { floor: "floor.castle", alt: "floor.grass", wall: "wall.castle", corridor: "floor.castle", outdoor: false },
  throne: { floor: "floor.marble", alt: "floor.castle", wall: "wall.castle", corridor: "floor.castle", outdoor: false },
  meadow: { floor: "floor.grass", alt: "floor.path", wall: "wall.hedge", corridor: "floor.path", outdoor: true },
  forest: { floor: "floor.grass", alt: "floor.path", wall: "floor.grass", treeWalls: true, corridor: "floor.path", outdoor: true },
  village: { floor: "floor.village", alt: "floor.dirt", wall: "wall.brick", corridor: "floor.dirt", outdoor: true },
  cave: { floor: "floor.cave", alt: "floor.mud", wall: "wall.cave", corridor: "floor.cave", outdoor: false },
  lair: { floor: "floor.lair", alt: "floor.cave", wall: "wall.lair", corridor: "floor.cave", outdoor: false },
  crypt: { floor: "floor.crypt", alt: "floor.stone", wall: "wall.crypt", corridor: "floor.crypt", outdoor: false },
  stone: { floor: "floor.stone", alt: "floor.castle", wall: "wall.stone", corridor: "floor.stone", outdoor: false },
};

/** How many variants each frame family has in the atlas (see scripts/assets/selection.ts). */
export const VARIANTS: Record<string, number> = {
  "floor.grass": 6,
  "floor.path": 3,
  "floor.dirt": 3,
  "floor.castle": 4,
  "floor.marble": 4,
  "floor.cave": 4,
  "floor.lair": 4,
  "floor.crypt": 4,
  "floor.village": 4,
  "floor.sand": 4,
  "floor.mud": 4,
  "floor.stone": 4,
  "wall.castle": 4,
  "wall.brick": 4,
  "wall.cave": 4,
  "wall.lair": 4,
  "wall.crypt": 4,
  "wall.hedge": 4,
  "wall.stone": 4,
  "wall.church": 4,
  tree: 5,
};
