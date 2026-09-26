import { describe, expect, it } from "vitest";
import { longRest, perform } from "./actions";
import { applyDamage, startCombat } from "./combat";
import { createMonster, pregenCharacter } from "./creatures";
import { scriptedRng, seededRng } from "./rng";
import { battleOf } from "./testing";

function setup() {
  const f = pregenCharacter("fighter", 2, "f");
  const g = createMonster("goblin", "g");
  const battle = battleOf([f, 0, 0], [g, 1, 0]);
  startCombat(scriptedRng([20, 1]), battle);
  return { battle, f, g };
}

describe("action economy", () => {
  it("allows one action per turn", () => {
    const { battle } = setup();
    expect(perform(scriptedRng([1]), battle, "f", { type: "attack", targetId: "g", optionId: "longsword" }).ok).toBe(true);
    const again = perform(scriptedRng([1]), battle, "f", { type: "attack", targetId: "g", optionId: "longsword" });
    expect(again.ok).toBe(false);
  });

  it("gives an extra action with action surge (once)", () => {
    const { battle } = setup();
    perform(scriptedRng([1]), battle, "f", { type: "attack", targetId: "g", optionId: "longsword" });
    expect(perform(seededRng(1), battle, "f", { type: "action-surge" }).ok).toBe(true);
    expect(perform(scriptedRng([1]), battle, "f", { type: "attack", targetId: "g", optionId: "longsword" }).ok).toBe(true);
    expect(perform(seededRng(1), battle, "f", { type: "action-surge" }).ok).toBe(false);
  });

  it("rejects actions out of turn", () => {
    const { battle } = setup();
    const r = perform(seededRng(1), battle, "g", { type: "attack", targetId: "f", optionId: "scimitar" });
    expect(r.ok).toBe(false);
  });

  it("second wind heals as a bonus action", () => {
    const { battle, f } = setup();
    f.hp = 3;
    const r = perform(scriptedRng([6]), battle, "f", { type: "second-wind" });
    expect(r.ok && r.kind === "heal" && r.total).toBe(8);
    expect(f.hp).toBe(11);
    expect(perform(scriptedRng([1]), battle, "f", { type: "attack", targetId: "g", optionId: "longsword" }).ok).toBe(true);
  });

  it("moves and spends movement", () => {
    const { battle } = setup();
    const r = perform(seededRng(1), battle, "f", { type: "move", path: [{ x: 0, y: 1 }, { x: 0, y: 2 }] });
    expect(r.ok).toBe(true);
    expect(battle.combat!.turn.movementLeftFt).toBe(20);
  });

  it("drinking a potion wakes a fallen friend", () => {
    const f = pregenCharacter("fighter", 1, "f");
    const r = pregenCharacter("rogue", 1, "r");
    const battle = battleOf([f, 0, 0], [r, 1, 0]);
    applyDamage(seededRng(1), r, 99);
    const out = perform(scriptedRng([2, 2]), battle, "f", { type: "use-item", itemId: "potion-of-healing", targetId: "r" });
    expect(out.ok).toBe(true);
    expect(r.hp).toBe(6);
    expect(f.pc!.inventory.find((i) => i.itemId === "potion-of-healing")).toBeUndefined();
  });

  it("paladins lay on hands from a pool", () => {
    const p = pregenCharacter("paladin", 1, "p");
    const f = pregenCharacter("fighter", 1, "f");
    f.hp = 5;
    const battle = battleOf([p, 0, 0], [f, 1, 0]);
    const out = perform(seededRng(1), battle, "p", { type: "lay-on-hands", targetId: "f", amount: 10 });
    expect(out.ok && out.kind === "heal" && out.total).toBe(5);
    expect(p.pc!.resources["lay-on-hands"]!.used).toBe(5);
  });

  it("long rest restores everything", () => {
    const w = pregenCharacter("wizard");
    w.pc!.spellSlots = [0];
    w.hp = 1;
    longRest(w);
    expect(w.pc!.spellSlots).toEqual([2]);
    expect(w.hp).toBe(w.maxHp);
  });

  it("monster multiattack allows several attacks with one action", () => {
    const f = pregenCharacter("fighter", 1, "f");
    const w = createMonster("werewolf-hybrid", "w");
    const battle = battleOf([f, 0, 0], [w, 1, 0]);
    startCombat(scriptedRng([1, 20]), battle);
    expect(perform(scriptedRng([1]), battle, "w", { type: "attack", targetId: "f", optionId: "bite" }).ok).toBe(true);
    expect(perform(scriptedRng([1]), battle, "w", { type: "attack", targetId: "f", optionId: "claws" }).ok).toBe(true);
    expect(perform(scriptedRng([1]), battle, "w", { type: "attack", targetId: "f", optionId: "claws" }).ok).toBe(false);
  });
});
