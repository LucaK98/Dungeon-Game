import { describe, expect, it } from "vitest";
import { createCharacter } from "../engine/creatures";
import { levelGains } from "./reward";

describe("levelGains", () => {
  it("lists what got better, with before and after", () => {
    const before = createCharacter({ id: "a", name: "Mira", classId: "wizard", raceId: "elf", level: 1 });
    const after = createCharacter({ id: "a", name: "Mira", classId: "wizard", raceId: "elf", level: 2 });
    const g = levelGains(before, after);
    const hp = g.gains.find((x) => x.label === "Trefferpunkte")!;
    expect(Number(hp.to)).toBeGreaterThan(Number(hp.from));
    expect(g.gains.some((x) => x.label === "Zauberplätze")).toBe(true);
    expect(g.gains.every((x) => x.from !== x.to)).toBe(true);
  });

  it("names new features", () => {
    const before = createCharacter({ id: "b", name: "Pip", classId: "rogue", raceId: "halfling", level: 1 });
    const after = createCharacter({ id: "b", name: "Pip", classId: "rogue", raceId: "halfling", level: 2 });
    expect(levelGains(before, after).features.length).toBeGreaterThan(0);
  });
});
