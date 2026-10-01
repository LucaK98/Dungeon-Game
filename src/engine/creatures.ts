/**
 * Builds creatures: player characters (with pregenerated defaults per class) and monsters.
 */
import { applyTypeChart } from "./types";
import { parseImprovement, sanitizeImprovements } from "../shared/improvements";
import type { AttackOption, Creature, FightingStyle, PcInfo, Resource, SaveAction, Side } from "../shared/game";
import type { AbilityScores, DamagePart, DamageType, SkillId, WeaponDef } from "../shared/rules";
import { ABILITIES } from "../shared/rules";
import type { Ability, BreakdownPart } from "../shared/types";
import { ABILITY_GLOSSAR, abilityMod, modPart, profPart } from "./core";
import { getArmor, getClass, getMonster, getRace, getWeapon } from "./data";
import { nameOf } from "./names";
import { getGear } from "../data/gear";

// ---------------------------------------------------------------- class defaults

/** Standard array (15, 14, 13, 12, 10, 8) sorted by what each class needs most. */
const ABILITY_PRIORITY: Record<string, Ability[]> = {
  fighter: ["STR", "CON", "DEX", "WIS", "CHA", "INT"],
  paladin: ["STR", "CHA", "CON", "WIS", "DEX", "INT"],
  wizard: ["INT", "CON", "DEX", "WIS", "CHA", "STR"],
  rogue: ["DEX", "CON", "CHA", "WIS", "INT", "STR"],
  cleric: ["WIS", "CON", "STR", "CHA", "DEX", "INT"],
  bard: ["CHA", "DEX", "CON", "WIS", "INT", "STR"],
  ranger: ["DEX", "WIS", "CON", "STR", "INT", "CHA"],
  druid: ["WIS", "CON", "DEX", "INT", "CHA", "STR"],
  monk: ["DEX", "WIS", "CON", "STR", "INT", "CHA"],
};
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

interface Loadout {
  armor?: string;
  shield: boolean;
  weapons: string[];
  skills: SkillId[];
  expertise?: SkillId[];
  /** From which level the expertise applies (rogue 1, bard 3). */
  expertiseFrom?: number;
  fightingStyle?: FightingStyle;
  /** Spells by the character level from which they are known. */
  spells?: [level: number, ids: string[]][];
}

const LOADOUTS: Record<string, Loadout> = {
  fighter: {
    armor: "chain-mail",
    shield: true,
    weapons: ["longsword", "handaxe"],
    skills: ["athletics", "perception"],
    fightingStyle: "defense",
  },
  paladin: {
    armor: "chain-mail",
    shield: true,
    weapons: ["longsword", "javelin"],
    skills: ["athletics", "persuasion"],
    fightingStyle: "dueling",
    spells: [[2, ["bless", "cure-wounds", "divine-favor", "shield-of-faith"]]],
  },
  wizard: {
    shield: false,
    weapons: ["quarterstaff", "dagger"],
    skills: ["arcana", "investigation"],
    spells: [
      [1, ["fire-bolt", "ray-of-frost", "magic-missile", "burning-hands", "sleep"]],
      [3, ["scorching-ray"]],
      [5, ["fireball"]],
    ],
  },
  rogue: {
    armor: "leather-armor",
    shield: false,
    weapons: ["rapier", "shortbow", "dagger"],
    skills: ["stealth", "perception", "acrobatics", "investigation"],
    expertise: ["stealth", "perception"],
  },
  cleric: {
    armor: "scale-mail",
    shield: true,
    weapons: ["mace", "crossbow-light"],
    skills: ["insight", "medicine"],
    spells: [
      [1, ["sacred-flame", "cure-wounds", "healing-word", "bless", "guiding-bolt", "shield-of-faith"]],
      [5, ["mass-healing-word"]],
    ],
  },
  bard: {
    armor: "leather-armor",
    shield: false,
    weapons: ["rapier", "dagger"],
    skills: ["performance", "persuasion", "deception"],
    expertise: ["persuasion", "performance"],
    expertiseFrom: 3,
    spells: [[1, ["vicious-mockery", "healing-word", "cure-wounds", "sleep", "thunderwave"]]],
  },
  ranger: {
    armor: "leather-armor",
    shield: false,
    weapons: ["longbow", "shortsword"],
    skills: ["survival", "perception", "stealth"],
    fightingStyle: "archery",
    spells: [[2, ["hunters-mark", "cure-wounds"]]],
  },
  druid: {
    armor: "leather-armor",
    shield: true,
    weapons: ["quarterstaff", "javelin"],
    skills: ["nature", "medicine"],
    spells: [[1, ["produce-flame", "cure-wounds", "healing-word", "thunderwave"]]],
  },
  monk: {
    shield: false,
    weapons: ["shortsword", "dagger"],
    skills: ["acrobatics", "stealth"],
  },
};

