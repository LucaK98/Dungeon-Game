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
}

export interface MiniMap {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Frame per cell, "" = not explored yet. */
  frames: string[];
  overlays: (string | null)[];
  objects: { x: number; y: number; frame: string }[];
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
  targets?: { id: string; name: string; detail: string }[];
  /** How many targets to pick (magic missile: 3 darts, bless: up to 3). */
  pick?: { min: number; max: number; repeat: boolean };
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

export interface PlayerView {
  me: Creature;
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
}

export interface RollPrompt {
  id: string;
  /** "Angriff auf Goblin 1", "Probe auf Wahrnehmung" */
  title: string;
  sides: number;
  glossarKey: string;
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
