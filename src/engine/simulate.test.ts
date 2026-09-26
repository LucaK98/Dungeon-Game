import { describe, expect, it } from "vitest";
import { seededRng } from "./rng";
import { simulateBattle } from "./simulate";

describe("simulated combat", () => {
  it("plays a whole fight against three goblins to the end", () => {
    const r = simulateBattle(seededRng(42), { heroes: ["fighter", "paladin", "wizard", "rogue"], enemies: ["goblin", "goblin", "goblin"] });
    expect(r.winner).toBeDefined();
    expect(r.log.flatMap((b) => b.lines).some((l) => /gegen RK \d+ → /.test(l.text))).toBe(true);
  });

  it("is reproducible with the same seed", () => {
    const setup = { heroes: ["fighter", "cleric"], enemies: ["ogre"], level: 2 };
    const a = simulateBattle(seededRng(7), setup);
    const b = simulateBattle(seededRng(7), setup);
    expect(a.log).toEqual(b.log);
  });

  it("finishes many random fights without errors", () => {
    const monsters = ["goblin", "wolf", "kobold", "skeleton", "zombie", "bandit", "giant-rat", "cultist", "ghoul", "thug"];
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seededRng(seed);
      const enemies = Array.from({ length: 1 + (seed % 4) }, (_, i) => monsters[(seed * 3 + i) % monsters.length]!);
      const r = simulateBattle(rng, { heroes: ["fighter", "wizard", "rogue", "cleric", "paladin"].slice(0, 1 + (seed % 4)), enemies, level: 1 + (seed % 3) });
      expect(r.winner, `seed ${seed}`).toBeDefined();
    }
  });
});
