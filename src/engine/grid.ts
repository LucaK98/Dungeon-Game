/**
 * Path finding on the square grid (breadth-first search, 8 directions).
 * The map decides which squares are walkable; creatures block their squares
 * (allies may be passed through, but nobody may stop on an occupied square).
 */
import type { Battle, Creature, GridPos } from "../shared/game";
import { isActive, squaresOf } from "./combat";

export type Walkable = (p: GridPos) => boolean;

export const OPEN_FIELD: Walkable = () => true;

const DIRS: GridPos[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

const key = (p: GridPos) => `${p.x},${p.y}`;

function occupancy(battle: Battle, mover: Creature): { enemy: Set<string>; any: Set<string> } {
  const enemy = new Set<string>();
  const any = new Set<string>();
  for (const c of Object.values(battle.creatures)) {
    // Fallen monsters don't block; downed heroes still lie there.
    if (c.id === mover.id || !c.pos || c.dead || (c.kind === "monster" && !isActive(c))) continue;
    for (const s of squaresOf(c)) {
      any.add(key(s));
      if (c.side !== mover.side) enemy.add(key(s));
    }
  }
  return { enemy, any };
}

/**
 * Shortest path for `mover` to any square satisfying `goal`, at most `maxSteps` long.
 * Returns the squares to walk (without the start), or undefined if unreachable.
 */
export function findPath(
  battle: Battle,
  mover: Creature,
  goal: (p: GridPos) => boolean,
  walkable: Walkable,
  maxSteps = 60,
): GridPos[] | undefined {
  const start = mover.pos;
  if (!start) return undefined;
  if (goal(start)) return [];
  const occ = occupancy(battle, mover);
  const fits = (p: GridPos) => squaresOf(mover, p).every((s) => walkable(s) && !occ.enemy.has(key(s)));
  const canStop = (p: GridPos) => squaresOf(mover, p).every((s) => !occ.any.has(key(s)));

  const prev = new Map<string, GridPos | null>([[key(start), null]]);
  let frontier: GridPos[] = [start];
  for (let step = 0; step < maxSteps && frontier.length; step++) {
    const next: GridPos[] = [];
    for (const p of frontier) {
      for (const d of DIRS) {
        const q = { x: p.x + d.x, y: p.y + d.y };
        const k = key(q);
        if (prev.has(k) || !fits(q)) continue;
        prev.set(k, p);
        if (goal(q) && canStop(q)) {
          const path: GridPos[] = [q];
          let cur = p;
          while (key(cur) !== key(start)) {
            path.unshift(cur);
            cur = prev.get(key(cur))!;
          }
          return path;
        }
        next.push(q);
      }
    }
    frontier = next;
  }
  return undefined;
}
