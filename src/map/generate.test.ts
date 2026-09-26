import { describe, expect, it } from "vitest";
import { seededRng } from "../engine/rng";
import { cellIndex } from "../shared/map";
import { generateDungeon, generateWithRetries, randomPlan } from "./generate";
import { moduleExits, MODULES, moduleSize } from "./modules";
import { isWalkable, reachable, revealAround } from "./walk";

const LEGEND = new Set([..." #.,~-=TE+'tBCSAFKHOb><^gpLPmnX"]);

describe("room modules", () => {
  it("has at least 15 well-formed modules", () => {
    expect(MODULES.length).toBeGreaterThanOrEqual(15);
    for (const m of MODULES) {
      const { w } = moduleSize(m);
      for (const row of m.map) {
        expect(row.length, `${m.id}: row width`).toBe(w);
        for (const ch of row) expect(LEGEND.has(ch), `${m.id}: unknown char "${ch}"`).toBe(true);
      }
      expect(moduleExits(m).length, `${m.id}: needs an exit`).toBeGreaterThan(0);
      expect(m.tags.length, m.id).toBeGreaterThan(0);
    }
  });

  it("has party start spots in start rooms and a boss spot in boss rooms", () => {
    for (const m of MODULES) {
      const text = m.map.join("");
      if (m.tags.includes("start")) expect((text.match(/P/g) ?? []).length, m.id).toBeGreaterThanOrEqual(4);
      if (m.tags.includes("boss")) expect(text, m.id).toContain("X");
    }
  });

  it("covers the rooms of story 1", () => {
    const ids = MODULES.map((m) => m.id);
    for (const id of ["burghof", "thronsaal", "turnierplatz", "bruecke", "waldweg", "verbranntes_dorf", "hoehlenstollen", "drachenhort"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("dungeon generator", () => {
  it("connects every room so the whole dungeon can be walked", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = seededRng(seed);
      const map = generateWithRetries(rng, randomPlan(rng, 4 + (seed % 5), seed % 3));
      const start = map.rooms[0]!.spots.party[0]!;
      const reach = reachable(map, start);
      for (const room of map.rooms) {
        const cellsOfRoom = map.roomOf.map((r, i) => (r === map.rooms.indexOf(room) ? i : -1)).filter((i) => i >= 0);
        const walkable = cellsOfRoom.filter((i) => isWalkable(map, { x: i % map.width, y: Math.floor(i / map.width) }));
        expect(walkable.some((i) => reach.has(i)), `seed ${seed}: ${room.id} unreachable`).toBe(true);
      }
    }
  });

  it("builds a fixed path of story rooms", () => {
    const map = generateWithRetries(seededRng(3), {
      path: ["burghof", "turnierplatz", "waldweg", "bruecke", "verbranntes_dorf", "hoehlenstollen", "drachenhort"],
    });
    expect(map.rooms.map((r) => r.moduleId)).toEqual(["burghof", "turnierplatz", "waldweg", "bruecke", "verbranntes_dorf", "hoehlenstollen", "drachenhort"]);
    expect(map.rooms[6]!.spots.boss).toHaveLength(1);
  });

  it("never lets rooms overlap", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = seededRng(seed);
      const map = generateWithRetries(rng, randomPlan(rng, 7, 2));
      for (const a of map.rooms) {
        for (const b of map.rooms) {
          if (a === b) continue;
          const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          expect(overlap, `seed ${seed}: ${a.id} / ${b.id}`).toBe(false);
        }
      }
    }
  });

  it("reveals a room when a hero enters it", () => {
    const map = generateDungeon(seededRng(5), { path: ["burghof", "gang_gerade"] });
    const start = map.rooms[0]!.spots.party[0]!;
    expect(map.explored[cellIndex(map, start.x, start.y)]).toBe(false);
    expect(revealAround(map, start)).toEqual([0]);
    expect(map.explored[cellIndex(map, start.x, start.y)]).toBe(true);
    const other = map.rooms[1]!;
    expect(map.explored[cellIndex(map, other.x + 2, other.y + 2)]).toBe(false);
    expect(revealAround(map, start)).toEqual([]);
  });
});
