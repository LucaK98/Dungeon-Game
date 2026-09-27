/**
 * Runtime game state shared between host, engine and (as snapshots) the phones.
 * Everything here is plain JSON so it can be sent over the network.
 */
import type {
  AbilityScores,
  ConditionId,
  DamagePart,
  DamageType,
  Size,
  SkillId,
} from "./rules";
import type { DollLook } from "./doll";
import type { Ability, BreakdownPart, PlayerId } from "./types";

export interface GridPos {
  x: number;
  y: number;
}

export type Side = "party" | "enemy" | "neutral";

export type FightingStyle = "defense" | "dueling";

/** Limited-use features ("Second Wind", "Lay on Hands" pool, …). */
export interface Resource {
  used: number;
  max: number;
  /** When it comes back. */
  recharge: "short" | "long";
}

export interface PcInfo {
  classId: string;
  raceId: string;
  level: number;
  features: string[];
  fightingStyle?: FightingStyle;
  saveProficiencies: Ability[];
  skillProficiencies: SkillId[];
  expertise: SkillId[];
  armorId?: string;
  shield: boolean;
  weaponIds: string[];
  inventory: { itemId: string; qty: number }[];
  /** Found or bought equipment (src/data/gear.ts) and what is worn. */
  gear?: {
    owned: string[];
    weapon?: string;
    armor?: string;
    trinket?: string;
    /** How the figure looked before magic gear changed it (per doll layer). */
    lookBefore?: Record<string, string | undefined>;
  };
  /** Spell IDs the character can cast (cantrips included). */
  spells: string[];
  /** Index = spell level - 1. */
  spellSlots: number[];
  spellSlotsMax: number[];
  resources: Record<string, Resource>;
  hitDie: number;
}

export interface ActiveCondition {
  id: ConditionId;
  /** Remaining rounds; undefined = until removed. */
  rounds?: number;
  sourceId?: string;
  /** Sleep ends when the creature takes damage. */
  endsOnDamage?: boolean;
}

export type EffectId =
  | "bless"
  | "shield-of-faith"
  | "divine-favor"
  | "guiding-bolt"
  | "ray-of-frost"
  | "dodge"
  | "disengage"
  | "turned"
  /** Carries a burning torch: bright light around (night scenes). */
  | "torch"
  /** Tricked by a free action: the next attack against it has advantage. */
  | "distracted"
  /** A friend helps: advantage on the next attack or check. */
  | "helped"
  /** Disarmed, blinded, tangled up: its attacks have disadvantage. */
  | "hampered"
  /** Behind cover: +2 armour class. */
  | "cover"
  /** Angered by a failed trick: advantage on its next attack. */
  | "enraged"
  /** Has not noticed the heroes yet: sleeping … */
  | "asleep"
  /** … or keeping watch and walking up and down. */
  | "on-guard"
  /** Caught off guard when the fight starts: loses its first turn. */
  | "surprised";

export interface ActiveEffect {
  id: EffectId;
  rounds: number;
  sourceId: string;
}

/** One way to attack: a weapon of a PC or an action of a monster. */
export interface AttackOption {
  id: string;
  /** Weapon or monster action ID, for names and glossary. */
  sourceId: string;
  source: "weapon" | "monster" | "unarmed" | "spell";
  kind: "melee" | "ranged";
  toHit: BreakdownPart[];
  damage: DamagePart[];
  damageBonus: BreakdownPart[];
  reachFt: number;
  rangeFt?: { normal: number; long?: number };
  finesse?: boolean;
  magical?: boolean;
  /** Weapon can also be thrown (dagger, handaxe, javelin). */
  thrown?: boolean;
}

export interface SaveAction {
  id: string;
  damage: DamagePart[];
  save: { ability: Ability; dc: number; onSuccess: "half" | "none" };
  area?: { shape: "cone" | "sphere" | "line"; sizeFt: number };
  recharge?: number;
  available: boolean;
}

