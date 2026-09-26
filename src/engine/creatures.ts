/**
 * Builds creatures: player characters (with pregenerated defaults per class) and monsters.
 */
import type { AttackOption, Creature, FightingStyle, PcInfo, Resource, SaveAction, Side } from "../shared/game";
import type { AbilityScores, DamagePart, SkillId, WeaponDef } from "../shared/rules";
import { ABILITIES } from "../shared/rules";
import type { Ability, BreakdownPart } from "../shared/types";
import { ABILITY_GLOSSAR, abilityMod, modPart, profPart } from "./core";
import { getArmor, getClass, getMonster, getRace, getWeapon } from "./data";
import { nameOf } from "./names";

// ---------------------------------------------------------------- class defaults

/** Standard array (15, 14, 13, 12, 10, 8) sorted by what each class needs most. */
const ABILITY_PRIORITY: Record<string, Ability[]> = {
  fighter: ["STR", "CON", "DEX", "WIS", "CHA", "INT"],
  paladin: ["STR", "CHA", "CON", "WIS", "DEX", "INT"],
  wizard: ["INT", "CON", "DEX", "WIS", "CHA", "STR"],
  rogue: ["DEX", "CON", "CHA", "WIS", "INT", "STR"],
  cleric: ["WIS", "CON", "STR", "CHA", "DEX", "INT"],
};
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

interface Loadout {
  armor?: string;
  shield: boolean;
  weapons: string[];
  skills: SkillId[];
  expertise?: SkillId[];
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
    spells: [[1, ["sacred-flame", "cure-wounds", "healing-word", "bless", "guiding-bolt", "shield-of-faith"]]],
  },
};

/** Which classes we recommend to complete beginners. */
export const BEGINNER_CLASSES = ["fighter", "paladin"];

export const PLAYABLE_CLASSES = Object.keys(LOADOUTS);

// ---------------------------------------------------------------- helpers

function isProficientWithWeapon(pc: Pick<PcInfo, "classId" | "raceId">, w: WeaponDef): boolean {
  const cls = getClass(pc.classId);
  if (cls.weapons.includes(w.category)) return true;
  if (pc.raceId === "elf" && ["longsword", "shortsword", "shortbow", "longbow"].includes(w.id)) return true;
  if (pc.raceId === "dwarf" && ["battleaxe", "handaxe", "warhammer"].includes(w.id)) return true;
  if (pc.classId === "rogue" && ["longsword", "rapier", "shortsword"].includes(w.id)) return true;
  if (pc.classId === "wizard" && ["dagger", "quarterstaff", "crossbow-light"].includes(w.id)) return true;
  return false;
}

