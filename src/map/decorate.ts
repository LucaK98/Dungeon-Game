/**
 * Things to play with, added to every generated map: barrels, chandeliers, levers, camp fires,
 * cauldrons and hidden secrets. They are placed so they never block a way (corners, open areas).
 * Uses its own random numbers (from the map seed), so the game's dice stay the same.
 */
import { seededRng, type Rng } from "../engine/rng";
import type { GridPos } from "../shared/game";
import { cellIndex, type DungeonMap, type MapObject, type PlacedRoom, type Theme } from "../shared/map";

const BARRELS: Partial<Record<Theme, number>> = { castle: 2, tavern: 2, town: 2, village: 2, mine: 2, cave: 1, stone: 1, crypt: 1 };
const CHANDELIER: Theme[] = ["throne", "church", "tavern", "castle"];
const LEVER: Theme[] = ["castle", "crypt", "mine", "stone", "church", "throne"];
const RUNES: Theme[] = ["crypt", "church", "castle", "throne", "stone"];
const CAMPFIRE: Theme[] = ["forest", "meadow", "peak"];
const CAULDRON = ["kraeuterhuette", "hexentanzplatz"];

export function decorate(map: DungeonMap, seed: number): void {
  const rng = seededRng(seed ^ 0x5eed);
  const at = (p: GridPos) => (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height ? "void" : map.cells[cellIndex(map, p.x, p.y)]);
  const wall = (p: GridPos) => at(p) === "wall";
  const taken = new Set(map.objects.map((o) => `${o.x},${o.y}`));
  const spots = new Set(map.rooms.flatMap((r) => [...r.spots.party, ...r.spots.monster, ...r.spots.npc, ...r.spots.boss].map((p) => `${p.x},${p.y}`)));
  const doors = map.objects.filter((o) => o.kind === "door");
  const nearDoor = (p: GridPos) => doors.some((d) => Math.max(Math.abs(d.x - p.x), Math.abs(d.y - p.y)) <= 1);
  const usable = (p: GridPos) => at(p) === "floor" && !taken.has(`${p.x},${p.y}`) && !spots.has(`${p.x},${p.y}`) && !nearDoor(p);
  const add = (o: Omit<MapObject, "id">) => {
    map.objects.push({ id: `o${map.objects.length}`, ...o });
    taken.add(`${o.x},${o.y}`);
  };
  const inside = (room: PlacedRoom): GridPos[] => {
    const out: GridPos[] = [];
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) for (let x = room.x + 1; x < room.x + room.w - 1; x++) if (map.roomOf[cellIndex(map, x, y)] === map.rooms.indexOf(room)) out.push({ x, y });
    return out;
  };
  /** A corner: walls on two sides that meet. */
  const corner = (p: GridPos) =>
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => wall({ x: p.x + dx!, y: p.y }) && wall({ x: p.x, y: p.y + dy! }) && wall({ x: p.x + dx!, y: p.y + dy! }));
  /**
   * A blocker here cuts no way: the free squares around it stay connected with each other
   * (checked inside the 3×3 block, walking straight only).
   */
  const safe = (p: GridPos) => {
    const ring = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].map(([dx, dy]) => ({ x: p.x + dx!, y: p.y + dy! }));
    const free = ring.filter((q) => at(q) === "floor" || at(q) === "water");
    if (!free.length) return false;
    const seen = new Set([`${free[0]!.x},${free[0]!.y}`]);
    const todo = [free[0]!];
    while (todo.length) {
      const q = todo.pop()!;
      for (const n of free) {
        const key = `${n.x},${n.y}`;
        if (!seen.has(key) && Math.abs(n.x - q.x) + Math.abs(n.y - q.y) === 1) {
          seen.add(key);
          todo.push(n);
        }
      }
    }
    return seen.size === free.length;
  };
  /** Open floor all around: a single blocker here can't cut a way. */
  const open = (p: GridPos) => [...Array(9).keys()].every((k) => at({ x: p.x + (k % 3) - 1, y: p.y + Math.floor(k / 3) - 1 }) === "floor");
  const pick = <T>(list: T[], r: Rng): T | undefined => (list.length ? list[r.int(0, list.length - 1)] : undefined);

  let lever = false;
  let secrets = 0;
  map.rooms.forEach((room, index) => {
    if (index === 0 && room.tags.includes("start")) return;
    const cells = inside(room).filter(usable);
    // Barrels in corners.
    const barrels = BARRELS[room.theme] ?? 0;
    for (let i = 0; i < barrels; i++) {
      if (rng.next() < 0.35) continue;
      const c = pick(cells.filter((p) => corner(p) && safe(p) && !taken.has(`${p.x},${p.y}`)), rng);
      if (c) add({ kind: "barrel", x: c.x, y: c.y, frame: "barrel", blocking: true, roomId: room.id });
    }
    // A chandelier over the middle of a big hall.
    if (CHANDELIER.includes(room.theme) && room.w >= 7 && room.h >= 7 && rng.next() < 0.7) {
      const mid = { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) };
      const c = [mid, { x: mid.x + 1, y: mid.y }, { x: mid.x, y: mid.y + 1 }].find((p) => at(p) === "floor" && !taken.has(`${p.x},${p.y}`));
      if (c) add({ kind: "chandelier", x: c.x, y: c.y, frame: "chandelier", blocking: false, roomId: room.id });
    }
    // One lever per map, next to a wall.
    if (!lever && LEVER.includes(room.theme) && rng.next() < 0.6) {
      const c = pick(cells.filter((p) => wall({ x: p.x, y: p.y - 1 }) && !taken.has(`${p.x},${p.y}`)), rng);
      if (c) {
        lever = true;
        const variant = doors.some((d) => d.state === "closed") && rng.next() < 0.4 ? "door" : rng.next() < 0.7 ? "cache" : "trap";
        add({ kind: "lever", x: c.x, y: c.y, frame: "lever.off", blocking: false, roomId: room.id, variant });
      }
    }
    // Secrets: a loose floor slab, or signs carved into a wall.
    if (secrets < 2 && !["forest", "meadow", "peak"].includes(room.theme) && rng.next() < 0.45) {
      if (RUNES.includes(room.theme) && rng.next() < 0.5) {
        const w = pick(
          cells.filter((p) => wall({ x: p.x, y: p.y - 1 }) && !taken.has(`${p.x},${p.y - 1}`) && !map.overlays[cellIndex(map, p.x, p.y - 1)]).map((p) => ({ x: p.x, y: p.y - 1 })),
          rng,
        );
        if (w) {
          secrets++;
          add({ kind: "secret", x: w.x, y: w.y, frame: "secret.runes", blocking: false, state: "hidden", roomId: room.id, variant: "runes" });
        }
      } else {
        const c = pick(cells.filter((p) => !taken.has(`${p.x},${p.y}`)), rng);
        if (c) {
          secrets++;
          add({ kind: "secret", x: c.x, y: c.y, frame: "secret.plate", blocking: false, state: "hidden", roomId: room.id, variant: "plate" });
        }
      }
    }
    // A camp fire in the wild, a cauldron at the witch's.
    const fire = CAMPFIRE.includes(room.theme) && rng.next() < 0.5;
    const cauldron = CAULDRON.includes(room.moduleId);
    if (fire || cauldron) {
      const c = pick(cells.filter((p) => open(p) && safe(p) && !taken.has(`${p.x},${p.y}`)), rng);
      if (c) add(cauldron ? { kind: "cauldron", x: c.x, y: c.y, frame: "cauldron", blocking: true, roomId: room.id } : { kind: "campfire", x: c.x, y: c.y, frame: "campfire", blocking: true, roomId: room.id });
    }
  });
}
