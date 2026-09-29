/**
 * What the host sends to each phone: everything the controller needs to draw,
 * already filtered (no secrets, only what this player may see) and pre-validated.
 */
import type { PlayerAction } from "./events";
import type { Creature, GridPos } from "./game";
import type { DollLook } from "./doll";
import type { Narration } from "./story";

export interface ExplainedLine {
  text: string;
  glossarKeys: string[];
}

export interface MiniCreature {
  id: string;
  x: number;
  y: number;
  name: string;
  enemy: boolean;
  me: boolean;
  color?: string;
  look?: DollLook;
  monsterId?: string;
  /** 0..1 */
  health: number;
  down: boolean;
  /** Enemies: armour class, hit points and how dangerous they are for this hero. */
  ac?: number;
  hp?: number;
  maxHp?: number;
  danger?: "leicht" | "gefährlich" | "sehr gefährlich";
  /** Characters: how they feel about this hero (−10 … +10, in a word) and what they remember last. */
  bond?: number;
  mood?: string;
  memory?: string;
  /** Romance with this hero: 0 … 10 and in a word ("verliebt"). */
  love?: number;
  loveLabel?: string;
}

export interface MiniMap {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Frame per cell, "" = not explored yet. */
  frames: string[];
  overlays: (string | null)[];
  /** Floor decoration and puddles/oil/ice/fire per cell ("" = nothing; several joined with "|"). */
  ground?: string[];
  /**
   * What each cell means for the rules, one character per cell: "." nothing, "d" difficult ground,
   * "h" high place, "f" fire, "i" ice (slippery and difficult), "c" cover furniture.
   */
  marks?: string;
  /** name: what it is; use: what a hero could do with it once next to it ("Truhe öffnen"). */
  objects: { id: string; x: number; y: number; frame: string; name?: string; use?: string }[];
  creatures: MiniCreature[];
  /** Squares the player can walk to this turn. */
  reachable: GridPos[];
  /**
   * Night scenes only: what this hero can see, one character per cell:
   * "0" lit, "1" dim (own darkvision), "2" dark.
   */
  light?: string;
}

export type ActionGroup = "story" | "attack" | "spell" | "item" | "ability" | "look" | "free" | "end";

export interface ActionChoice {
  id: string;
  group: ActionGroup;
  label: string;
  /** Short explanation shown under the label. */
  detail: string;
  glossarKey: string;
  cost: "action" | "bonus" | "free";
  enabled: boolean;
  /** Why it is disabled, in beginner words. */
  reason?: string;
  recommended?: boolean;
  /** The action to send; targets are filled in by the phone when `targets` is set. */
  action: PlayerAction;
  targets?: { id: string; name: string; detail: string; /** Chance to hit this target (0..1). */ chance?: number }[];
  /** Best chance to hit among the targets (attacks and spell attacks), for "gute Chance" on the phone. */
  chance?: number;
  /** Average damage (or healing) of one use. */
  avg?: number;
  avgKind?: "damage" | "heal";
  /** How many targets to pick (magic missile: 3 darts, bless: up to 3). */
  pick?: { min: number; max: number; repeat: boolean };
  /** Group vote: who picked this so far, and whether it is my vote. */
  votes?: { names: string[]; mine: boolean };
  /** What the situation does to it right now ("💨 Anlauf +2", "⚠️ Nachteil: Gegner neben dir"). */
  edge?: { text: string; tone: "good" | "bad" };
}

export interface TurnInfo {
  activeId: string;
  activeName: string;
  activeColor?: string;
  mine: boolean;
  movementLeftFt: number;
  actions: number;
  bonusAction: boolean;
  /** Free exploration: everyone may act at the same time. */
  free?: boolean;
  /** Full movement of this hero (to show "① Bewegen" as done). */
  speedFt?: number;
  /** Exploring in turns: seconds until a silent player is skipped. */
  secondsLeft?: number;
  /** This hero is next after the active one. */
  nextUp?: boolean;
  /** The last move can still be taken back. */
  canUndo?: boolean;
}

export interface OrderEntry {
  id: string;
  name: string;
  initiative?: number;
  look?: DollLook;
  monsterId?: string;
  color?: string;
  enemy: boolean;
  health: number;
  active: boolean;
}

export interface CompanionView {
  icon: string;
  kind: string;
  name: string;
  trait: string;
  traitText: string;
  hp: number;
  maxHp: number;
  dead: boolean;
}

