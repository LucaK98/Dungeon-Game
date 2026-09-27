import { describe, expect, it } from "vitest";
import { perform } from "./actions";
import { resolveAttack } from "./attack";
import { armorClass, startCombat } from "./combat";
import { skillParts, sumParts } from "./core";
import { createMonster, pregenCharacter } from "./creatures";
import { scriptedRng, seededRng } from "./rng";
import { simulateBattle } from "./simulate";
import { castSpell } from "./spells";
import { battleOf } from "./testing";

describe("new classes", () => {
  it("bard: inspiration gives a friend advantage, jack of all trades helps untrained checks", () => {
    const bard = pregenCharacter("bard", 2, "b");
    const friend = pregenCharacter("fighter", 2, "f");
    const g = createMonster("goblin", "g");
    const battle = battleOf([bard, 0, 0], [friend, 1, 0], [g, 3, 0]);
    startCombat(scriptedRng([20, 1, 1]), battle);
    const out = perform(seededRng(1), battle, "b", { type: "bardic-inspiration", targetId: "f" });
    expect(out.ok).toBe(true);
    expect(friend.effects.some((e) => e.id === "helped")).toBe(true);
    expect(skillParts(bard, "athletics").some((p) => p.label === "Alleskönner")).toBe(true);
  });

  it("vicious mockery hurts and spoils the next attack", () => {
    const bard = pregenCharacter("bard", 1, "b");
    const g = createMonster("goblin", "g");
    const battle = battleOf([bard, 0, 0], [g, 3, 0]);
    const res = castSpell(scriptedRng([1, 4]), battle, bard, { spellId: "vicious-mockery", targetIds: ["g"] });
    expect(res.targets[0]!.applied).toBe("hampered");
  });

  it("druid: wolf shape adds the wolf's hit points and a bite, and ends when they are gone", () => {
    const d = pregenCharacter("druid", 2, "d");
    const g = createMonster("ogre", "o");
    const battle = battleOf([d, 0, 0], [g, 1, 0]);
    startCombat(scriptedRng([20, 1]), battle);
    expect(perform(seededRng(1), battle, "d", { type: "wild-shape" }).ok).toBe(true);
    expect(d.tempHp).toBe(11);
    expect(d.attacks.some((a) => a.id === "wolf-bite")).toBe(true);
    expect(perform(seededRng(1), battle, "d", { type: "cast", spellId: "produce-flame", targetIds: ["o"] }).ok).toBe(false);
    const club = g.attacks[0]!;
    resolveAttack(scriptedRng([19, 6, 6]), battle, g, d, club);
    expect(d.effects.some((e) => e.id === "wild-shape")).toBe(false);
    expect(d.attacks.some((a) => a.id === "wolf-bite")).toBe(false);
  });

  it("monk: AC without armour, fists with dex, flurry of blows after attacking, stunning strike at level 5", () => {
    const m = pregenCharacter("monk", 5, "m");
    const dex = Math.floor((m.abilities.DEX - 10) / 2);
    const wis = Math.floor((m.abilities.WIS - 10) / 2);
    expect(armorClass(m)).toBe(10 + dex + wis);
    const ogre = createMonster("ogre", "o");
    const battle = battleOf([m, 0, 0], [ogre, 1, 0]);
    startCombat(scriptedRng([20, 1]), battle);
    expect(perform(scriptedRng([1]), battle, "m", { type: "flurry-of-blows", targetId: "o" }).ok).toBe(false);
    const stun = perform(scriptedRng([15, 3, 1]), battle, "m", { type: "attack", targetId: "o", optionId: "unarmed", stun: true });
    expect(stun.ok && stun.kind === "attack" && stun.attack.stun?.stunned).toBe(true);
    expect(ogre.conditions.some((c) => c.id === "stunned")).toBe(true);
    const flurry = perform(seededRng(5), battle, "m", { type: "flurry-of-blows", targetId: "o" });
    expect(flurry.ok && flurry.kind === "strikes" && flurry.attacks.length).toBe(2);
    expect(m.pc!.resources["ki"]!.used).toBe(2);
  });

  it("monk level 3 deflects arrows", () => {
    const m = pregenCharacter("monk", 3, "m");
    const archer = createMonster("goblin", "g");
    const battle = battleOf([m, 0, 0], [archer, 4, 0]);
    startCombat(scriptedRng([20, 1]), battle);
    const bow = archer.attacks.find((a) => a.kind === "ranged")!;
    const r = resolveAttack(scriptedRng([19, 6, 10]), battle, archer, m, bow);
    expect(r.hit).toBe(true);
    expect(r.deflected).toBeGreaterThan(0);
  });

  it("ranger: archery style, hunter's mark and colossus slayer", () => {
    const r = pregenCharacter("ranger", 3, "r");
    const bow = r.attacks.find((a) => a.id === "longbow")!;
    expect(bow.toHit.some((p) => p.label === "Bogenschießen")).toBe(true);
    const ogre = createMonster("ogre", "o");
    const battle = battleOf([r, 0, 0], [ogre, 6, 0]);
    startCombat(scriptedRng([20, 1]), battle);
    castSpell(seededRng(1), battle, r, { spellId: "hunters-mark", targetIds: ["o"] });
    expect(ogre.effects.some((e) => e.id === "hunters-mark")).toBe(true);
    ogre.hp -= 5;
    const hit = resolveAttack(scriptedRng([15, 4, 3, 5]), battle, r, ogre, bow);
    expect(hit.damage!.lines.length).toBeGreaterThanOrEqual(3);
  });

  it("every party with the new classes can fight a whole battle on every level", () => {
    for (const level of [1, 2, 3, 4, 5]) {
      for (let seed = 1; seed <= 3; seed++) {
        const r = simulateBattle(seededRng(seed * 31 + level), { heroes: ["bard", "ranger", "druid", "monk"], enemies: ["goblin", "goblin", "wolf", "kobold"], level });
        expect(r.winner, `level ${level} seed ${seed}`).toBeDefined();
      }
    }
    // Hit points and saves stay sensible.
    for (const cls of ["bard", "ranger", "druid", "monk"]) {
      const c = pregenCharacter(cls, 5);
      expect(c.maxHp).toBeGreaterThan(20);
      expect(sumParts(skillParts(c, "perception"))).toBeGreaterThanOrEqual(0);
    }
  });
});