/** Highest level a hero can reach. */
export const MAX_LEVEL = 5;

/** Which classes we recommend to complete beginners. */
export const BEGINNER_CLASSES = ["fighter", "paladin"];

export const PLAYABLE_CLASSES = Object.keys(LOADOUTS);

// ---------------------------------------------------------------- helpers

export function isProficientWithWeapon(pc: Pick<PcInfo, "classId" | "raceId">, w: WeaponDef): boolean {
  const cls = getClass(pc.classId);
  if (cls.weapons.includes(w.category)) return true;
  if (pc.raceId === "elf" && ["longsword", "shortsword", "shortbow", "longbow"].includes(w.id)) return true;
  if (pc.raceId === "dwarf" && ["battleaxe", "handaxe", "warhammer"].includes(w.id)) return true;
  if (pc.classId === "rogue" && ["longsword", "rapier", "shortsword"].includes(w.id)) return true;
  if (pc.classId === "wizard" && ["dagger", "quarterstaff", "crossbow-light"].includes(w.id)) return true;
  if (pc.classId === "bard" && ["longsword", "rapier", "shortsword"].includes(w.id)) return true;
  if (pc.classId === "druid" && ["club", "dagger", "javelin", "mace", "quarterstaff", "spear"].includes(w.id)) return true;
  if (pc.classId === "monk" && w.id === "shortsword") return true;
  return false;
}

export function weaponAttack(c: Pick<Creature, "abilities" | "proficiencyBonus"> & { pc: PcInfo }, weaponId: string): AttackOption {
  const w = getWeapon(weaponId);
  const finesse = w.properties.includes("finesse");
  const thrown = w.properties.includes("thrown");
  const str = abilityMod(c.abilities.STR);
  const dex = abilityMod(c.abilities.DEX);
  // Monks may use Dexterity with their simple weapons and short swords (Martial Arts).
  const monkWeapon = c.pc.classId === "monk" && !w.properties.includes("two-handed") && !w.properties.includes("heavy") && (w.category === "simple" || w.id === "shortsword");
  // Druids fight with nature's magic in staff and club (like Shillelagh): Wisdom if better.
  const druidStaff = c.pc.classId === "druid" && (w.id === "quarterstaff" || w.id === "club") && abilityMod(c.abilities.WIS) > str;
  const ability: Ability = w.ranged ? "DEX" : druidStaff ? "WIS" : (finesse || monkWeapon) && dex > str ? "DEX" : "STR";
  const mod = modPart(c as Creature, ability);
  const toHit: BreakdownPart[] = [mod];
  if (isProficientWithWeapon(c.pc, w)) toHit.push(profPart(c.proficiencyBonus));

  const twoHanded = !c.pc.shield && w.versatileDice;
  const damage: DamagePart[] = [{ dice: twoHanded ? w.versatileDice! : w.damage.dice, type: w.damage.type }];
  const damageBonus: BreakdownPart[] = [mod];
  if (c.pc.fightingStyle === "archery" && w.ranged) toHit.push({ label: "Bogenschießen", value: 2, glossarKey: "kampfstil" });
  if (c.pc.fightingStyle === "dueling" && !w.ranged && !w.properties.includes("two-handed")) {
    damageBonus.push({ label: "Duellieren", value: 2, glossarKey: "kampfstil" });
  }
  return {
    id: w.id,
    sourceId: w.id,
    source: "weapon",
    kind: w.ranged ? "ranged" : "melee",
    toHit,
    damage,
    damageBonus,
    reachFt: w.ranged ? 0 : w.properties.includes("reach") ? 10 : 5,
    ...(w.ranged || thrown ? { rangeFt: w.rangeFt } : {}),
    ...(finesse ? { finesse } : {}),
    ...(thrown ? { thrown } : {}),
    ...(w.magical ? { magical: true } : {}),
  };
}