export interface PlayerView {
  me: Creature;
  /** The hero's tamed animal (if any). */
  companion?: CompanionView;
  mode: "explore" | "combat";
  round: number;
  turn: TurnInfo;
  order: OrderEntry[];
  roomName: string;
  minimap: MiniMap;
  choices: ActionChoice[];
  log: ExplainedLine[];
  /** Set when this phone has to roll now. */
  pendingRoll?: RollPrompt;
  beginnerMode: boolean;
  story?: StoryView;
  /** The other heroes (to hand things over). */
  party?: { id: string; name: string; color?: string }[];
  /** Rest at the campfire between chapters: tell something, shop, then go on. */
  camp?: CampView;
  /** This hero struck down the final boss: describe the blow! */
  finalBlow?: { boss: string };
  /** This hero's secret goal (only on this phone). */
  goal?: { icon: string; text: string; have: number; need: number; done: boolean; atEnd: boolean };
}

export interface ShopOffer {
  id: string;
  icon: string;
  name: string;
  detail: string;
  price: number;
  /** Why this hero cannot buy it right now (not enough gold, sold out). */
  blocked?: string;
  /** Equipment this hero cannot use well (still buyable, e.g. to give away). */
  warning?: string;
}

export interface CampView {
  /** The question for this hero at the fire. */
  question: string;
  told: boolean;
  done: boolean;
  gold: number;
  shop: ShopOffer[];
  tales: { name: string; color?: string; text: string }[];
  /** How many heroes are ready to go on. */
  ready: number;
  total: number;
}

export interface StoryView {
  title: string;
  /** "Kapitel 2 von 3 · Die Reise" */
  chapter: string;
  scene: string;
  goal: string;
  narration: Narration[];
  /** Story decisions anyone may take (group "story"). */
  choices: ActionChoice[];
  clues: { text: string }[];
  /** The scene's goal as a checklist: done steps ticked, the current one open, the rest only counted. */
  tasks?: { text: string; done: boolean }[];
  /** How many more tasks follow (not shown yet: no spoilers). */
  moreTasks?: number;
  /** A group vote is running: how many have voted, of how many. */
  vote?: { cast: number; total: number };
}

export interface RollPrompt {
  id: string;
  /** "Angriff auf Goblin 1", "Probe auf Wahrnehmung" */
  title: string;
  sides: number;
  glossarKey: string;
  /** What the die must show: at least `min` (target minus bonus). Only for W20 rolls against a number. */
  need?: RollNeed;
}

export interface RollNeed {
  /** "SG" for checks, "RK" for attacks. */
  label: "SG" | "RK";
  target: number;
  bonus: number;
  /** Lowest number on the die that makes it (2…20). */
  min: number;
}

/** The lowest die result that reaches the target with this bonus. */
export function rollNeed(label: "SG" | "RK", target: number, bonus: number): RollNeed {
  // Attacks: a 1 always misses, a 20 always hits.
  const raw = target - bonus;
  const min = label === "RK" ? Math.max(2, Math.min(20, raw)) : Math.max(1, Math.min(20, raw));
  return { label, target, bonus, min };
}

export interface RollOutcome {
  id: string;
  /** Who rolled (creature). */
  creatureId: string;
  playerId?: string;
  title: string;
  sides: number;
  /** The dice that landed (two with advantage/disadvantage). */
  dice: number[];
  /** The value that counts. */
  kept: number;
  lines: ExplainedLine[];
  success?: boolean;
  crit?: boolean;
  /** For the board: who lost or gained hit points. */
  hits?: { targetId: string; amount: number; heal?: boolean; crit?: boolean; miss?: boolean }[];
  /** For the board: what to animate (who does what to whom). */
  fx?: ActionFx[];
  /** What it did, in a few coloured points (damage red, healing green …). */
  bullets?: import("./bullets").Bullet[];
}

/** One animation on the board: a sword swing, an arrow, a fire bolt, healing light … */
export interface ActionFx {
  from: string;
  to: string[];
  kind: "melee" | "claw" | "arrow" | "bolt" | "stone" | "thrown" | "spell" | "breath" | "heal" | "buff" | "turn" | "sleep";
  /** Colour/look of magic: fire, cold, radiant, force, necrotic, poison. */
  element?: "fire" | "cold" | "radiant" | "force" | "necrotic" | "poison";
  /** Spells with their own look (magic missile darts, sacred flame from above, …). */
  spellId?: string;
  crit?: boolean;
  miss?: boolean;
}
