import type { PlayerAction, RollRequest } from "./events";
import type { PlayerId } from "./types";

/** What the DM gets to see. Kept small on purpose (token budget in A8). */
export interface DmContext {
  storyId: string;
  sceneId: string;
  players: { id: PlayerId; name: string }[];
  actingPlayer: PlayerId;
}

export type DmNext = "await_roll" | "await_action" | "start_combat" | "end_scene";

/** Shared by ScriptedDM (A6) and AiDM (A8). The host validates every field. */
export interface DmResponse {
  narration: string;
  npc_say?: { name: string; text: string };
  request_roll?: RollRequest;
  spawn?: { monster: string; count: number; zone: string }[];
  reveal_room?: string;
  reveal_clue?: string;
  reveal_twist?: boolean;
  npc_attitude?: { npc: string; change: number };
  trigger_event?: string;
  choose_ending?: string | null;
  next: DmNext;
}

export interface DungeonMaster {
  respond(ctx: DmContext, action: PlayerAction): Promise<DmResponse>;
}
