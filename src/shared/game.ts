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
import type { CompanionInfo, CompanionKind } from "./companions";

export interface GridPos {
  x: number;
  y: number;
}

export type Side = "party" | "enemy" | "neutral";

export type FightingStyle = "defense" | "dueling" | "archery";

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
  /** Adventures this hero already survived (hero book). */
  stories?: string[];
  /** Experience in this adventure: from defeated enemies (shared equally) and found clues. */
  xp?: number;
  /** Chapters finished in this adventure (one attribute point each). */
  chapters?: number;
  /** Attribute points ("pt:DEX") and older level-4 choices (hero book), and the talents among them. */
  improvements?: string[];
  talents?: string[];
  /** Badges and running totals from the hero book. */
  badges?: string[];
  totals?: import("./achievements").HeroTotals;
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
  /** Climbed onto something high (free action): counts as a high place. */
  | "elevated"
  /** In disguise: waiting foes do not recognise this hero (until the hero attacks). */
  | "disguised"
  /** Talked into a quarrel: on its next turn it attacks the foe named by sourceId. */
  | "feud"
  /** Its weak spot is known: attacks against it have advantage. */
  | "weakspot"
  /** Small elemental states: burning (1d4 fire at the start of its turn), chilled (slower), shocked (no reaction), wet (lightning ×2, fire ×½). */
  | "burning"
  | "chilled"
  | "shocked"
  | "wet"
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
  | "surprised"
  /** Hunter's Mark: the ranger's weapon hits deal +1d6 against it. */
  | "hunters-mark"
  /** A druid in the shape of a wolf (bite attack, extra hit points). */
  | "wild-shape"
  /** Monk: Patient Defense (like dodging, as a bonus action). */
  | "patient-defense"
  /** Provoked: on its next turn it goes only for the hero named by sourceId. */
  | "taunted";

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
  appearance?: { look: DollLook; color: string; /** For romance: whom a character can fall for. */ gender?: "female" | "male" };
  /** A tamed animal: whose it is, its name and gift (src/shared/companions.ts). */
  companion?: CompanionInfo & { ownerId: string };
  /** A character who walks along with this hero (free action "folgen"). */
  followId?: string;
  /** A foe who gave up: a prisoner (let go, taken along or handed over). */
  captive?: boolean;
  /** Elemental variant (Feuerkobold, Frost-Skelett …, see engine/types.ts). */
  element?: "fire" | "frost" | "swamp" | "storm";
  /** A hero's teenage child along as squire (fights beside them, goes home when wounded). */
  squire?: { ownerId: string };
  /** A companion's target, commanded by its hero ("Bello, fass den Goblin!"). */
  focusId?: string;
  /** A stray animal on the map that could be tamed. */
  wild?: CompanionKind;
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
  /** The rogue halved the damage with their reaction. */
  uncannyDodge?: boolean;
  /** The monk caught part of a missile (damage reduced by this much). */
  deflected?: number;
  /** Stunning Strike (monk): the target's save and whether it is stunned. */
  stun?: { save: CheckResult; stunned: boolean; dc: number };
}

export interface TurnState {
  creatureId: string;
  movementLeftFt: number;
  actions: number;
  bonusAction: boolean;
  /** Rogue sneak attack / smite: once per turn. */
  sneakAttackUsed: boolean;
  attacksLeft: number;
  /** Took the Attack action this turn (monk bonus strikes need it). */
  attacked?: boolean;
  /** Feet walked this turn (a run-up makes melee hits harder). */
  movedFt?: number;
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
  /** What the map's furniture and ground mean for the rules (kept up to date by the TV). */
  terrain?: Terrain;
}

/** Squares as "x,y" keys. */
export interface Terrain {
  /** Costs double movement (bushes, rubble, webs, climbing a ledge, …). */
  difficult: string[];
  /** Furniture that shields whoever stands next to (or in) it: AC bonus against attacks from beyond it. */
  cover: Record<string, number>;
  /** Raised places: ranged attacks from up there against targets below have advantage. */
  high: string[];
  /** Burning or otherwise dangerous squares that monsters avoid. */
  hazard: string[];
  /** Tripwires set by the heroes: an enemy walking onto one stops there. */
  snares?: string[];
  /** Weather with rules (fog, wind) and the squares under open sky it applies to. */
  weather?: "fog" | "wind";
  outdoor?: string[];
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