function unarmedStrike(c: Creature): AttackOption {
  // Monks: Martial Arts – Dexterity if better, and a real damage die (1d6, 1d8 from level 5 – a bit
  // more than the rule book, the class bench found monks far behind at low levels).
  const monk = c.pc?.classId === "monk";
  const mod = modPart(c, monk && c.abilities.DEX > c.abilities.STR ? "DEX" : "STR");
  if (monk) {
    return {
      id: "unarmed",
      sourceId: "unarmed",
      source: "unarmed",
      kind: "melee",
      toHit: [mod, profPart(c.proficiencyBonus)],
      damage: [{ dice: (c.pc?.level ?? 1) >= 5 ? "1d8" : "1d6", type: "bludgeoning" }],
      damageBonus: [mod],
      reachFt: 5,
    };
  }
  return {
    id: "unarmed",
    sourceId: "unarmed",
    source: "unarmed",
    kind: "melee",
    toHit: [mod, profPart(c.proficiencyBonus)],
    damage: [{ dice: "1", type: "bludgeoning" }],
    damageBonus: [mod],
    reachFt: 5,
  };
}

/** Armour class of the equipment, without temporary effects. */
export function armorClassParts(abilities: AbilityScores, pc: Pick<PcInfo, "armorId" | "shield" | "fightingStyle" | "gear"> & { classId?: string }): BreakdownPart[] {
  const dex = abilityMod(abilities.DEX);
  const parts: BreakdownPart[] = [];
  // Magic armour replaces the normal one while it is worn.
  const magic = pc.gear?.armor ? getGear(pc.gear.armor) : undefined;
  const armorId = magic?.base ?? pc.armorId;
  if (armorId) {
    const a = getArmor(armorId);
    parts.push({ label: magic ? magic.name : nameOf("armor", a.id), value: a.baseAc, glossarKey: "ruestung:" + a.id });
    if (magic?.bonus) parts.push({ label: "Magie", value: magic.bonus, glossarKey: "ausruestung" });
    if (a.dexBonus) {
      const v = a.maxDexBonus !== undefined ? Math.min(dex, a.maxDexBonus) : dex;
      parts.push({ label: "Geschicklichkeit", value: v, glossarKey: ABILITY_GLOSSAR.DEX });
    }
  } else {
    parts.push({ label: "Grundwert", value: 10, glossarKey: "ruestungsklasse" });
    parts.push({ label: "Geschicklichkeit", value: dex, glossarKey: ABILITY_GLOSSAR.DEX });
    // Monk: Unarmored Defense adds Wisdom (without armour and shield).
    if (pc.classId === "monk" && !pc.shield) {
      parts.push({ label: "Weisheit (Abwehr ohne Rüstung)", value: abilityMod(abilities.WIS), glossarKey: "merkmal:unarmored-defense-monk" });
      // Fighting stance: monks stand in the thick of it without armour (the class bench found them far behind).
      parts.push({ label: "Kampfhaltung", value: 1, glossarKey: "merkmal:unarmored-defense-monk" });
    }
  }
  if (pc.shield) parts.push({ label: "Schild", value: 2, glossarKey: "ruestung:shield" });
  if (pc.fightingStyle === "defense" && armorId) {
    parts.push({ label: "Kampfstil Verteidigung", value: 1, glossarKey: "kampfstil" });
  }
  const trinket = pc.gear?.trinket ? getGear(pc.gear.trinket) : undefined;
  if (trinket?.effect === "ac") parts.push({ label: trinket.name, value: trinket.bonus, glossarKey: "ausruestung" });
  return parts;
}

