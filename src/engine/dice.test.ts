import { describe, expect, it } from "vitest";
import { averageOf, parseDice, rollDice } from "./dice";
import { scriptedRng, seededRng } from "./rng";

describe("dice", () => {
  it("parses dice expressions", () => {
    expect(parseDice("2d6+3")).toEqual({ terms: [{ count: 2, sides: 6 }], flat: 3 });
    expect(parseDice("1d8 + MOD", 3)).toEqual({ terms: [{ count: 1, sides: 8 }], flat: 3 });
    expect(parseDice("1d4-1")).toEqual({ terms: [{ count: 1, sides: 4 }], flat: -1 });
    expect(parseDice("5")).toEqual({ terms: [], flat: 5 });
    expect(parseDice("d20")).toEqual({ terms: [{ count: 1, sides: 20 }], flat: 0 });
    expect(() => parseDice("zwei Würfel")).toThrow();
  });

  it("rolls and doubles dice on crits", () => {
    const r = rollDice(scriptedRng([3, 5, 2, 6]), parseDice("2d6+1"), 2);
    expect(r.dice).toEqual([3, 5, 2, 6]);
    expect(r.total).toBe(17);
  });

  it("stays within bounds", () => {
    const rng = seededRng(99);
    for (let i = 0; i < 500; i++) {
      const v = rollDice(rng, parseDice("1d20")).total;
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it("computes averages", () => {
    expect(averageOf("1d8+3")).toBe(7);
    expect(averageOf("2d6")).toBe(7);
  });

  it("is reproducible with the same seed", () => {
    const a = seededRng(5);
    const b = seededRng(5);
    expect([a.int(1, 20), a.int(1, 20), a.int(1, 20)]).toEqual([b.int(1, 20), b.int(1, 20), b.int(1, 20)]);
  });
});
