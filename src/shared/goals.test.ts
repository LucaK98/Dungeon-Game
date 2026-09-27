import { describe, expect, it } from "vitest";
import { assignGoals, goalById, goalReached, SECRET_GOALS } from "./goals";
import { emptyStats } from "./recap";
import { glossarEntry } from "../data/help/glossar";

describe("secret goals", () => {
  it("gives every hero a different goal that fits the class", () => {
    let n = 0;
    const heroes = ["fighter", "wizard", "rogue", "cleric", "paladin", "fighter"].map((classId, i) => ({ id: `h${i}`, classId }));
    const goals = assignGoals(heroes, (len) => n++ % len);
    expect(Object.keys(goals)).toHaveLength(6);
    expect(new Set(Object.values(goals)).size).toBe(6);
    for (const h of heroes) {
      const g = goalById(goals[h.id]!)!;
      expect(!g.classes || g.classes.includes(h.classId)).toBe(true);
    }
  });

  it("are reached from the numbers the TV collects", () => {
    const s = emptyStats();
    expect(goalReached(goalById("jaeger")!, s)).toBe(false);
    s.kills = 3;
    expect(goalReached(goalById("jaeger")!, s)).toBe(true);
    expect(goalReached(goalById("standhaft")!, s)).toBe(true);
    s.downs = 1;
    expect(goalReached(goalById("standhaft")!, s)).toBe(false);
    s.chests = 2;
    expect(goalReached(goalById("truhen")!, s)).toBe(true);
  });

  it("have unique ids and the tips exist in the glossary", () => {
    expect(new Set(SECRET_GOALS.map((g) => g.id)).size).toBe(SECRET_GOALS.length);
    expect(glossarEntry("geheimes_ziel")).toBeDefined();
    expect(glossarEntry("rast")).toBeDefined();
  });
});