function spellsFor(classId: string, raceId: string, level: number): string[] {
  const list = new Set<string>();
  for (const [from, ids] of LOADOUTS[classId]?.spells ?? []) if (level >= from) ids.forEach((s) => list.add(s));
  // High elves know one wizard cantrip (wizards already have ours).
  if (raceId === "elf") list.add("fire-bolt");
  return [...list];
}

function resourcesFor(classId: string, level: number, cha = 10): Record<string, Resource> {
  const r: Record<string, Resource> = {};
  if (classId === "fighter") {
    r["second-wind"] = { used: 0, max: 1, recharge: "short" };
    if (level >= 2) r["action-surge"] = { used: 0, max: 1, recharge: "short" };
  }
  if (classId === "paladin") r["lay-on-hands"] = { used: 0, max: 5 * level, recharge: "long" };
  if (classId === "cleric" && level >= 2) r["channel-divinity"] = { used: 0, max: 1, recharge: "short" };
  if (classId === "wizard") r["arcane-recovery"] = { used: 0, max: 1, recharge: "long" };
  if (classId === "bard") r["bardic-inspiration"] = { used: 0, max: Math.max(1, abilityMod(cha)), recharge: level >= 5 ? "short" : "long" };
  if (classId === "druid" && level >= 2) r["wild-shape"] = { used: 0, max: 2, recharge: "short" };
  if (classId === "monk" && level >= 2) r["ki"] = { used: 0, max: level, recharge: "short" };
  return r;
}

// ---------------------------------------------------------------- player characters

export interface CharacterOptions {
  id: string;
  name: string;
  classId: string;
  raceId: string;
  level?: number;
  side?: Side;
  /** Base scores before racial bonuses; default: standard array by class. */
  baseAbilities?: AbilityScores;
  skills?: SkillId[];
  /** Level-4 improvements from the hero book ("asi:STR+2", "talent:zaeh"). */
  improvements?: string[];
  /** Chapters finished in this adventure (each allows one more attribute point). */
  chapters?: number;
}