export function weaponAttack(c: Pick<Creature, "abilities" | "proficiencyBonus"> & { pc: PcInfo }, weaponId: string): AttackOption {
  const w = getWeapon(weaponId);
  const finesse = w.properties.includes("finesse");
  const thrown = w.properties.includes("thrown");
  const str = abilityMod(c.abilities.STR);
  const dex = abilityMod(c.abilities.DEX);
  const ability: Ability = w.ranged ? "DEX" : finesse && dex > str ? "DEX" : "STR";
  const mod = modPart(c as Creature, ability);
  const toHit: BreakdownPart[] = [mod];
  if (isProficientWithWeapon(c.pc, w)) toHit.push(profPart(c.proficiencyBonus));

  const twoHanded = !c.pc.shield && w.versatileDice;
  const damage: DamagePart[] = [{ dice: twoHanded ? w.versatileDice! : w.damage.dice, type: w.damage.type }];
  const damageBonus: BreakdownPart[] = [mod];
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
  const mod = modPart(c, "STR");
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
export function armorClassParts(abilities: AbilityScores, pc: Pick<PcInfo, "armorId" | "shield" | "fightingStyle">): BreakdownPart[] {
  const dex = abilityMod(abilities.DEX);
  const parts: BreakdownPart[] = [];
  if (pc.armorId) {
    const a = getArmor(pc.armorId);
    parts.push({ label: nameOf("armor", a.id), value: a.baseAc, glossarKey: "ruestung:" + a.id });
    if (a.dexBonus) {
      const v = a.maxDexBonus !== undefined ? Math.min(dex, a.maxDexBonus) : dex;
      parts.push({ label: "Geschicklichkeit", value: v, glossarKey: ABILITY_GLOSSAR.DEX });
    }
  } else {
    parts.push({ label: "Grundwert", value: 10, glossarKey: "ruestungsklasse" });
    parts.push({ label: "Geschicklichkeit", value: dex, glossarKey: ABILITY_GLOSSAR.DEX });
  }
  if (pc.shield) parts.push({ label: "Schild", value: 2, glossarKey: "ruestung:shield" });
  if (pc.fightingStyle === "defense" && pc.armorId) {
    parts.push({ label: "Kampfstil Verteidigung", value: 1, glossarKey: "kampfstil" });
  }
  return parts;
}

function spellsFor(classId: string, raceId: string, level: number): string[] {
  const list = new Set<string>();
  for (const [from, ids] of LOADOUTS[classId]?.spells ?? []) if (level >= from) ids.forEach((s) => list.add(s));
  // High elves know one wizard cantrip (wizards already have ours).
  if (raceId === "elf") list.add("fire-bolt");
  return [...list];
}

function resourcesFor(classId: string, level: number): Record<string, Resource> {
  const r: Record<string, Resource> = {};
  if (classId === "fighter") {
    r["second-wind"] = { used: 0, max: 1, recharge: "short" };
    if (level >= 2) r["action-surge"] = { used: 0, max: 1, recharge: "short" };
  }
  if (classId === "paladin") r["lay-on-hands"] = { used: 0, max: 5 * level, recharge: "long" };
  if (classId === "cleric" && level >= 2) r["channel-divinity"] = { used: 0, max: 1, recharge: "short" };
  if (classId === "wizard") r["arcane-recovery"] = { used: 0, max: 1, recharge: "long" };
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
}

export function createCharacter(opts: CharacterOptions): Creature {
  const level = Math.min(3, Math.max(1, opts.level ?? 1));
  const cls = getClass(opts.classId);
  const race = getRace(opts.raceId);
  const loadout = LOADOUTS[opts.classId];
  if (!loadout) throw new Error(`class ${opts.classId} is not playable`);

  const base: AbilityScores =
    opts.baseAbilities ??
    (Object.fromEntries(ABILITY_PRIORITY[opts.classId]!.map((a, i) => [a, STANDARD_ARRAY[i]])) as AbilityScores);
  const abilities = { ...base };
  for (const a of ABILITIES) abilities[a] += race.abilityBonuses[a] ?? 0;

  const levelDef = cls.levels.find((l) => l.level === level)!;
  const conMod = abilityMod(abilities.CON);
  let maxHp = cls.hitDie + conMod + (level - 1) * (cls.hitDie / 2 + 1 + conMod);
  if (race.traits.includes("dwarven-toughness")) maxHp += level;

  const features = cls.levels.filter((l) => l.level <= level).flatMap((l) => l.features);
  if (opts.classId === "fighter" && level >= 3) features.push("improved-critical");
  if (opts.classId === "cleric") features.push("disciple-of-life");

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
    expertise: loadout.expertise ?? [],
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
    resources: resourcesFor(cls.id, level),
    hitDie: cls.hitDie,
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
  c.attacks = [...pc.weaponIds.map((w) => weaponAttack({ ...c, pc }, w)), unarmedStrike(c)];
  c.baseAc = armorClassParts(c.abilities, pc);
}

/** Pregenerated start characters: one per class and level. */
export function pregenCharacter(classId: string, level = 1, id = `pregen-${classId}`): Creature {
  const PREGEN: Record<string, { name: string; race: string }> = {
    fighter: { name: "Brunhild", race: "human" },
    paladin: { name: "Siegfried", race: "human" },
    wizard: { name: "Ilmarin", race: "elf" },
    rogue: { name: "Pip", race: "halfling" },
    cleric: { name: "Thorgrim", race: "dwarf" },
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
      reachFt: a.kind === "melee" ? (a.reachFt ?? 5) : 0,
      ...(a.rangeFt ? { rangeFt: a.rangeFt } : {}),
      ...(a.kind === "melee" && a.rangeFt ? { thrown: true } : {}),
    });
  }
  return {
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
}
