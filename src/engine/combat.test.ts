import { describe, expect, it } from "vitest";
import { applyDamage, combatWinner, currentCreature, heal, nextTurn, planMove, rollDeathSave, startCombat } from "./combat";
import { createMonster, pregenCharacter } from "./creatures";
import { scriptedRng, seededRng } from "./rng";
import { battleOf } from "./testing";

describe("hit points and dying", () => {
  it("knocks heroes unconscious at 0 HP instead of killing them", () => {
    const c = pregenCharacter("wizard");
    const change = applyDamage(seededRng(1), c, 50);
    expect(change.downed).toBe(true);
    expect(c.dead).toBe(false);
    expect(c.hp).toBe(0);
    expect(c.conditions.map((x) => x.id)).toContain("unconscious");
  });

  it("kills monsters at 0 HP", () => {
    const g = createMonster("goblin", "g");
    expect(applyDamage(seededRng(1), g, 7).killed).toBe(true);
  });

  it("counts death saves (1 = two failures, 20 = back up)", () => {
    const c = pregenCharacter("wizard");
    applyDamage(seededRng(1), c, 50);
    expect(rollDeathSave(scriptedRng([12]), c).successes).toBe(1);
    expect(rollDeathSave(scriptedRng([1]), c).failures).toBe(2);
    const last = rollDeathSave(scriptedRng([5]), c);
    expect(last.outcome).toBe("dead");
    expect(c.dead).toBe(true);

    const d = pregenCharacter("fighter");
    applyDamage(seededRng(1), d, 50);
    expect(rollDeathSave(scriptedRng([20]), d).outcome).toBe("revived");
    expect(d.hp).toBe(1);
  });

  it("stabilises after three successes", () => {
    const c = pregenCharacter("rogue");
    applyDamage(seededRng(1), c, 50);
    rollDeathSave(scriptedRng([10]), c);
    rollDeathSave(scriptedRng([11]), c);
    expect(rollDeathSave(scriptedRng([19]), c).outcome).toBe("stable");
  });

  it("wakes up when healed", () => {
    const c = pregenCharacter("rogue");
    applyDamage(seededRng(1), c, 50);
    const h = heal(c, 5);
    expect(h.wokeUp).toBe(true);
    expect(c.hp).toBe(5);
    expect(c.conditions.map((x) => x.id)).not.toContain("unconscious");
  });

  it("adds a failed death save when hit while down", () => {
    const c = pregenCharacter("rogue");
    applyDamage(seededRng(1), c, 50);
    expect(applyDamage(seededRng(1), c, 3, { crit: true }).deathSaveFailures).toBe(2);
  });

  it("lets zombies shrug off a killing blow on a successful save", () => {
    const z = createMonster("zombie", "z");
    z.hp = 6;
    // CON save DC 5 + 6 = 11: 🎲 10 + 3 = 13
    const change = applyDamage(scriptedRng([10]), z, 6);
    expect(change.survived).toBeDefined();
    expect(z.hp).toBe(1);
    const radiant = createMonster("zombie", "z2");
    radiant.hp = 6;
    expect(applyDamage(scriptedRng([20]), radiant, 6, { types: ["radiant"] }).killed).toBe(true);
  });
});

describe("initiative and turns", () => {
  it("sorts by initiative and cycles through rounds", () => {
    const a = pregenCharacter("fighter", 1, "a");
    const g = createMonster("goblin", "g");
    const battle = battleOf([a, 0, 0], [g, 5, 0]);
    const combat = startCombat(scriptedRng([5, 15]), battle);
    expect(combat.order.map((o) => o.creatureId)).toEqual(["g", "a"]);
    expect(currentCreature(battle)!.id).toBe("g");
    nextTurn(seededRng(1), battle);
    expect(currentCreature(battle)!.id).toBe("a");
    const start = nextTurn(seededRng(1), battle);
    expect(start.newRound).toBe(true);
    expect(battle.combat!.round).toBe(2);
  });

  it("rolls a death save at the start of a dying hero's turn", () => {
    const a = pregenCharacter("fighter", 1, "a");
    const g = createMonster("goblin", "g");
    const battle = battleOf([a, 0, 0], [g, 5, 0]);
    startCombat(scriptedRng([15, 5]), battle);
    applyDamage(seededRng(1), a, 99);
    const start = nextTurn(scriptedRng([12]), battle); // goblin
    expect(start.creatureId).toBe("g");
    const mine = nextTurn(scriptedRng([12]), battle);
    expect(mine.deathSave?.success).toBe(true);
    expect(mine.skip).toBe(true);
  });

  it("detects the winner", () => {
    const a = pregenCharacter("fighter", 1, "a");
    const g = createMonster("goblin", "g");
    const battle = battleOf([a, 0, 0], [g, 5, 0]);
    expect(combatWinner(battle)).toBeUndefined();
    applyDamage(seededRng(1), g, 99);
    expect(combatWinner(battle)).toBe("party");
  });
});

describe("movement", () => {
  it("provokes an opportunity attack when leaving reach", () => {
    const a = pregenCharacter("wizard", 1, "a");
    const g = createMonster("goblin", "g");
    const battle = battleOf([a, 0, 0], [g, 1, 0]);
    startCombat(scriptedRng([20, 1]), battle);
    const plan = planMove(battle, "a", [{ x: -1, y: 0 }, { x: -2, y: 0 }]);
    expect(plan.provokes).toEqual(["g"]);
    expect(plan.costFt).toBe(10);
  });

  it("refuses moves longer than the remaining movement", () => {
    const a = pregenCharacter("wizard", 1, "a");
    const battle = battleOf([a, 0, 0], [createMonster("goblin", "g"), 20, 0]);
    startCombat(scriptedRng([20, 1]), battle);
    const path = Array.from({ length: 7 }, (_, i) => ({ x: i + 1, y: 0 }));
    expect(planMove(battle, "a", path).ok).toBe(false);
  });
});
