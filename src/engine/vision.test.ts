import { describe, expect, it } from "vitest";
import { attackReasons, resolveAttack } from "./attack";
import { addEffect, heal } from "./combat";
import { createMonster, pregenCharacter } from "./creatures";
import { scriptedRng } from "./rng";
import { battleOf } from "./testing";
import { canSee, isLit } from "./vision";

describe("darkness and sight", () => {
  it("sees everything in normal scenes", () => {
    const fighter = pregenCharacter("fighter");
    const wolf = createMonster("wolf", "w");
    const battle = battleOf([fighter, 0, 0], [wolf, 8, 0]);
    expect(canSee(battle, fighter, wolf)).toBe(true);
  });

  it("gives disadvantage against unseen targets and advantage when unseen", () => {
    const fighter = pregenCharacter("fighter"); // human: no darkvision
    const wolf = createMonster("wolf", "w"); // no darkvision
    const battle = battleOf([fighter, 0, 0], [wolf, 1, 0]);
    battle.darkness = { lights: [] };
    const reasons = attackReasons(battle, fighter, wolf, fighter.attacks[0]!).map((r) => `${r.effect}:${r.glossarKey}`);
    expect(reasons).toContain("disadvantage:dunkelheit");
    expect(reasons).toContain("advantage:dunkelheit");
  });

  it("lights the area around a burning torch and map lights", () => {
    const fighter = pregenCharacter("fighter");
    const wolf = createMonster("wolf", "w");
    const battle = battleOf([fighter, 0, 0], [wolf, 3, 0]);
    battle.darkness = { lights: [{ x: 20, y: 20, radiusFt: 15 }] };
    expect(isLit(battle, { x: 3, y: 0 })).toBe(false);
    expect(isLit(battle, { x: 22, y: 20 })).toBe(true);
    addEffect(fighter, "torch", 600, fighter.id);
    expect(isLit(battle, { x: 3, y: 0 })).toBe(true);
    expect(canSee(battle, fighter, wolf)).toBe(true);
    expect(attackReasons(battle, fighter, wolf, fighter.attacks[0]!).some((r) => r.glossarKey === "dunkelheit")).toBe(false);
  });

  it("lets darkvision see in the dark up to its range", () => {
    const elf = pregenCharacter("wizard"); // elf: darkvision 60 ft
    const wolf = createMonster("wolf", "w");
    expect(elf.darkvisionFt).toBeGreaterThanOrEqual(60);
    const near = battleOf([elf, 0, 0], [wolf, 5, 0]);
    near.darkness = { lights: [] };
    expect(canSee(near, elf, wolf)).toBe(true);
    const far = battleOf([elf, 0, 0], [wolf, 14, 0]);
    far.darkness = { lights: [] };
    expect(canSee(far, elf, wolf)).toBe(false);
  });
});

describe("swarms", () => {
  it("attack the neighbouring square, deal half dice when weakened and can't be healed", () => {
    const fighter = pregenCharacter("fighter");
    const swarm = createMonster("swarm-of-rats", "s");
    expect(swarm.attacks[0]!.reachFt).toBe(5);
    const battle = battleOf([swarm, 0, 0], [fighter, 1, 0]);
    // full swarm: 2d6
    const full = resolveAttack(scriptedRng([20, 3, 3, 3, 3]), battle, swarm, fighter, swarm.attacks[0]!);
    expect(full.damage!.lines[0]!.dice.length).toBe(4); // crit: 2d6 doubled
    swarm.hp = 10;
    const fresh = pregenCharacter("fighter", 1, "f2");
    const battle2 = battleOf([swarm, 0, 0], [fresh, 1, 0]);
    const weak = resolveAttack(scriptedRng([19, 3, 3]), battle2, swarm, fresh, swarm.attacks[0]!);
    expect(weak.hit).toBe(true);
    expect(weak.damage!.lines[0]!.dice).toEqual([3]);
    heal(swarm, 5);
    expect(swarm.hp).toBe(10);
  });
});

describe("silvered weapons", () => {
  it("hurt a werewolf that shrugs off normal weapons", () => {
    const fighter = pregenCharacter("fighter");
    const wolf = createMonster("werewolf-hybrid", "w");
    const battle = battleOf([fighter, 0, 0], [wolf, 1, 0]);
    const normal = resolveAttack(scriptedRng([19, 5]), battle, fighter, wolf, fighter.attacks[0]!);
    expect(normal.hit).toBe(true);
    expect(normal.damage!.total).toBe(0);
    const silver = resolveAttack(scriptedRng([19, 5]), battle, fighter, wolf, fighter.attacks[0]!, { silvered: true });
    expect(silver.damage!.total).toBeGreaterThan(0);
  });
});
