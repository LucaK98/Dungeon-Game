import { describe, expect, it } from "vitest";
import { seededRng } from "../engine/rng";
import { cellIndex } from "../shared/map";
import { generateWithRetries, randomPlan } from "./generate";
import { MODULES } from "./modules";
import { isWalkable, reachable } from "./walk";

describe("things to play with on the map", () => {
  it("never blocks a way: every free square stays reachable", () => {
    let placed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = seededRng(seed);
      const map = generateWithRetries(rng, randomPlan(rng, 6, 1));
      placed += map.objects.filter((o) => ["barrel", "campfire", "cauldron", "chandelier", "lever", "secret"].includes(o.kind)).length;
      const start = map.rooms[0]!.spots.party[0]!;
      const seen = reachable(map, start);
      for (let i = 0; i < map.cells.length; i++) {
        const p = { x: i % map.width, y: Math.floor(i / map.width) };
        // Squares behind closed doors count as reachable once the door opens: treat doors as open.
        if (!isWalkable(map, p)) continue;
        if (!seen.has(i)) {
          const doorsOpen = { ...map, objects: map.objects.map((o) => (o.kind === "door" ? { ...o, blocking: false } : o)) };
          expect(reachable(doorsOpen, start).has(i), `seed ${seed}: square ${p.x},${p.y} cut off`).toBe(true);
        }
      }
    }
    expect(placed).toBeGreaterThan(40);
  });

  it("puts every kind somewhere, fitting the place", () => {
    const kinds = new Set<string>();
    const rooms = MODULES.map((m) => m.id);
    for (let seed = 1; seed <= 80; seed++) {
      const rng = seededRng(seed);
      const pick = [rooms[seed % rooms.length]!, rooms[(seed * 7) % rooms.length]!, "kraeuterhuette", "thronsaal", "waldweg"];
      let map;
      try {
        map = generateWithRetries(rng, { path: [...new Set(pick)] });
      } catch {
        continue;
      }
      for (const o of map.objects) {
        kinds.add(o.kind);
        const room = map.rooms.find((r) => r.id === o.roomId);
        if (o.kind === "campfire") expect(["forest", "meadow", "peak"]).toContain(room?.theme);
        if (o.kind === "secret" && o.variant === "runes") expect(map.cells[cellIndex(map, o.x, o.y)]).toBe("wall");
        if (o.kind === "lever") expect(["cache", "trap", "door"]).toContain(o.variant);
      }
    }
    for (const k of ["barrel", "chandelier", "lever", "secret", "campfire", "cauldron"]) expect(kinds.has(k), k).toBe(true);
  });
});
