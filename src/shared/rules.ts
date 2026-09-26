/**
 * Types of the reduced SRD 5.1 data in src/data/srd/ (written by scripts/import-srd.ts).
 * IDs are the SRD indices ("goblin", "fire-bolt"); German names live in src/data/i18n/de.json.
 */
import type { Ability } from "./types";

export const ABILITIES: readonly Ability[] = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

export type AbilityScores = Record<Ability, number>;

export type DamageType =
  | "acid"
  | "bludgeoning"
  | "cold"
  | "fire"
  | "force"
  | "lightning"
  | "necrotic"
  | "piercing"
  | "poison"
  | "psychic"
  | "radiant"
  | "slashing"
  | "thunder";

export type ConditionId =
  | "blinded"
  | "charmed"
  | "frightened"
  | "grappled"
  | "incapacitated"
  | "invisible"
  | "paralyzed"
  | "poisoned"
  | "prone"
  | "restrained"
  | "stunned"
  | "unconscious";

export type SkillId =
  | "acrobatics"
  | "animal-handling"
  | "arcana"
  | "athletics"
  | "deception"
  | "history"
  | "insight"
  | "intimidation"
  | "investigation"
  | "medicine"
  | "nature"
  | "perception"
  | "performance"
  | "persuasion"
  | "religion"
  | "sleight-of-hand"
  | "stealth"
  | "survival";

export type Size = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";

/** Dice expression like "1d8+2", "3d4+3", "2d6" or "5". */
export type DiceExpr = string;

export interface SkillDef {
  id: SkillId;
  ability: Ability;
}

export interface DamagePart {
  dice: DiceExpr;
  type: DamageType;
}

export interface ClassLevelDef {
  level: number;
  proficiencyBonus: number;
  features: string[];
  /** Index = spell level - 1. */
  spellSlots: number[];
  cantripsKnown: number;
  /** Rogue only. */
  sneakAttackDice?: number;
}

export interface ClassDef {
  id: string;
  hitDie: number;
  saves: Ability[];
  armor: ("light" | "medium" | "heavy" | "shield")[];
  weapons: ("simple" | "martial")[];
  skillChoices: { count: number; from: SkillId[] };
  spellcastingAbility?: Ability;
  levels: ClassLevelDef[];
}

export interface RaceDef {
  id: string;
  /** SRD subrace used for this people, e.g. "hill-dwarf". */
  subrace?: string;
  speedFt: number;
  size: Size;
  abilityBonuses: Partial<AbilityScores>;
  traits: string[];
  darkvisionFt: number;
  skillProficiencies: SkillId[];
  resistances: DamageType[];
}

export type WeaponProperty =
  | "ammunition"
  | "finesse"
  | "heavy"
  | "light"
  | "loading"
  | "reach"
  | "thrown"
  | "two-handed"
  | "versatile";

export interface WeaponDef {
  id: string;
  category: "simple" | "martial";
  ranged: boolean;
  damage: DamagePart;
  versatileDice?: DiceExpr;
  properties: WeaponProperty[];
  /** Melee reach, or range for ranged/thrown weapons (normal/long). */
  rangeFt: { normal: number; long?: number };
  weight: number;
  magical?: boolean;
}

export interface ArmorDef {
  id: string;
  category: "light" | "medium" | "heavy" | "shield";
  baseAc: number;
  dexBonus: boolean;
  maxDexBonus?: number;
  strMinimum: number;
  stealthDisadvantage: boolean;
}

export interface ItemDef {
  id: string;
  kind: "potion" | "gear";
  /** Potions: healing dice. */
  heal?: DiceExpr;
}

export interface SpellDef {
  id: string;
  /** 0 = cantrip. */
  level: number;
  school: string;
  classes: string[];
  castingTime: "action" | "bonus" | "reaction";
  rangeFt: number | "self" | "touch";
  attack?: "melee" | "ranged";
  save?: { ability: Ability; onSuccess: "half" | "none" };
  /** Damage by character level (cantrips) or by slot level. */
  damage?: { type: DamageType; byCharLevel?: Record<string, DiceExpr>; bySlot?: Record<string, DiceExpr> };
  /** Sleep: hit point pool by slot level. */
  hpPool?: Record<string, DiceExpr>;
  /** Healing by slot level; "MOD" = spellcasting modifier. */
  heal?: Record<string, DiceExpr>;
  area?: { shape: "cone" | "cube" | "sphere" | "line" | "cylinder"; sizeFt: number };
  concentration: boolean;
  /** Duration in rounds (1 minute = 10 rounds); 0 = instantaneous. */
  durationRounds: number;
}

export interface MonsterAction {
  id: string;
  kind: "melee" | "ranged" | "save";
  attackBonus?: number;
  reachFt?: number;
  rangeFt?: { normal: number; long?: number };
  damage: DamagePart[];
  save?: { ability: Ability; dc: number; onSuccess: "half" | "none" };
  area?: { shape: "cone" | "sphere" | "line"; sizeFt: number };
  /** Recharge on d6 ≥ value (breath weapons). */
  recharge?: number;
}

export interface MonsterDef {
  id: string;
  size: Size;
  type: string;
  ac: number;
  hp: number;
  hitDice: DiceExpr;
  speedFt: { walk: number; fly?: number; swim?: number; climb?: number };
  abilities: AbilityScores;
  cr: number;
  xp: number;
  proficiencyBonus: number;
  saves: Partial<Record<Ability, number>>;
  skills: Partial<Record<SkillId, number>>;
  darkvisionFt: number;
  passivePerception: number;
  resistances: DamageType[];
  immunities: DamageType[];
  vulnerabilities: DamageType[];
  /** "bludgeoning, piercing and slashing from nonmagical attacks" */
  resistsNonmagical: boolean;
  immuneNonmagical: boolean;
  conditionImmunities: ConditionId[];
  actions: MonsterAction[];
  /** Action IDs the monster uses in one turn, e.g. ["bite", "claws"]. */
  multiattack?: string[];
  traits: string[];
}

export interface SrdData {
  skills: SkillDef[];
  classes: ClassDef[];
  races: RaceDef[];
  weapons: WeaponDef[];
  armor: ArmorDef[];
  items: ItemDef[];
  spells: SpellDef[];
  monsters: MonsterDef[];
  conditions: ConditionId[];
}
