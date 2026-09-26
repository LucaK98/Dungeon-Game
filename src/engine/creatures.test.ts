import { describe, expect, it } from "vitest";
import { sumParts } from "./core";
import { createMonster, PLAYABLE_CLASSES, pregenCharacter } from "./creatures";
import { SRD } from "./data";

describe("characters", () => {
  it("builds the fighter pregen by the rules", () => {
    const c = pregenCharacter("fighter");
    expect(c.abilities).toEqual({ STR: 16, CON: 15, DEX: 14, WIS: 13, CHA: 11, INT: 9 });
    expect(c.maxHp).toBe(12); // d10 + CON 2
    expect(sumParts(c.baseAc)).toBe(19); // chain mail 16 + shield 2 + defense 1
    const sword = c.attacks.find((a) => a.id === "longsword")!;
    expect(sumParts(sword.toHit)).toBe(5);
    expect(sword.damage[0]!.dice).toBe("1d8");
  });

  it("gives hill dwarves one extra hit point per level", () => {
    const c = pregenCharacter("cleric", 3);
    // CON 14 + 2 (dwarf) = 16 → +3: d8 + 3 at level 1, 5 + 3 per further level, +3 dwarven toughness
    expect(c.maxHp).toBe(11 + 8 + 8 + 3);
  });

  it("builds every class on every level", () => {
    for (const cls of PLAYABLE_CLASSES) {
      for (const level of [1, 2, 3]) {
        const c = pregenCharacter(cls, level);
        expect(c.maxHp).toBeGreaterThan(0);
        expect(c.attacks.length).toBeGreaterThan(0);
        expect(c.pc!.level).toBe(level);
      }
    }
  });

  it("gives spell slots only to casters", () => {
    expect(pregenCharacter("wizard", 1).pc!.spellSlots).toEqual([2]);
    expect(pregenCharacter("wizard", 3).pc!.spellSlots).toEqual([4, 2]);
    expect(pregenCharacter("paladin", 1).pc!.spellSlots).toEqual([]);
    expect(pregenCharacter("paladin", 2).pc!.spellSlots).toEqual([2]);
    expect(pregenCharacter("fighter", 3).pc!.spellSlots).toEqual([]);
  });

  it("uses dexterity for finesse weapons", () => {
    const rogue = pregenCharacter("rogue");
    const rapier = rogue.attacks.find((a) => a.id === "rapier")!;
    expect(rapier.toHit[0]!.label).toBe("Geschicklichkeit");
  });

  it("can create every imported monster", () => {
    for (const m of SRD.monsters) {
      const c = createMonster(m.id, m.id);
      expect(c.hp).toBe(m.hp);
      expect(c.attacks.length + c.saveActions.length).toBeGreaterThan(0);
    }
  });
});
