import { describe, expect, it } from "vitest";
import { seededRng } from "./rng";
import { simulateBattle, type SimulationSetup } from "./simulate";
import type { Element } from "./types";

/** Many bot fights: how often the heroes win and how much life they keep. */
function measure(setup: SimulationSetup, seeds = 80) {
  let wins = 0;
  let hpLeft = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = simulateBattle(seededRng(seed * 7919), setup);
    const heroes = Object.values(r.battle.creatures).filter((c) => c.side === "party");
    if (r.winner === "party") wins++;
    hpLeft += heroes.reduce((s, h) => s + h.hp, 0) / heroes.reduce((s, h) => s + h.maxHp, 0);
  }
  return { win: wins / seeds, hp: hpLeft / seeds };
}

describe("balancing: elemental variants stay fair", () => {
  const fights: [string[], string[], Element[]][] = [
    [["fighter", "wizard", "rogue"], ["goblin", "goblin", "goblin"], ["fire", "swamp"]],
    [["fighter", "cleric", "ranger"], ["skeleton", "skeleton"], ["frost", "fire"]],
    [["paladin", "wizard", "rogue"], ["kobold", "kobold", "kobold", "kobold"], ["fire", "storm"]],
    [["fighter", "cleric", "wizard"], ["wolf", "wolf"], ["frost", "storm"]],
  ];
  for (const [heroes, enemies, elements] of fights) {
    it(`${heroes.join("+")} gegen ${enemies.join("+")}`, () => {
      const base = measure({ heroes, enemies });
      for (const element of elements) {
        const v = measure({ heroes, enemies, element });
        // A bit harder, never a different fight: at most 15 points fewer wins, 15 points less life left.
        expect(v.win, `${element}: ${v.win} vs ${base.win}`).toBeGreaterThanOrEqual(base.win - 0.15);
        expect(v.hp, `${element}: ${v.hp} vs ${base.hp}`).toBeGreaterThanOrEqual(base.hp - 0.15);
      }
    });
  }
});
