import { describe, expect, it } from "vitest";
import { attackReasons, resolveAttack } from "./attack";
import { planMove } from "./combat";
import { createMonster, pregenCharacter } from "./creatures";
import { findPath, OPEN_FIELD } from "./grid";
import { scriptedRng } from "./rng";
import { coverBonus, pathCost } from "./terrain";
import { battleOf } from "./testing";

const bow = (c: ReturnType<typeof pregenCharacter>) => c.attacks.find((a) => a.kind === "ranged")!;

describe("furniture in the rules", () => {
  it("gives cover against attacks from beyond it, not from the side or up close", () => {
    const ranger = pregenCharacter("ranger");
    const goblin = createMonster("goblin", "g");
    const battle = battleOf([ranger, 0, 5], [goblin, 6, 5]);
    battle.terrain = { difficult: [], cover: { "5,5": 2 }, high: [], hazard: [] };
    expect(coverBonus(battle, ranger, goblin)).toBe(2);
    // From above, the table is not in the way.
    ranger.pos = { x: 6, y: 0 };
    expect(coverBonus(battle, ranger, goblin)).toBe(0);
    // Right next to it: no cover.
    ranger.pos = { x: 5, y: 4 };
    expect(coverBonus(battle, ranger, goblin)).toBe(0);
  });

  it("adds the cover to the armour class in the attack", () => {
    const ranger = pregenCharacter("ranger");
    const goblin = createMonster("goblin", "g");
    const battle = battleOf([ranger, 0, 5], [goblin, 6, 5]);
    const plain = resolveAttack(scriptedRng([10, 3]), battle, ranger, goblin, bow(ranger)).targetAc;
    battle.terrain = { difficult: [], cover: { "5,5": 5 }, high: [], hazard: [] };
    const r = resolveAttack(scriptedRng([10, 3]), battle, ranger, goblin, bow(ranger));
    expect(r.targetAc).toBe(plain + 5);
    expect(r.acParts.some((p) => p.glossarKey === "deckung")).toBe(true);
  });

  it("gives advantage when shooting down from high ground", () => {
    const ranger = pregenCharacter("ranger");
    const goblin = createMonster("goblin", "g");
    const battle = battleOf([ranger, 0, 5], [goblin, 6, 5]);
    battle.terrain = { difficult: [], cover: {}, high: ["0,5"], hazard: [] };
    expect(attackReasons(battle, ranger, goblin, bow(ranger)).some((r) => r.glossarKey === "erhoeht")).toBe(true);
    // Both up there: no advantage.
    battle.terrain.high.push("6,5");
    expect(attackReasons(battle, ranger, goblin, bow(ranger)).some((r) => r.glossarKey === "erhoeht")).toBe(false);
  });

  it("makes difficult ground cost double and paths go around it", () => {
    const fighter = pregenCharacter("fighter");
    const battle = battleOf([fighter, 0, 0]);
    battle.terrain = { difficult: ["1,0", "2,0", "3,0"], cover: {}, high: [], hazard: [] };
    const straight = [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }];
    expect(pathCost(battle, straight)).toBe(7);
    expect(planMove(battle, fighter.id, straight).costFt).toBe(35);
    const path = findPath(battle, fighter, (p) => p.x === 4 && p.y === 0, OPEN_FIELD)!;
    expect(pathCost(battle, path)).toBe(4);
    expect(path.some((p) => p.y !== 0)).toBe(true);
    // With too little movement for the detour through the bush … no path.
    expect(findPath(battle, fighter, (p) => p.x === 2 && p.y === 0, OPEN_FIELD, 1)).toBeUndefined();
  });

  it("weather: fog hides far targets, wind blows arrows off course", () => {
    const ranger = pregenCharacter("ranger");
    const goblin = createMonster("goblin", "g");
    const battle = battleOf([ranger, 0, 5], [goblin, 9, 5]);
    battle.terrain = { difficult: [], cover: {}, high: [], hazard: [], weather: "fog", outdoor: ["0,5"] };
    expect(attackReasons(battle, ranger, goblin, bow(ranger)).some((r) => r.glossarKey === "wetter")).toBe(true);
    goblin.pos = { x: 4, y: 5 };
    expect(attackReasons(battle, ranger, goblin, bow(ranger)).some((r) => r.glossarKey === "wetter")).toBe(false);
    battle.terrain.weather = "wind";
    const r = resolveAttack(scriptedRng([10, 3]), battle, ranger, goblin, bow(ranger));
    expect(r.parts.some((p) => p.label === "Wind" && p.value === -2)).toBe(true);
  });
});