export interface Creature {
  id: string;
  name: string;
  kind: "pc" | "monster";
  side: Side;
  /** SRD monster ID (monsters only). */
  monsterId?: string;
  /** Character sheet data (player characters only). */
  pc?: PcInfo;
  size: Size;
  creatureType: string;
  abilities: AbilityScores;
  proficiencyBonus: number;
  /** Monsters: fixed bonuses from the stat block. */
  saveBonuses?: Partial<Record<Ability, number>>;
  skillBonuses?: Partial<Record<SkillId, number>>;
  baseAc: BreakdownPart[];
  maxHp: number;
  hp: number;
  tempHp: number;
  speedFt: number;
  darkvisionFt: number;
  resistances: DamageType[];
  immunities: DamageType[];
  vulnerabilities: DamageType[];
  resistsNonmagical: boolean;
  immuneNonmagical: boolean;
  conditionImmunities: ConditionId[];
  traits: string[];
  attacks: AttackOption[];
  multiattack?: string[];
  saveActions: SaveAction[];
  conditions: ActiveCondition[];
  effects: ActiveEffect[];
  concentration?: string;
  deathSaves: { successes: number; failures: number };
  stable: boolean;
  dead: boolean;
  pos?: GridPos;
  /** Heroes: which phone controls them and how they look. */
  playerId?: PlayerId;
  appearance?: { look: DollLook; color: string };
}

export interface D20Roll {
  /** All dice rolled (two with advantage/disadvantage). */
  rolls: number[];
  natural: number;
  mode: "normal" | "advantage" | "disadvantage";
  /** Why advantage/disadvantage applies (for the help system). */
  reasons: { text: string; glossarKey: string; effect: "advantage" | "disadvantage" }[];
}

export interface CheckResult {
  kind: "check" | "save";
  ability: Ability;
  skill?: SkillId;
  roll: D20Roll;
  parts: BreakdownPart[];
  total: number;
  dc: number;
  success: boolean;
}

export interface DamageLine {
  type: DamageType;
  dice: number[];
  parts: BreakdownPart[];
  /** Sum before resistances. */
  raw: number;
  /** After resistance/immunity/vulnerability. */
  final: number;
  note?: "resistance" | "immunity" | "vulnerability";
}

export interface DamageResult {
  lines: DamageLine[];
  total: number;
  crit: boolean;
}

export interface HpChange {
  targetId: string;
  before: number;
  after: number;
  tempAbsorbed: number;
  downed: boolean;
  killed: boolean;
  /** Damage while already at 0 HP → failed death saves. */
  deathSaveFailures: number;
  wokeUp: boolean;
  /** Zombie: "Undead Fortitude" kept it at 1 HP. */
  survived?: CheckResult;
  /** Concentration check caused by the damage. */
  concentration?: { spellId: string; check: CheckResult; lost: boolean };
}

export interface DeathSaveResult {
  creatureId: string;
  roll: D20Roll;
  success: boolean;
  successes: number;
  failures: number;
  outcome: "continue" | "stable" | "dead" | "revived";
}

export interface AttackResult {
  type: "attack";
  attackerId: string;
  targetId: string;
  optionId: string;
  roll: D20Roll;
  parts: BreakdownPart[];
  total: number;
  targetAc: number;
  acParts: BreakdownPart[];
  hit: boolean;
  crit: boolean;
  damage?: DamageResult;
  hp?: HpChange;
}

export interface TurnState {
  creatureId: string;
  movementLeftFt: number;
  actions: number;
  bonusAction: boolean;
  /** Rogue sneak attack / smite: once per turn. */
  sneakAttackUsed: boolean;
  attacksLeft: number;
}

export interface InitiativeEntry {
  creatureId: string;
  total: number;
  parts: BreakdownPart[];
  roll: D20Roll;
}

export interface CombatState {
  round: number;
  order: InitiativeEntry[];
  turnIndex: number;
  turn: TurnState;
  /** Reaction used this round, by creature ID. */
  reactionUsed: Record<string, boolean>;
}

export interface Battle {
  creatures: Record<string, Creature>;
  combat?: CombatState;
  /** Set in night/dark scenes: only these places (and carried torches) are lit. */
  darkness?: { lights: LightSource[] };
}

export interface LightSource {
  x: number;
  y: number;
  radiusFt: number;
}

export interface SpellTargetResult {
  targetId: string;
  attack?: AttackResult;
  save?: CheckResult;
  damage?: DamageResult;
  heal?: { parts: BreakdownPart[]; total: number };
  hp?: HpChange;
  /** Effect or condition that now applies to the target. */
  applied?: EffectId | ConditionId;
  /** The spell had no effect (immune, too many hit points for Sleep, …). */
  unaffected?: string;
}

export interface SpellResult {
  type: "spell";
  casterId: string;
  spellId: string;
  slotLevel: number;
  dc?: { value: number; parts: BreakdownPart[] };
  /** Sleep: rolled hit point pool. */
  pool?: { parts: BreakdownPart[]; total: number };
  targets: SpellTargetResult[];
}
