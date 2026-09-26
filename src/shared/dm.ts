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
  | { kind: "scene_end" }
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
  next: DmNext;
}

export interface DungeonMaster {
  respond(ctx: DmContext, trigger: DmTrigger): Promise<DmResponse>;
}
