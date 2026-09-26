import { describe, expect, it } from "vitest";
import { resolveAttack, rollDamage } from "./attack";
import { createMonster, pregenCharacter } from "./creatures";
import { scriptedRng } from "./rng";
import { battleOf } from "./testing";

const sword = (c: ReturnType<typeof pregenCharacter>) => c.attacks.find((a) => a.id === "longsword")!;

describe("attacks", () => {
  it("hits when the total reaches the armour class", () => {
    const fighter = pregenCharacter("fighter");
    const goblin = createMonster("goblin", "g");
    const battle = battleOf([fighter, 0, 0], [goblin, 1, 0]);
    // 10 + 3 + 2 = 15 vs AC 15 → hit; damage 4 + 3
    const r = resolveAttack(scriptedRng([10, 4]), battle, fighter, goblin, sword(fighter));
    expect(r.total).toBe(15);
    expect(r.targetAc).toBe(15);
    expect(r.hit).toBe(true);
    expect(r.damage!.total).toBe(7);
    expect(goblin.dead).toBe(true);
  });

  it("misses on a natural 1 and always hits on a natural 20", () => {
    const fighter = pregenCharacter("fighter");
    const knight = createMonster("knight", "k");
    const battle = battleOf([fighter, 0, 0], [knight, 1, 0]);
    expect(resolveAttack(scriptedRng([1]), battle, fighter, knight, sword(fighter)).hit).toBe(false);
    const crit = resolveAttack(scriptedRng([20, 3, 5]), battle, fighter, knight, sword(fighter));
    expect(crit.hit && crit.crit).toBe(true);
    // two d8 on a crit, modifier only once
    expect(crit.damage!.lines[0]!.dice).toEqual([3, 5]);
    expect(crit.damage!.total).toBe(3 + 5 + 3);
  });

  it("crits on 19 with improved critical (fighter level 3)", () => {
    const fighter = pregenCharacter("fighter", 3);
    const ogre = createMonster("ogre", "o");
    const battle = battleOf([fighter, 0, 0], [ogre, 1, 0]);
    expect(resolveAttack(scriptedRng([19, 1, 1]), battle, fighter, ogre, sword(fighter)).crit).toBe(true);
  });

  it("gives pack tactics advantage when an ally stands next to the target", () => {
    const fighter = pregenCharacter("fighter");
    const w1 = createMonster("wolf", "w1");
    const w2 = createMonster("wolf", "w2");
    const battle = battleOf([fighter, 5, 5], [w1, 6, 5], [w2, 4, 5]);
    const r = resolveAttack(scriptedRng([3, 18, 1, 1]), battle, w1, fighter, w1.attacks[0]!);
    expect(r.roll.mode).toBe("advantage");
    expect(r.roll.natural).toBe(18);
    expect(r.roll.reasons.some((x) => x.glossarKey === "monstermerkmal:pack-tactics")).toBe(true);
  });

  it("gives disadvantage to ranged attacks with an enemy next to you", () => {
    const rogue = pregenCharacter("rogue");
    const g1 = createMonster("goblin", "g1");
    const g2 = createMonster("goblin", "g2");
    const battle = battleOf([rogue, 0, 0], [g1, 1, 0], [g2, 6, 0]);
    const bow = rogue.attacks.find((a) => a.id === "shortbow")!;
    expect(resolveAttack(scriptedRng([15, 2]), battle, rogue, g2, bow).roll.mode).toBe("disadvantage");
  });

  it("adds sneak attack when an ally is next to the target", () => {
    const rogue = pregenCharacter("rogue");
    const fighter = pregenCharacter("fighter");
    const ogre = createMonster("ogre", "o");
    const battle = battleOf([rogue, 0, 0], [ogre, 5, 0], [fighter, 6, 0]);
    const bow = rogue.attacks.find((a) => a.id === "shortbow")!;
    const r = resolveAttack(scriptedRng([15, 4, 6]), battle, rogue, ogre, bow);
    expect(r.damage!.lines.map((l) => l.raw)).toEqual([4 + 3, 6]);
  });

  it("halves damage on resistance and ignores immune damage", () => {
    const swarm = createMonster("swarm-of-rats", "s");
    const d = rollDamage(scriptedRng([8]), { parts: [{ dice: "1d8", type: "slashing" }], bonus: [{ label: "Stärke", value: 3 }] }, swarm);
    expect(d.lines[0]!.raw).toBe(11);
    expect(d.total).toBe(5);
    const dragon = createMonster("red-dragon-wyrmling", "d");
    expect(rollDamage(scriptedRng([10]), { parts: [{ dice: "1d10", type: "fire" }], magical: true }, dragon).total).toBe(0);
  });

  it("lets magic weapons ignore the werewolf's protection", () => {
    const wolf = createMonster("werewolf-hybrid", "w");
    expect(rollDamage(scriptedRng([6]), { parts: [{ dice: "1d8", type: "slashing" }] }, wolf).total).toBe(0);
    expect(rollDamage(scriptedRng([6]), { parts: [{ dice: "1d8", type: "slashing" }], magical: true }, wolf).total).toBe(6);
  });

  it("smites with a spell slot for extra radiant damage", () => {
    const paladin = pregenCharacter("paladin", 2);
    const skeleton = createMonster("skeleton", "s");
    const battle = battleOf([paladin, 0, 0], [skeleton, 1, 0]);
    // hit, d8 weapon, 3d8 smite vs undead
    const r = resolveAttack(scriptedRng([15, 1, 1, 1, 1]), battle, paladin, skeleton, sword(paladin), { smiteSlot: 1 });
    expect(r.damage!.lines[1]!.type).toBe("radiant");
    expect(r.damage!.lines[1]!.dice).toHaveLength(3);
  });

  it("auto-crits an unconscious target from up close", () => {
    const fighter = pregenCharacter("fighter");
    const goblin = createMonster("goblin", "g");
    goblin.conditions.push({ id: "unconscious" });
    const battle = battleOf([fighter, 0, 0], [goblin, 1, 0]);
    const r = resolveAttack(scriptedRng([2, 12, 1, 1]), battle, fighter, goblin, sword(fighter));
    expect(r.roll.mode).toBe("advantage");
    expect(r.crit).toBe(true);
  });
});
