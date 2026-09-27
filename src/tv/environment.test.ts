import { describe, expect, it } from "vitest";
import { createMonster } from "../engine/creatures";
import { seededRng } from "../engine/rng";
import { cellIndex, type DungeonMap, type MapObject } from "../shared/map";
import { burnCreature, coldHits, fireHits, slipOnIce, tickWorldSurface } from "./environment";

function room(objects: Omit<MapObject, "id">[] = []): DungeonMap {
  const width = 8;
  const height = 6;
  return {
    width,
    height,
    cells: Array(width * height).fill("floor"),
    frames: Array(width * height).fill("floor.castle.0"),
    overlays: {},
    roomOf: Array(width * height).fill(0),
    rooms: [],
    objects: objects.map((o, i) => ({ id: `o${i}`, ...o })),
    explored: Array(width * height).fill(true),
    surface: {},
    decals: {},
  };
}

describe("the room reacts", () => {
  it("fire lights webs and oil, burns furniture to debris and spreads", () => {
    const map = room([
      { kind: "prop", prop: "web", x: 2, y: 2, frame: "web", blocking: false },
      { kind: "prop", prop: "hay", x: 3, y: 2, frame: "hay", blocking: false },
      { kind: "prop", prop: "table", x: 6, y: 2, frame: "table", blocking: true },
    ]);
    map.surface![cellIndex(map, 2, 3)] = { kind: "oil" };
    const r = fireHits(map, seededRng(1), [{ x: 2, y: 2 }]);
    expect(r.lines.length).toBeGreaterThan(0);
    expect(map.surface![cellIndex(map, 2, 2)]?.kind).toBe("fire");
    expect(map.surface![cellIndex(map, 2, 3)]?.kind).toBe("fire");
    expect(map.objects[0]!.state).toBe("used");
    // Fire burns out and leaves scorch marks; the far table catches only if the fire reaches it.
    for (let i = 0; i < 12; i++) tickWorldSurface(map, seededRng(i));
    expect(Object.values(map.surface!).some((s) => s.kind === "fire")).toBe(false);
    expect(map.decals![cellIndex(map, 2, 2)]).toBe("scorch");
  });

  it("frost freezes puddles and puts out fire", () => {
    const map = room();
    map.surface![cellIndex(map, 4, 4)] = { kind: "puddle" };
    map.surface![cellIndex(map, 1, 1)] = { kind: "fire", turns: 3 };
    coldHits(map, [{ x: 4, y: 3 }, { x: 1, y: 1 }]);
    expect(map.surface![cellIndex(map, 4, 4)]?.kind).toBe("ice");
    expect(map.surface![cellIndex(map, 1, 1)]).toBeUndefined();
    // Ice melts back to a puddle.
    for (let i = 0; i < 10; i++) tickWorldSurface(map, seededRng(i));
    expect(map.surface![cellIndex(map, 4, 4)]?.kind).toBe("puddle");
  });

  it("burns whoever stands in the fire and lets them slip on ice", () => {
    const g = createMonster("ogre", "o");
    const before = g.hp;
    const r = burnCreature(seededRng(3), g);
    expect(g.hp).toBeLessThan(before);
    expect(r.hits[0]!.amount).toBe(before - g.hp);
    let fell = 0;
    for (let s = 0; s < 30; s++) {
      const k = createMonster("kobold", `k${s}`);
      slipOnIce(seededRng(s), k, 15);
      if (k.conditions.some((c) => c.id === "prone")) fell++;
    }
    expect(fell).toBeGreaterThan(0);
    expect(fell).toBeLessThan(30);
  });
});
