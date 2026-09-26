import type { CharacterProfile, LobbyState } from "./lobby";
import type { SkillId } from "./rules";
import type { Narration } from "./story";
import type { Ability, PlayerId } from "./types";
import type { PlayerView, RollOutcome, RollPrompt } from "./view";

export type FeatureId =
  | "second-wind"
  | "action-surge"
  | "lay-on-hands"
  | "turn-undead"
  | "dash"
  | "disengage"
  | "dodge"
  | "hide"
  | "stand-up";

/** Anything a phone can ask the host to do. The host validates everything. */
export type PlayerAction =
  | { kind: "move"; to: { x: number; y: number } }
  | { kind: "attack"; targetId: string; optionId: string; smiteSlot?: number }
  | { kind: "cast"; spellId: string; slotLevel?: number; targetIds: string[] }
  | { kind: "use_item"; itemId: string; targetId?: string }
  | { kind: "feature"; feature: FeatureId; targetId?: string; amount?: number; bonus?: boolean }
  | { kind: "check"; skill: SkillId }
  | { kind: "interact"; objectId: string }
  | { kind: "free_text"; text: string }
  /** "Was könnte ich tun?" – asks the game master for ideas (answered with "suggestions"). */
  | { kind: "suggest" }
  | { kind: "roll"; rollId: string }
  | { kind: "end_turn" }
  | { kind: "story_choice"; choiceId: string }
  | { kind: "set_beginner_mode"; on: boolean };

export interface RollRequest {
  playerId: PlayerId;
  ability: Ability;
  skill?: string;
  dc: number;
}

/** All network events, see "Events" in CLAUDE.md. */
export type GameEvent =
  | { type: "player_action"; action: PlayerAction }
  | { type: "state_update"; state: PlayerView }
  | { type: "request_roll"; prompt: RollPrompt }
  | { type: "roll_result"; result: RollOutcome }
  | { type: "action_error"; reason: string }
  | { type: "narration"; lines: Narration[] }
  | { type: "clue_found"; clueId: string }
  | { type: "secret_message"; text: string }
  // Lobby (A2)
  | { type: "lobby_profile"; profile: CharacterProfile | null; ready: boolean }
  | { type: "lobby_state"; lobby: LobbyState }
  | { type: "join_rejected"; reason: string }
  /** TV → one phone: ideas for a free action. */
  | { type: "suggestions"; ideas: string[] }
  /** TV → unknown phone during the game: heroes whose phone is gone and can be taken over. */
  | { type: "seat_offer"; seats: SeatOffer[] }
  /** Phone → TV: "I am this hero" (phone lost its stored ID, e.g. private tab or other browser). */
  | { type: "take_seat"; seatId: PlayerId };

export interface SeatOffer {
  id: PlayerId;
  name: string;
  classId: string;
  color: string;
}

export type GameEventType = GameEvent["type"];