export function createCharacter(opts: CharacterOptions): Creature {
  const level = Math.min(MAX_LEVEL, Math.max(1, opts.level ?? 1));
  const cls = getClass(opts.classId);
  const race = getRace(opts.raceId);
  const loadout = LOADOUTS[opts.classId];
  if (!loadout) throw new Error(`class ${opts.classId} is not playable`);

  const base: AbilityScores =
    opts.baseAbilities ??
    (Object.fromEntries(ABILITY_PRIORITY[opts.classId]!.map((a, i) => [a, STANDARD_ARRAY[i]])) as AbilityScores);
  const abilities = { ...base };
  for (const a of ABILITIES) abilities[a] += race.abilityBonuses[a] ?? 0;
  // Improvements from level 4 on: attributes (never above 20) or a talent.
  const improvements = sanitizeImprovements(opts.improvements, level, opts.chapters ?? 0);
  const talents: string[] = [];
  for (const raw of improvements) {
    const imp = parseImprovement(raw)!;
    if (imp.kind === "talent") talents.push(imp.talent.id);
    else for (const [a, v] of Object.entries(imp.bonus)) abilities[a as Ability] = Math.min(20, abilities[a as Ability] + (v ?? 0));
  }

  const levelDef = cls.levels.find((l) => l.level === level)!;
  const conMod = abilityMod(abilities.CON);
  let maxHp = cls.hitDie + conMod + (level - 1) * (cls.hitDie / 2 + 1 + conMod);
  if (race.traits.includes("dwarven-toughness")) maxHp += level;
  if (talents.includes("zaeh")) maxHp += 2 * level;

  const features = cls.levels.filter((l) => l.level <= level).flatMap((l) => l.features);
  if (opts.classId === "fighter" && level >= 3) features.push("improved-critical");
  if (opts.classId === "cleric") features.push("disciple-of-life");
  // Our archetypes: the ranger is a Hunter (Colossus Slayer).
  if (opts.classId === "ranger" && level >= 3) features.push("colossus-slayer");

  const skills = new Set<SkillId>([...(opts.skills ?? loadout.skills), ...race.skillProficiencies]);
  const pc: PcInfo = {
    classId: cls.id,
    raceId: race.id,
    level,
    features,
    ...(loadout.fightingStyle && (opts.classId === "fighter" || level >= 2)
      ? { fightingStyle: loadout.fightingStyle }
      : {}),
    saveProficiencies: cls.saves,
    skillProficiencies: [...skills],
    expertise: level >= (loadout.expertiseFrom ?? 1) ? (loadout.expertise ?? []) : [],
    ...(loadout.armor ? { armorId: loadout.armor } : {}),
    shield: loadout.shield,
    weaponIds: loadout.weapons,
    inventory: [
      { itemId: "potion-of-healing", qty: 1 },
      { itemId: "torch", qty: 1 },
    ],
    spells: spellsFor(cls.id, race.id, level),
    spellSlots: [...levelDef.spellSlots],
    spellSlotsMax: [...levelDef.spellSlots],
    resources: resourcesFor(cls.id, level, abilities.CHA),
    hitDie: cls.hitDie,
    ...(improvements.length ? { improvements, talents } : {}),
  };

  const c: Creature = {
    id: opts.id,
    name: opts.name,
    kind: "pc",
    side: opts.side ?? "party",
    pc,
    size: race.size,
    creatureType: "humanoid",
    abilities,
    proficiencyBonus: levelDef.proficiencyBonus,
    baseAc: armorClassParts(abilities, pc),
    maxHp,
    hp: maxHp,
    tempHp: 0,
    speedFt: race.speedFt,
    darkvisionFt: race.darkvisionFt,
    resistances: race.resistances,
    immunities: [],
    vulnerabilities: [],
    resistsNonmagical: false,
    immuneNonmagical: false,
    conditionImmunities: [],
    traits: race.traits,
    attacks: [],
    saveActions: [],
    conditions: [],
    effects: [],
    deathSaves: { successes: 0, failures: 0 },
    stable: false,
    dead: false,
  };
  refreshAttacks(c);
  return c;
}

