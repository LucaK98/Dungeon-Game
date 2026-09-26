import { describe, expect, it } from "vitest";
import { abilityMod, advantage, disadvantage, proficiencyBonusForLevel, rollD20, savingThrow, skillCheck } from "./core";
import { createMonster, pregenCharacter } from "./creatures";
import { scriptedRng } from "./rng";

describe("core rules", () => {
  it("computes ability modifiers", () => {
    expect([8, 9, 10, 11, 12, 15, 16, 20].map(abilityMod)).toEqual([-1, -1, 0, 0, 1, 2, 3, 5]);
  });

  it("uses +2 proficiency on levels 1–4", () => {
    expect([1, 2, 3, 4, 5].map(proficiencyBonusForLevel)).toEqual([2, 2, 2, 2, 3]);
  });

  it("takes the higher die with advantage and the lower with disadvantage", () => {
    expect(rollD20(scriptedRng([4, 17]), [advantage("x", "vorteil")]).natural).toBe(17);
    expect(rollD20(scriptedRng([4, 17]), [disadvantage("x", "nachteil")]).natural).toBe(4);
  });

  it("cancels advantage and disadvantage", () => {
    const r = rollD20(scriptedRng([9]), [advantage("a", "vorteil"), advantage("b", "vorteil"), disadvantage("c", "nachteil")]);
    expect(r.mode).toBe("normal");
    expect(r.rolls).toEqual([9]);
  });

  it("lets halflings reroll natural 1s", () => {
    expect(rollD20(scriptedRng([1, 12]), [], true).natural).toBe(12);
    expect(rollD20(scriptedRng([1, 12]), [], false).natural).toBe(1);
  });

  it("adds proficiency to skill checks with a breakdown", () => {
    const fighter = pregenCharacter("fighter"); // STR 16, athletics
    const r = skillCheck(scriptedRng([10]), fighter, "athletics", 15);
    expect(r.parts.map((p) => [p.label, p.value])).toEqual([
      ["Würfel", 10],
      ["Stärke", 3],
      ["Übung", 2],
    ]);
    expect(r.total).toBe(15);
    expect(r.success).toBe(true);
  });

  it("doubles proficiency with expertise", () => {
    const rogue = pregenCharacter("rogue");
    const r = skillCheck(scriptedRng([10]), rogue, "stealth", 10);
    expect(r.parts.find((p) => p.label === "Expertise")?.value).toBe(4);
  });

  it("uses stat block bonuses for monster saves", () => {
    const dragon = createMonster("red-dragon-wyrmling", "d");
    const r = savingThrow(scriptedRng([10]), dragon, "DEX", 13);
    expect(r.total).toBe(12); // DEX 10 (+0) + 2 from the stat block
  });

  it("gives disadvantage to heavy armour stealth", () => {
    const fighter = pregenCharacter("fighter");
    const r = skillCheck(scriptedRng([15, 3]), fighter, "stealth", 10);
    expect(r.roll.mode).toBe("disadvantage");
    expect(r.roll.natural).toBe(3);
  });
});
