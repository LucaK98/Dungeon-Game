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
  | "stand-up"
  | "bardic-inspiration"
  | "wild-shape"
  | "martial-arts"
  | "flurry-of-blows"
  | "patient-defense"
  | "step-of-the-wind";

/** Anything a phone can ask the host to do. The host validates everything. */
export type PlayerAction =
  | { kind: "move"; to: { x: number; y: number } }
  | { kind: "attack"; targetId: string; optionId: string; smiteSlot?: number; stun?: boolean }
  | { kind: "cast"; spellId: string; slotLevel?: number; targetIds: string[] }
  | { kind: "use_item"; itemId: string; targetId?: string }
  | { kind: "feature"; feature: FeatureId; targetId?: string; amount?: number; bonus?: boolean }
  | { kind: "check"; skill: SkillId }
  | { kind: "interact"; objectId: string; targetId?: string; /** Props: which of their uses ("flip", "throw", "smash", …). */ use?: string }
  | { kind: "free_text"; text: string }
  /** "Was könnte ich tun?" – asks the game master for ideas (answered with "suggestions"). */
  | { kind: "suggest" }
  /** "Frag den Spielleiter": a rules question (answered with "rules_answer", only to this phone). */
  | { kind: "ask_rules"; question: string }
  | { kind: "roll"; rollId: string }
  | { kind: "end_turn" }
  | { kind: "story_choice"; choiceId: string }
  | { kind: "set_beginner_mode"; on: boolean }
  /** Equipment: put on, take off, hand to another hero. */
  | { kind: "equip"; gearId: string }
  | { kind: "unequip"; slot: "weapon" | "armor" | "trinket" }
  | { kind: "give_gear"; gearId: string; toId: string }
  /** A quick reaction (😂 😱 👏 …) that floats over the hero on the TV. */
  | { kind: "emote"; emoji: string }
  /** At the campfire: tell the others something, buy from the trader, ready to go on. */
  | { kind: "camp_tell"; text: string }
  | { kind: "camp_buy"; offerId: string }
  | { kind: "camp_done" }
  /** The hero who struck down the final boss describes the blow (empty = skip). */
  | { kind: "final_blow"; text: string };

/** The reactions a phone can send. */
export const EMOTES = ["😂", "😱", "👏", "❤️", "💀", "🔥", "🤔", "😡"] as const;

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
  /** TV → one phone: this hero goes into the hero book. */
  | { type: "hero_saved"; hero: import("./herobook").SavedHero }
  /** TV → all phones: the look back at the end of the adventure. */
  | { type: "recap"; recap: import("./recap").Recap }
  /** TV → one phone: this hero gained something (level, equipment, gold, an item). */
  | { type: "reward"; reward: import("./reward").Reward }
  /** TV → one phone: ideas for a free action. */
  | { type: "suggestions"; ideas: string[] }
  /** TV → one phone: the game master's answer to a rules question. */
  | { type: "rules_answer"; question: string; answer: string }
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