/** Recomputes attack options and AC after equipment changes. */
export function refreshAttacks(c: Creature): void {
  if (!c.pc) return;
  const pc = c.pc;
  const magic = pc.gear?.weapon ? getGear(pc.gear.weapon) : undefined;
  const weaponIds = magic?.base && !pc.weaponIds.includes(magic.base) ? [magic.base, ...pc.weaponIds] : pc.weaponIds;
  c.attacks = [
    ...weaponIds.map((w) => {
      const a = weaponAttack({ ...c, pc }, w);
      if (magic && magic.base === w) {
        // The magic weapon: +1 to hit and damage, counts as magical.
        a.toHit.push({ label: magic.name, value: magic.bonus, glossarKey: "ausruestung" });
        a.damageBonus.push({ label: magic.name, value: magic.bonus, glossarKey: "ausruestung" });
        a.magical = true;
        // Elemental weapons: +1d4 of their element.
        if (magic.element) a.damage = [...a.damage, { dice: "1d4", type: magic.element }];
      }
      return a;
    }),
    unarmedStrike(c),
  ];
  c.baseAc = armorClassParts(c.abilities, pc);
  const trinket = pc.gear?.trinket ? getGear(pc.gear.trinket) : undefined;
  // Elemental arrowheads: ranged weapon hits +1d4 of the element.
  if (trinket?.effect === "arrows" && trinket.element)
    for (const a of c.attacks) if (a.kind === "ranged" && a.source === "weapon") a.damage = [...a.damage, { dice: "1d4", type: trinket.element }];
  // Protective armour and amulets: the race's resistances plus theirs.
  const armor = pc.gear?.armor ? getGear(pc.gear.armor) : undefined;
  c.resistances = [...new Set([...getRace(pc.raceId).resistances, ...[armor?.resist, trinket?.resist].filter((t): t is DamageType => !!t)])];
  c.speedFt =
    getRace(pc.raceId).speedFt +
    (trinket?.effect === "speed" ? trinket.bonus : 0) +
    (pc.talents?.includes("flink") ? 10 : 0) +
    // Monk: Unarmored Movement (+10 ft from level 2, without armour and shield).
    (pc.classId === "monk" && pc.level >= 2 && !pc.armorId && !pc.gear?.armor && !pc.shield ? 10 : 0);
}

/**
 * Gives a fresh character the equipment of an earlier adventure (hero book): owned pieces and
 * what was worn, if the class can use it. The figure's look follows the worn pieces.
 */
export function applyGear(c: Creature, gear: { owned: string[]; weapon?: string; armor?: string; trinket?: string }): void {
  if (!c.pc) return;
  c.pc.gear = { owned: [...gear.owned] };
  for (const slot of ["weapon", "armor", "trinket"] as const) {
    const id = gear[slot];
    const g = id ? getGear(id) : undefined;
    if (!id || !g || gearProblem(c, id)) continue;
    c.pc.gear[slot] = id;
    if (g.effect === "hp") {
      c.maxHp += g.bonus;
      c.hp += g.bonus;
    }
    if (g.doll && c.appearance) {
      const look = c.appearance.look as Record<string, string | undefined>;
      const before = (c.pc.gear.lookBefore ??= {});
      before[g.doll.layer] = look[g.doll.layer];
      look[g.doll.layer] = g.doll.id;
    }
  }
  refreshAttacks(c);
}

/** Why a hero can't use a piece of equipment (undefined = fine). */
export function gearProblem(c: Creature, gearId: string): string | undefined {
  const g = getGear(gearId);
  const pc = c.pc;
  if (!g || !pc) return "Unbekannter Gegenstand.";
  if (g.slot === "weapon" && g.base && !isProficientWithWeapon(pc, getWeapon(g.base))) return `${c.name} kann mit dieser Waffe nicht umgehen.`;
  if (g.slot === "armor" && g.base) {
    const cat = getArmor(g.base).category;
    if (!getClass(pc.classId).armor.includes(cat)) return `${c.name} kann diese Rüstung nicht tragen.`;
  }
  return undefined;
}

/** Pregenerated start characters: one per class and level. */
export function pregenCharacter(classId: string, level = 1, id = `pregen-${classId}`): Creature {
  const PREGEN: Record<string, { name: string; race: string }> = {
    fighter: { name: "Brunhild", race: "human" },
    paladin: { name: "Siegfried", race: "human" },
    wizard: { name: "Ilmarin", race: "elf" },
    rogue: { name: "Pip", race: "halfling" },
    cleric: { name: "Thorgrim", race: "dwarf" },
    bard: { name: "Liesel", race: "human" },
    ranger: { name: "Falk", race: "elf" },
    druid: { name: "Eibe", race: "halfling" },
    monk: { name: "Kian", race: "human" },
  };
  const p = PREGEN[classId];
  if (!p) throw new Error(`no pregen for ${classId}`);
  return createCharacter({ id, name: p.name, classId, raceId: p.race, level });
}

// ---------------------------------------------------------------- monsters

