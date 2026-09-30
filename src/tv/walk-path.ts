/**
 * The way a figure walks on the TV: square by square around walls and furniture (8 directions,
 * like the game), so nobody glides through a wall or teleports. No path (a jump, a push over
 * something, a far jump): undefined, and the figure takes the direct way.
 */
import { isWalkable } from "../map/walk";
import type { GridPos } from "../shared/game";
import type { DungeonMap } from "../shared/map";

export function gridPath(map: DungeonMap, from: GridPos, to: GridPos, maxSteps = 30): GridPos[] | undefined {
  if (from.x === to.x && from.y === to.y) return [];
  const key = (p: GridPos) => `${p.x},${p.y}`;
  const goal = key(to);
  const prev = new Map<string, string | null>([[key(from), null]]);
  let frontier: GridPos[] = [from];
  for (let depth = 0; depth < maxSteps && frontier.length; depth++) {
    const next: GridPos[] = [];
    for (const p of frontier) {
      // Straight steps first, then diagonals: the walk looks natural.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const q = { x: p.x + dx, y: p.y + dy };
        const k = key(q);
        if (prev.has(k)) continue;
        if (k !== goal && !isWalkable(map, q)) continue;
        // No cutting corners past a wall.
        if (dx && dy && (!isWalkable(map, { x: p.x + dx, y: p.y }) || !isWalkable(map, { x: p.x, y: p.y + dy }))) continue;
        prev.set(k, key(p));
        if (k === goal) {
          const path: GridPos[] = [];
          for (let at: string | null = k; at && at !== key(from); at = prev.get(at) ?? null) {
            const [x, y] = at.split(",").map(Number);
            path.unshift({ x: x!, y: y! });
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
