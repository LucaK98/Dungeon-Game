import { describe, expect, it } from "vitest";
import type { DungeonMap } from "../shared/map";
import { gridPath } from "./walk-path";

/** A tiny map: # wall, . floor. */
function map(rows: string[]): DungeonMap {
  const width = rows[0]!.length;
  return { width, height: rows.length, cells: rows.join("").split("").map((c) => (c === "#" ? "wall" : "floor")), objects: [] } as unknown as DungeonMap;
}

describe("walking on the TV", () => {
  it("goes square by square and around walls, never through them", () => {
    const m = map(["#######", "#..#..#", "#..#..#", "#.....#", "#######"]);
    const path = gridPath(m, { x: 1, y: 1 }, { x: 5, y: 1 })!;
    expect(path.at(-1)).toEqual({ x: 5, y: 1 });
    expect(path.some((p) => p.x === 3 && p.y < 3)).toBe(false);
    for (let i = 1; i < path.length; i++) expect(Math.max(Math.abs(path[i]!.x - path[i - 1]!.x), Math.abs(path[i]!.y - path[i - 1]!.y))).toBe(1);
  });

  it("no way there (or too far): no path", () => {
    const m = map(["#####", "#.#.#", "#####"]);
    expect(gridPath(m, { x: 1, y: 1 }, { x: 3, y: 1 })).toBeUndefined();
    expect(gridPath(m, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });
});
