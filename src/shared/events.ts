import type { Ability, BreakdownPart, PlayerId } from "./types";

/** Anything a phone can ask the host to do. Extended in A4/A5. */
export type PlayerAction =
  | { kind: "move"; to: { x: number; y: number } }
  | { kind: "attack"; targetId: string }
  | { kind: "cast"; spellId: string; targetId?: string }
  | { kind: "use_item"; itemId: string; targetId?: string }
  | { kind: "free_text"; text: string }
  | { kind: "roll" };

export interface RollRequest {
  playerId: PlayerId;
  ability: Ability;
  skill?: string;
  dc: number;
}

export interface RollResult {
  playerId: PlayerId;
  total: number;
  breakdown: BreakdownPart[];
  success?: boolean;
}

/** All network events, see "Events" in CLAUDE.md. */
export type GameEvent =
  | { type: "player_action"; action: PlayerAction }
  | { type: "state_update"; state: unknown }
  | { type: "request_roll"; request: RollRequest }
  | { type: "roll_result"; result: RollResult }
  | { type: "narration"; text: string; npc?: { name: string; text: string } }
  | { type: "clue_found"; clueId: string }
  | { type: "secret_message"; text: string };

export type GameEventType = GameEvent["type"];
