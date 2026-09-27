import { describe, expect, it } from "vitest";
import { perform } from "./actions";
import { resolveAttack } from "./attack";
import { rollInitiative, startCombat } from "./combat";
import { createCharacter, createMonster, pregenCharacter } from "./creatures";
import { scriptedRng, seededRng } from "./rng";
import { castSpell, validateCast } from "./spells";
import { battleOf } from "./testing";
import { sanitizeLegacy } from "../shared/herobook";
import { sanitizeImprovements } from "../shared/improvements";

describe("levels 4 and 5", () => {
  it("a level 5 fighter attacks twice with one action", () => {
    const f = pregenCharacter("fighter", 5, "f");
    expect(f.proficiencyBonus).toBe(3);
    const g1 = createMonster("ogre", "g1");
    const battle = battleOf([f, 0, 0], [g1, 1, 0]);
    startCombat(scriptedRng([20, 1]), battle);
    expect(perform(scriptedRng([1]), battle, "f", { type: "attack", targetId: "g1", optionId: "longsword" }).ok).toBe(true);
    expect(perform(scriptedRng([1]), battle, "f", { type: "attack", targetId: "g1", optionId: "longsword" }).ok).toBe(true);
    expect(perform(scriptedRng([1]), battle, "f", { type: "attack", targetId: "g1", optionId: "longsword" }).ok).toBe(false);
  });

  it("level 4: +2 on an attribute (max 20) or a talent", () => {
    const base = createCharacter({ id: "a", name: "A", classId: "fighter", raceId: "human", level: 4 });
    const strong = createCharacter({ id: "a", name: "A", classId: "fighter", raceId: "human", level: 4, improvements: ["asi:STR+2"] });
    expect(strong.abilities.STR).toBe(Math.min(20, base.abilities.STR + 2));
    const tough = createCharacter({ id: "a", name: "A", classId: "fighter", raceId: "human", level: 4, improvements: ["talent:zaeh"] });
    expect(tough.maxHp).toBe(base.maxHp + 8);
    const quick = createCharacter({ id: "a", name: "A", classId: "fighter", raceId: "human", level: 4, improvements: ["talent:flink"] });
    expect(quick.speedFt).toBe(base.speedFt + 10);
    const alert = createCharacter({ id: "a", name: "A", classId: "fighter", raceId: "human", level: 4, improvements: ["talent:wachsam"] });
    expect(rollInitiative(scriptedRng([10]), alert).parts.some((p) => p.label === "Wachsam" && p.value === 5)).toBe(true);
    // Too early or made up: ignored.
    expect(sanitizeImprovements(["asi:STR+2"], 3)).toEqual([]);
    expect(sanitizeImprovements(["asi:STR+3", "asi:STR+1", "talent:fliegen"], 4)).toEqual([]);
    expect(sanitizeImprovements(["asi:DEX+1,CON+1"], 5)).toEqual(["asi:DEX+1,CON+1"]);
  });

  it("the rogue's sneak attack grows to 3d6 and uncanny dodge halves the first hit", () => {
    const r = pregenCharacter("rogue", 5, "r");
    const ogre = createMonster("ogre", "o");
    const battle = battleOf([r, 0, 0], [ogre, 1, 0]);
    startCombat(scriptedRng([1, 20]), battle);
    const club = ogre.attacks[0]!;
    const hpBefore = r.hp;
    const hit = resolveAttack(scriptedRng([19, 6, 6]), battle, ogre, r, club);
    expect(hit.hit).toBe(true);
    expect(hit.uncannyDodge).toBe(true);
    expect(hpBefore - r.hp).toBe(hit.damage!.total);
    const again = resolveAttack(scriptedRng([19, 6, 6]), battle, ogre, r, club);
    expect(again.uncannyDodge).toBeUndefined();
  });

  it("level 5 casters: fireball hits everyone around the target, mass healing word heals up to six", () => {
    const w = pregenCharacter("wizard", 5, "w");
    expect(w.pc!.spellSlotsMax).toEqual([4, 3, 2]);
    expect(w.pc!.spells).toContain("fireball");
    const k = [0, 1, 2].map((i) => createMonster("kobold", `k${i}`));
    const far = createMonster("kobold", "far");
    const battle = battleOf([w, 0, 0], [k[0]!, 8, 0], [k[1]!, 9, 0], [k[2]!, 9, 1], [far, 20, 0]);
    expect(validateCast(battle, w, { spellId: "fireball", targetIds: ["k0"] })).toBeUndefined();
    const res = castSpell(seededRng(3), battle, w, { spellId: "fireball", targetIds: ["k0"] });
    expect(res.targets.map((t) => t.targetId).sort()).toEqual(["k0", "k1", "k2"]);
    const c = pregenCharacter("cleric", 5, "c");
    expect(c.pc!.spells).toContain("mass-healing-word");
    const hurt = ["h1", "h2"].map((id) => pregenCharacter("fighter", 1, id));
    hurt.forEach((h) => (h.hp = 1));
    const b2 = battleOf([c, 0, 0], [hurt[0]!, 1, 0], [hurt[1]!, 2, 0]);
    const heal = castSpell(seededRng(2), b2, c, { spellId: "mass-healing-word", targetIds: ["h1", "h2"] });
    expect(heal.targets.every((t) => (t.heal?.total ?? 0) > 0)).toBe(true);
  });

  it("level 5 clerics destroy weak undead that fail their save", () => {
    const c = pregenCharacter("cleric", 5, "c");
    const skel = createMonster("skeleton", "s");
    const battle = battleOf([c, 0, 0], [skel, 2, 0]);
    startCombat(scriptedRng([20, 1]), battle);
    const out = perform(scriptedRng([1]), battle, "c", { type: "turn-undead", targetIds: ["s"] });
    expect(out.ok).toBe(true);
    expect(skel.dead).toBe(true);
  });

  it("the hero book allows levels up to 5", () => {
    expect(sanitizeLegacy({ level: 9, gold: 0, potions: 0, gear: { owned: [] }, stories: [] })?.level).toBe(5);
    expect(sanitizeLegacy({ level: 4, gold: 0, potions: 0, gear: { owned: [] }, stories: [], improvements: ["talent:zaeh"] })?.improvements).toEqual(["talent:zaeh"]);
  });
});
