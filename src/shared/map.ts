/**
 * Dungeon maps: hand-built room modules (src/data/rooms/*.json) glued together by the generator.
 */
import type { GridPos } from "./game";

/**
 * Characters in a room module:
 *   (space) outside the room     #  wall            .  floor          ,  second floor (path, carpet)
 *   ~  deep water                -  shallow water   =  bridge         T  tree (blocks)
 *   E  exit (becomes a door or passage when connected, else wall)
 *   +  closed door               '  open door       t  wall with torch   B  wall with banner
 *   C  chest                     S  statue          A  altar            F  fountain
 *   K  column                    H  throne          O  boulder          b  box
 *   >  stairs down               <  stairs up       ^  hidden trap      g  gold
 *   p  potion                    L  special item    P  party start      m  monster spot
 *   n  NPC spot                  X  boss spot
 */
export type ModuleChar = string;

export type Theme = "castle" | "throne" | "meadow" | "forest" | "village" | "cave" | "lair" | "crypt" | "stone" | "town" | "mine" | "peak" | "church" | "tavern";

export type RoomTag = "start" | "corridor" | "treasure" | "trap" | "boss" | "outdoor" | "rest" | "npc" | "fight";

export interface RoomModule {
  id: string;
  name: string;
  theme: Theme;
  tags: RoomTag[];
  /** Short description for the DM (and the AI in A8). */
  description: string;
  map: string[];
}

export type CellKind = "void" | "wall" | "floor" | "water" | "deep";

export type ObjectKind =
  | "door"
  | "chest"
  | "torch"
  | "banner"
  | "tree"
  | "statue"
  | "altar"
  | "fountain"
  | "column"
  | "throne"
  | "boulder"
  | "box"
  | "stairs-down"
  | "stairs-up"
  | "trap"
  | "gold"
  | "potion"
  | "item"
  | "barrel"
  | "lever"
  | "chandelier"
  | "secret"
  | "campfire"
  | "cauldron";

export interface MapObject {
  id: string;
  kind: ObjectKind;
  x: number;
  y: number;
  frame: string;
  /** Can't walk through (closed doors, trees, statues, …). */
  blocking: boolean;
  /** Doors: open/closed, chests: opened, traps: found/triggered. */
  state?: "open" | "closed" | "hidden" | "found" | "used";
  roomId?: string;
  /** Levers: what pulling does ("cache", "trap", "door"); secrets: "plate" or "runes". */
  variant?: string;
}

export interface PlacedRoom {
  id: string;
  moduleId: string;
  name: string;
  theme: Theme;
  tags: RoomTag[];
  x: number;
  y: number;
  w: number;
  h: number;
  /** Spots marked in the module (world coordinates). */
  spots: { party: GridPos[]; monster: GridPos[]; npc: GridPos[]; boss: GridPos[] };
}

export interface DungeonMap {
  /** Night / no daylight: only torches and carried light make things visible. */
  dark?: boolean;
  width: number;
  height: number;
  /** Row-major, width × height. */
  cells: CellKind[];
  /** Frame to draw per cell (floor or wall), "" for void. */
  frames: string[];
  /** Extra frame drawn on top of a cell (torch, banner, tree on forest walls), by cell index. */
  overlays: Record<number, string>;
  /** Room index per cell, -1 for corridors and void. */
  roomOf: number[];
  rooms: PlacedRoom[];
  objects: MapObject[];
  /** Cells the heroes have seen (fog of war). */
  explored: boolean[];
}

export function cellIndex(map: Pick<DungeonMap, "width">, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: Pick<DungeonMap, "width" | "height">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}
