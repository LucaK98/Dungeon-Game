/**
 * The Dungeon Master tells the story; the code does the maths.
 * ScriptedDM (A6) follows the story JSON with fixed rules, AiDM (A8) improvises.
 * Both return a DmResponse, which the host validates before applying anything.
 */
import type { RollRequest } from "./events";
import type { Duration, Narration } from "./story";
import type { PlayerId } from "./types";

/** What the DM gets to see. Kept small on purpose (token budget in A8). */
export interface DmContext {
  storyId: string;
  duration: Duration;
  /** The secret truth of this game (never sent to phones). */
  truth: string;
  sceneId: string;
  stepId?: string;
  sceneIndex: number;
  sceneCount: number;
  players: { id: PlayerId; name: string; classId: string; hp: number; maxHp: number }[];
  actingPlayer?: PlayerId;
  flags: string[];
  cluesFound: string[];
  twistRevealed: boolean;
  /** Minutes played / planned so far (tempo). */
  minutesPlayed: number;
  minutesPlanned: number;
  /** Hit points the heroes lost in this scene, relative to their maximum (0..n). */
  hardship: number;
  /** Set while a fight is running: the enemies still standing. */
  combat?: { enemies: { id: string; name: string; hp: number; maxHp: number; boss: boolean }[] };
  /** Where the acting hero stands and what is around (for ideas with the surroundings). */
  room?: { name: string; objects: string[] };
  /** Gold of the whole group (bribes cost gold). */
  gold?: number;
  /** Short memory of notable deeds, newest last. */
  chronicle?: string[];
  /** What the heroes told about themselves at the campfire. */
  tales?: string[];
  /** Attitude of story characters towards the group, −3 (hostile) … +3 (friendly). */
  attitudes?: Record<string, number>;
  eventsUsed: string[];
}

/** Moments in which the host asks the DM. */
export type DmTrigger =
  | { kind: "scene_start" }
  | { kind: "step_start" }
  | { kind: "step_done" }
  | { kind: "free_text"; text: string; playerId: PlayerId; heroName: string }
  /** The roll the DM asked for after a free action is done. */
  | { kind: "roll_result"; text: string; playerId: PlayerId; heroName: string; skill: string; dc: number; total: number; success: boolean }
  /** "Frag den Spielleiter": a rules question from one player, answered only to them. */
  | { kind: "rules_question"; question: string; playerId: PlayerId; heroName: string; glossary: { title: string; text: string }[]; hero: string }
  /** A player asks "Was könnte ich tun?" – answered with a few ideas, nothing happens yet. */
  | { kind: "suggest"; playerId: PlayerId; heroName: string }
  /** Nobody has done anything for a while: say something to get the group going. */
  | { kind: "idle"; seconds: number }
  | { kind: "scene_end" }
  /** The heroes rested at the campfire and told each other something about themselves. */
  | { kind: "campfire"; tales: { heroName: string; question: string; text: string }[] }
  | { kind: "story_end" };

export type DmNext = "await_roll" | "await_action" | "start_combat" | "end_scene";

/** Shared by ScriptedDM (A6) and AiDM (A8). The host validates every field. */
export interface DmResponse {
  narration: string;
  npc_say?: { name: string; text: string };
  /** Structured narration (scripted DM): several lines with speaker and beginner tips. */
  script?: Narration[];
  request_roll?: RollRequest;
  spawn?: { monster: string; count: number; zone: string }[];
  reveal_room?: string;
  reveal_clue?: string;
  reveal_twist?: boolean;
  npc_attitude?: { npc: string; change: number };
  trigger_event?: string;
  choose_ending?: string | null;
  set_flags?: string[];
  /** Real consequences of a free action, applied by the code (see src/dm/effects.ts). */
  effects?: DmEffect[];
  /** Answer to "suggest": short ideas for free actions. */
  ideas?: string[];
  /** Answer to "rules_question". */
  answer?: string;
  next: DmNext;
}

/**
 * What a free action can really do. The DM (AI or script) picks, the code checks and applies.
 * Targets are creature ids (enemies in a fight, heroes for help/first aid).
 */
export type DmEffect =
  // in a fight
  | { kind: "distract"; target: string }
  | { kind: "prone"; target: string }
  | { kind: "hamper"; target: string }
  | { kind: "help"; target: string }
  | { kind: "cover" }
  | { kind: "hazard"; target: string; severity: "leicht" | "mittel" | "schwer" }
  | { kind: "flee" }
  | { kind: "pacify"; target: string; how: "ergeben" | "bestechen" | "betoeren" }
  // outside a fight
  | { kind: "find"; item: "gold" | "trank" | "fackel" }
  | { kind: "first_aid"; target: string }
  | { kind: "open_door" }
  | { kind: "reveal" }
  // "yes, but": the acting hero pays a small price (1W4 damage, never knocked out)
  | { kind: "cost" }
  // setbacks after a clearly failed attempt
  | { kind: "exposed" }
  | { kind: "fall" }
  | { kind: "fumble" }
  | { kind: "hurt"; severity: "leicht" | "mittel" }
  | { kind: "lose_gold" }
  | { kind: "enrage"; target: string };

export interface DungeonMaster {
  respond(ctx: DmContext, trigger: DmTrigger): Promise<DmResponse>;
}
