/**
 * Class check: four heroes of one class against a pack of goblins and wolves (level 1) – no class
 * may fall far behind (druid and monk were at about 20 % before Shillelagh and the fighting stance).
 */
import { describe, expect, it } from "vitest";
import { seededRng } from "./rng";
import { simulateBattle } from "./simulate";

const winRate = (cls: string, seeds = 40) => {
  let wins = 0;
  for (let s = 1; s <= seeds; s++) if (simulateBattle(seededRng(s * 97 + 1), { heroes: [cls, cls, cls, cls], enemies: ["goblin", "goblin", "goblin", "goblin", "wolf", "wolf"], level: 1, potions: 1 }).winner === "party") wins++;
  return wins / seeds;
};

describe("class check", () => {
  it("no class falls far behind at level 1", () => {
    for (const cls of ["fighter", "cleric", "wizard", "rogue", "ranger", "bard", "druid", "monk"]) expect(winRate(cls), cls).toBeGreaterThanOrEqual(0.25);
  }, 120_000);
});
