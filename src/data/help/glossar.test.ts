import { describe, expect, it } from "vitest";
import { ABILITY_GLOSSAR } from "../../engine/core";
import { PLAYABLE_CLASSES } from "../../engine/creatures";
import { SRD } from "../../engine/data";
import { I18N } from "../../engine/names";
import { seededRng } from "../../engine/rng";
import { simulateBattle } from "../../engine/simulate";
import { GLOSSAR, searchGlossar } from "./glossar";

/** Every term that can show up in the game, derived from the data. */
function termsInData(): string[] {
  const keys: string[] = [];
  const add = (prefix: string, ids: Iterable<string>) => {
    for (const id of ids) keys.push(`${prefix}:${id}`);
  };
  add("klasse", SRD.classes.map((c) => c.id));
  add("merkmal", SRD.classes.flatMap((c) => c.levels.flatMap((l) => l.features)));
  add("merkmal", ["improved-critical", "disciple-of-life"]);
  add("volk", SRD.races.map((r) => r.id));
  add("volksmerkmal", SRD.races.flatMap((r) => r.traits));
  add("zauber", SRD.spells.map((s) => s.id));
  add("waffe", [...SRD.weapons.map((w) => w.id), "unarmed"]);
  add("ruestung", SRD.armor.map((a) => a.id));
  add("gegenstand", SRD.items.map((i) => i.id));
  add("monster", SRD.monsters.map((m) => m.id));
  add("monstermerkmal", SRD.monsters.flatMap((m) => m.traits));
  add("zustand", SRD.conditions);
  add("fertigkeit", SRD.skills.map((s) => s.id));
  const damageTypes = new Set<string>([
    ...SRD.weapons.map((w) => w.damage.type),
    ...SRD.spells.flatMap((s) => (s.damage ? [s.damage.type] : [])),
    ...SRD.monsters.flatMap((m) => [
      ...m.actions.flatMap((a) => a.damage.map((d) => d.type)),
      ...m.resistances,
      ...m.immunities,
      ...m.vulnerabilities,
    ]),
  ]);
  add("schadensart", damageTypes);
  keys.push(...Object.values(ABILITY_GLOSSAR));
  return [...new Set(keys)];
}

describe("glossary", () => {
  it("has a complete entry for every term in the data", () => {
    const missing = termsInData().filter((k) => !GLOSSAR[k]);
    expect(missing).toEqual([]);
  });

  it("covers every class the players can pick", () => {
    for (const c of PLAYABLE_CLASSES) expect(GLOSSAR[`klasse:${c}`]).toBeDefined();
  });

  it("has titel, kurz and lang in every entry, and only valid cross references", () => {
    for (const [key, e] of Object.entries(GLOSSAR)) {
      expect(e.titel, key).toBeTruthy();
      expect(e.kurz, key).toBeTruthy();
      expect(e.lang, key).toBeTruthy();
      for (const ref of e.siehe_auch ?? []) expect(GLOSSAR[ref], `${key} → ${ref}`).toBeDefined();
    }
  });

  it("explains every term used in roll breakdowns and combat texts", () => {
    const used = new Set<string>();
    const fights = [
      { heroes: ["fighter", "paladin", "wizard", "rogue"], enemies: ["goblin", "goblin", "goblin"], level: 1 },
      { heroes: ["fighter", "paladin", "wizard", "cleric"], enemies: ["red-dragon-wyrmling", "kobold", "kobold"], level: 3 },
      { heroes: ["cleric", "rogue", "paladin"], enemies: ["zombie", "skeleton", "ghoul", "wolf", "wolf"], level: 2 },
      { heroes: ["wizard", "fighter"], enemies: ["swarm-of-rats", "werewolf-hybrid", "ogre"], level: 3 },
    ];
    for (const setup of fights) {
      for (let seed = 1; seed <= 15; seed++) {
        const r = simulateBattle(seededRng(seed), setup);
        for (const block of r.log) for (const line of block.lines) line.glossarKeys.forEach((k) => used.add(k));
      }
    }
    const missing = [...used].filter((k) => !GLOSSAR[k]);
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(40);
  });

  it("finds terms by keyword", () => {
    expect(searchGlossar("rüstungsklasse")[0]!.key).toBe("ruestungsklasse");
    expect(searchGlossar("Oger")[0]!.key).toBe("monster:ogre");
  });
});

describe("German names", () => {
  it("has a name for everything in the data", () => {
    const check = (table: Record<string, unknown>, ids: string[]) => ids.filter((id) => !(id in table));
    expect(check(I18N.classes, SRD.classes.map((c) => c.id))).toEqual([]);
    expect(check(I18N.races, SRD.races.map((r) => r.id))).toEqual([]);
    expect(check(I18N.spells, SRD.spells.map((s) => s.id))).toEqual([]);
    expect(check(I18N.weapons, SRD.weapons.map((w) => w.id))).toEqual([]);
    expect(check(I18N.armor, SRD.armor.map((a) => a.id))).toEqual([]);
    expect(check(I18N.items, SRD.items.map((i) => i.id))).toEqual([]);
    expect(check(I18N.monsters, SRD.monsters.map((m) => m.id))).toEqual([]);
    expect(check(I18N.monsterActions, SRD.monsters.flatMap((m) => m.actions.map((a) => a.id)))).toEqual([]);
    expect(check(I18N.monsterTraits, SRD.monsters.flatMap((m) => m.traits))).toEqual([]);
    expect(check(I18N.skills, SRD.skills.map((s) => s.id))).toEqual([]);
    expect(check(I18N.conditions, SRD.conditions)).toEqual([]);
    expect(check(I18N.features, SRD.classes.flatMap((c) => c.levels.flatMap((l) => l.features)))).toEqual([]);
    expect(check(I18N.raceTraits, SRD.races.flatMap((r) => r.traits))).toEqual([]);
  });
});