function splitDice(dice: string): { dice: string; flat: number } {
  const m = /^(.*?d\d+)([+-]\d+)?$/.exec(dice);
  if (!m) return { dice, flat: 0 };
  return { dice: m[1]!, flat: Number(m[2] ?? 0) };
}

export function createMonster(monsterId: string, id: string, opts: { name?: string; side?: Side } = {}): Creature {
  const m = getMonster(monsterId);
  const attacks: AttackOption[] = [];
  const saveActions: SaveAction[] = [];
  for (const a of m.actions) {
    if (a.kind === "save") {
      saveActions.push({
        id: a.id,
        damage: a.damage,
        save: a.save!,
        ...(a.area ? { area: a.area } : {}),
        ...(a.recharge ? { recharge: a.recharge } : {}),
        available: true,
      });
      continue;
    }
    const [first, ...rest] = a.damage;
    const split = splitDice(first!.dice);
    attacks.push({
      id: a.id,
      sourceId: a.id,
      source: "monster",
      kind: a.kind,
      toHit: [{ label: "Angriffsbonus", value: a.attackBonus ?? 0, glossarKey: "angriffsbonus" }],
      damage: [{ dice: split.dice, type: first!.type }, ...rest],
      damageBonus: split.flat ? [{ label: "Bonus", value: split.flat, glossarKey: "schaden" }] : [],
      // Reach 0 (swarms attack in their own space) counts as the neighbouring square here.
      reachFt: a.kind === "melee" ? a.reachFt || 5 : 0,
      ...(a.rangeFt ? { rangeFt: a.rangeFt } : {}),
      ...(a.kind === "melee" && a.rangeFt ? { thrown: true } : {}),
    });
  }
  const c: Creature = {
    id,
    name: opts.name ?? nameOf("monsters", m.id),
    kind: "monster",
    side: opts.side ?? "enemy",
    monsterId: m.id,
    size: m.size,
    creatureType: m.type,
    abilities: { ...m.abilities },
    proficiencyBonus: m.proficiencyBonus,
    saveBonuses: m.saves,
    skillBonuses: m.skills,
    baseAc: [{ label: "Rüstungsklasse", value: m.ac, glossarKey: "ruestungsklasse" }],
    maxHp: m.hp,
    hp: m.hp,
    tempHp: 0,
    speedFt: m.speedFt.walk || m.speedFt.fly || 0,
    darkvisionFt: m.darkvisionFt,
    resistances: m.resistances,
    immunities: m.immunities,
    vulnerabilities: m.vulnerabilities,
    resistsNonmagical: m.resistsNonmagical,
    immuneNonmagical: m.immuneNonmagical,
    conditionImmunities: m.conditionImmunities,
    traits: m.traits,
    attacks,
    ...(m.multiattack ? { multiattack: m.multiattack } : {}),
    saveActions,
    conditions: [],
    effects: [],
    deathSaves: { successes: 0, failures: 0 },
    stable: false,
    dead: false,
  };
  // Strengths and weaknesses like in Pokémon (src/engine/types.ts).
  applyTypeChart(c);
  return c;
}

/**
 * Makes a monster fit the difficulty: more or fewer hit points, a better or worse aim, harder hits.
 * The changes show up in the breakdown ("Schwierigkeit +1"), so nothing is hidden.
 */
export function hardenMonster(c: Creature, rules: { hp: number; attack: number; damage: number }): void {
  if (rules.hp !== 1) {
    c.maxHp = Math.max(1, Math.round(c.maxHp * rules.hp));
    c.hp = c.maxHp;
  }
  for (const a of c.attacks) {
    if (rules.attack) a.toHit = [...a.toHit, { label: "Schwierigkeit", value: rules.attack, glossarKey: "schwierigkeit" }];
    if (rules.damage) a.damageBonus = [...a.damageBonus, { label: "Schwierigkeit", value: rules.damage, glossarKey: "schwierigkeit" }];
  }
}
