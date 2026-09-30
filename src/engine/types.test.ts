import { describe, expect, it } from "vitest";
import { addEffect } from "./combat";
import { rollDamage } from "./attack";
import { applyGear, createMonster, pregenCharacter } from "./creatures";
import { seededRng } from "./rng";
import { applyElement, effectiveness, typeKey, TYPE_CHART, VARIANTS } from "./types";
import { getGear } from "../data/gear";

describe("type chart", () => {
  it("gives the foes their strengths and weaknesses", () => {
    expect(effectiveness(createMonster("goblin", "g"), "thunder")).toBe(2);
    expect(effectiveness(createMonster("kobold", "k"), "cold")).toBe(2);
    expect(effectiveness(createMonster("kobold", "k"), "fire")).toBe(0.5);
    expect(effectiveness(createMonster("skeleton", "s"), "radiant")).toBe(2);
    expect(effectiveness(createMonster("wolf", "w"), "fire")).toBe(2);
    // The rule book stays: skeletons are immune to poison, weak to bludgeoning.
    expect(effectiveness(createMonster("skeleton", "s"), "poison")).toBe(0);
    expect(effectiveness(createMonster("skeleton", "s"), "bludgeoning")).toBe(2);
  });

  it("only names foes that exist", () => {
    for (const id of [...Object.keys(TYPE_CHART), ...Object.keys(VARIANTS)]) expect(() => createMonster(id, "x"), id).not.toThrow();
  });

  it("elemental variants: new name, own resistances, element on every attack", () => {
    const k = createMonster("kobold", "k");
    applyElement(k, "storm");
    expect(k.name).toBe("Sturm-Kobold");
    expect(effectiveness(k, "lightning")).toBe(0.5);
    expect(effectiveness(k, "thunder")).toBe(2);
    expect(k.attacks.every((a) => a.damage.some((d) => d.type === "lightning" && d.dice === "1d2"))).toBe(true);
    expect(typeKey(k)).toBe("kobold:storm");

    const g = createMonster("goblin", "g");
    applyElement(g, "fire");
    expect(g.name).toBe("Feuergoblin");
    expect(effectiveness(g, "fire")).toBe(0.5);
    expect(effectiveness(g, "cold")).toBe(2);

    const s = createMonster("skeleton", "s");
    applyElement(s, "frost");
    expect(s.name).toBe("Frost-Skelett");
    expect(effectiveness(s, "cold")).toBe(0.5);
    expect(effectiveness(s, "fire")).toBe(2);
    expect(effectiveness(s, "radiant")).toBe(2);
  });

  it("a Feuerkobold is not weak to fire (resistant wins over the chart)", () => {
    const k = createMonster("kobold", "k");
    applyElement(k, "fire");
    expect(k.vulnerabilities).not.toContain("fire");
    expect(effectiveness(k, "fire")).toBe(0.5);
  });

  it("wet: lightning twice as hard, fire only half", () => {
    const wolf = createMonster("wolf", "w");
    const bat = createMonster("goblin", "b");
    addEffect(bat, "wet", 2, "water");
    const zap = rollDamage(seededRng(1), { parts: [{ dice: "2d6", type: "lightning" }] }, bat);
    expect(zap.lines[0]!.final).toBe(zap.lines[0]!.raw * 2);
    expect(zap.lines[0]!.note).toBe("vulnerability");
    const burn = rollDamage(seededRng(1), { parts: [{ dice: "2d6", type: "fire" }] }, bat);
    expect(burn.lines[0]!.final).toBe(Math.floor(burn.lines[0]!.raw / 2));
    // A wet wolf: weak to fire, but soaked – that evens out.
    addEffect(wolf, "wet", 2, "water");
    const f = rollDamage(seededRng(1), { parts: [{ dice: "2d6", type: "fire" }] }, wolf);
    expect(f.lines[0]!.final).toBe(f.lines[0]!.raw);
    expect(f.lines[0]!.note).toBeUndefined();
  });
});

describe("elemental gear", () => {
  it("element weapons add 1d4 of their element", () => {
    const hero = pregenCharacter("fighter");
    applyGear(hero, { owned: ["flame-longsword"], weapon: "flame-longsword" });
    const sword = hero.attacks.find((a) => a.sourceId === "longsword")!;
    expect(sword.damage.some((d) => d.type === "fire" && d.dice === "1d4")).toBe(true);
    expect(sword.magical).toBe(true);
  });

  it("arrowheads add their element to ranged weapon attacks only", () => {
    const hero = pregenCharacter("ranger");
    applyGear(hero, { owned: ["arrows-frost"], trinket: "arrows-frost" });
    const ranged = hero.attacks.filter((a) => a.kind === "ranged" && a.source === "weapon");
    expect(ranged.length).toBeGreaterThan(0);
    expect(ranged.every((a) => a.damage.some((d) => d.type === "cold"))).toBe(true);
    expect(hero.attacks.filter((a) => a.kind === "melee").some((a) => a.damage.some((d) => d.type === "cold"))).toBe(false);
  });

  it("protective armour and amulets halve their element – and only while worn", () => {
    const hero = pregenCharacter("wizard");
    applyGear(hero, { owned: ["amulet-ice"], trinket: "amulet-ice" });
    expect(effectiveness(hero, "cold")).toBe(0.5);
    applyGear(hero, { owned: ["amulet-ice"] });
    expect(effectiveness(hero, "cold")).toBe(1);
    expect(getGear("dragon-leather")?.resist).toBe("fire");
  });

  it("keeps the race's own resistances", () => {
    const dwarf = pregenCharacter("fighter");
    dwarf.pc!.raceId = "dwarf";
    applyGear(dwarf, { owned: ["amulet-fire"], trinket: "amulet-fire" });
    expect(dwarf.resistances).toEqual(expect.arrayContaining(["poison", "fire"]));
  });
});
