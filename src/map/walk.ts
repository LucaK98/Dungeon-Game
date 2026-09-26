/** Movement rules on the map: what can be walked on, and what counts as seen. */
import type { GridPos } from "../shared/game";
import { cellIndex, inBounds, type DungeonMap } from "../shared/map";

export function isWalkable(map: DungeonMap, p: GridPos): boolean {
  if (!inBounds(map, p.x, p.y)) return false;
  const kind = map.cells[cellIndex(map, p.x, p.y)];
  if (kind !== "floor" && kind !== "water") return false;
  return !map.objects.some((o) => o.blocking && o.x === p.x && o.y === p.y);
}

/** Squares reachable from `start` (flood fill, 8 directions). */
export function reachable(map: DungeonMap, start: GridPos): Set<number> {
  const seen = new Set<number>([cellIndex(map, start.x, start.y)]);
  const queue: GridPos[] = [start];
  while (queue.length) {
    const p = queue.pop()!;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const q = { x: p.x + dx, y: p.y + dy };
        const i = cellIndex(map, q.x, q.y);
        if ((dx || dy) && isWalkable(map, q) && !seen.has(i)) {
          seen.add(i);
          queue.push(q);
        }
      }
    }
  }
  return seen;
}

/**
 * Fog of war: a creature standing in a room reveals the whole room;
 * in corridors it sees a few squares around itself.
 * Returns the indices of rooms that were revealed for the first time.
 */
export function revealAround(map: DungeonMap, p: GridPos, radius = 3): number[] {
  const newRooms: number[] = [];
  const here = map.roomOf[cellIndex(map, p.x, p.y)] ?? -1;
  if (here >= 0) {
    const room = map.rooms[here]!;
    let fresh = false;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const i = cellIndex(map, x, y);
        if (map.roomOf[i] === here && !map.explored[i]) {
          map.explored[i] = true;
          fresh = true;
        }
      }
    }
    if (fresh) newRooms.push(here);
  }
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(map, x, y) || dx * dx + dy * dy > radius * radius + 1) continue;
      const i = cellIndex(map, x, y);
      // Corridors and the walls around them; rooms are only revealed by entering.
      if (map.roomOf[i] === -1 || map.cells[i] === "wall") map.explored[i] = true;
    }
  }
  return newRooms;
}

/**
 * Start squares for `count` heroes in the first room: the module's party marks,
 * then free squares closest to the room's first exit (where the heroes come in).
 */
export function partyStartSpots(map: DungeonMap, count: number, entry: GridPos): GridPos[] {
  const start = map.rooms[0]!;
  const npcSpots = new Set(map.rooms.flatMap((r) => r.spots.npc).map((p) => `${p.x},${p.y}`));
  const spots = start.spots.party.filter((p) => !npcSpots.has(`${p.x},${p.y}`));
  if (spots.length >= count) return spots.slice(0, count);
  const free: GridPos[] = [];
  for (let y = start.y; y < start.y + start.h; y++) {
    for (let x = start.x; x < start.x + start.w; x++) {
      const key = `${x},${y}`;
      if (isWalkable(map, { x, y }) && map.roomOf[cellIndex(map, x, y)] === 0 && !npcSpots.has(key) && !spots.some((q) => q.x === x && q.y === y)) free.push({ x, y });
    }
  }
  const d = (p: GridPos) => Math.max(Math.abs(p.x - entry.x), Math.abs(p.y - entry.y));
  free.sort((a, b) => d(a) - d(b));
  return [...spots, ...free].slice(0, count);
}
