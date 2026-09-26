import { describe, expect, it } from "vitest";
import { perform } from "./actions";
import { startCombat } from "./combat";
import { createMonster, pregenCharacter } from "./creatures";
import { castSpell, validateCast } from "./spells";
import { scriptedRng, seededRng } from "./rng";
import { battleOf } from "./testing";

describe("spells", () => {
  it("magic missile always hits and uses a slot", () => {
    const w = pregenCharacter("wizard");
    const g = createMonster("goblin", "g");
    const battle = battleOf([w, 0, 0], [g, 5, 0]);
    const r = castSpell(scriptedRng([1, 1, 1]), battle, w, { spellId: "magic-missile", targetIds: ["g", "g", "g"] });
    expect(r.targets[0]!.damage!.total).toBe(2);
    expect(w.pc!.spellSlots).toEqual([1]);
    expect(g.hp).toBe(1);
  });

  it("fire bolt is a spell attack with intelligence", () => {
    const w = pregenCharacter("wizard"); // INT 15 + 1 (elf) = 16
    const g = createMonster("goblin", "g");
    const battle = battleOf([w, 0, 0], [g, 10, 0]);
    const r = castSpell(scriptedRng([10, 5]), battle, w, { spellId: "fire-bolt", targetIds: ["g"] });
    const attack = r.targets[0]!.attack!;
    expect(attack.total).toBe(10 + 3 + 2);
    expect(attack.hit).toBe(true);
    expect(w.pc!.spellSlots).toEqual([2]);
  });

  it("burning hands halves damage on a successful save", () => {
    const w = pregenCharacter("wizard");
    const a = createMonster("ogre", "a");
    const b = createMonster("ogre", "b");
    const battle = battleOf([w, 0, 0], [a, 1, 0], [b, 1, 1]);
    // damage 6+6+6 = 18, ogre a saves (20), ogre b fails (1)
    const r = castSpell(scriptedRng([6, 6, 6, 20, 1]), battle, w, { spellId: "burning-hands", targetIds: ["a", "b"] });
    expect(r.dc!.value).toBe(13);
    expect(r.targets.map((t) => t.damage!.total)).toEqual([9, 18]);
  });

  it("sleep puts the weakest creatures to sleep first and skips undead", () => {
    const w = pregenCharacter("wizard");
    const g1 = createMonster("goblin", "g1");
    const g2 = createMonster("goblin", "g2");
    const sk = createMonster("skeleton", "s");
    const battle = battleOf([w, 0, 0], [g1, 5, 0], [g2, 5, 1], [sk, 5, 2]);
    const r = castSpell(scriptedRng([2, 2, 2, 2, 2]), battle, w, { spellId: "sleep", targetIds: ["g1", "g2", "s"] });
    expect(r.pool!.total).toBe(10);
    expect(g1.conditions.map((c) => c.id)).toContain("unconscious");
    expect(g2.conditions.map((c) => c.id)).not.toContain("unconscious"); // 7 + 7 > 10
    expect(r.targets.find((t) => t.targetId === "s")!.unaffected).toBeDefined();
  });

  it("life clerics heal extra", () => {
    const c = pregenCharacter("cleric");
    const f = pregenCharacter("fighter");
    f.hp = 1;
    const battle = battleOf([c, 0, 0], [f, 1, 0]);
    const r = castSpell(scriptedRng([4]), battle, c, { spellId: "cure-wounds", targetIds: [f.id] });
    // 4 (d8) + 3 (WIS 16) + 3 (disciple of life)
    expect(r.targets[0]!.heal!.total).toBe(10);
    expect(f.hp).toBe(11);
  });

  it("bless adds a d4 and ends when concentration breaks", () => {
    const c = pregenCharacter("cleric");
    const f = pregenCharacter("fighter");
    const battle = battleOf([c, 0, 0], [f, 1, 0]);
    castSpell(seededRng(1), battle, c, { spellId: "bless", targetIds: [c.id, f.id] });
    expect(f.effects.map((e) => e.id)).toContain("bless");
    expect(c.concentration).toBe("bless");
    castSpell(seededRng(1), battle, c, { spellId: "shield-of-faith", targetIds: [f.id] });
    expect(f.effects.map((e) => e.id)).not.toContain("bless");
    expect(f.effects.map((e) => e.id)).toContain("shield-of-faith");
  });

  it("validates slots, range and known spells", () => {
    const w = pregenCharacter("wizard");
    const g = createMonster("goblin", "g");
    const battle = battleOf([w, 0, 0], [g, 50, 0]);
    expect(validateCast(battle, w, { spellId: "cure-wounds", targetIds: ["g"] })).toMatch(/kennst/);
    expect(validateCast(battle, w, { spellId: "fire-bolt", targetIds: ["g"] })).toMatch(/weit/);
    w.pc!.spellSlots = [0];
    g.pos = { x: 3, y: 0 };
    expect(validateCast(battle, w, { spellId: "magic-missile", targetIds: ["g"] })).toMatch(/Zauberplatz/);
  });

  it("healing word is a bonus action", () => {
    const c = pregenCharacter("cleric");
    const g = createMonster("goblin", "g");
    const battle = battleOf([c, 0, 0], [g, 1, 0]);
    startCombat(scriptedRng([20, 1]), battle);
    expect(perform(seededRng(1), battle, c.id, { type: "cast", spellId: "healing-word", targetIds: [c.id] }).ok).toBe(true);
    expect(perform(seededRng(1), battle, c.id, { type: "attack", targetId: "g", optionId: "mace" }).ok).toBe(true);
    expect(perform(seededRng(1), battle, c.id, { type: "attack", targetId: "g", optionId: "mace" }).ok).toBe(false);
  });
});
