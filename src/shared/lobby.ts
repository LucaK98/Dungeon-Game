import type { DollLook } from "./doll";
import type { PlayerId, RoomCode } from "./types";

export const MAX_PLAYERS = 4;

/** Everything a player chose on the phone. */
export interface CharacterProfile {
  name: string;
  classId: string;
  raceId: string;
  look: DollLook;
  color: string;
}

export interface LobbyPlayer {
  id: PlayerId;
  profile: CharacterProfile | null;
  ready: boolean;
  connected: boolean;
}

export interface LobbyState {
  room: RoomCode;
  phase: "lobby" | "playing";
  players: LobbyPlayer[];
}

/** Player colours: easy to tell apart on a TV, with names for the phone. */
export const PLAYER_COLORS: { id: string; label: string }[] = [
  { id: "#e6194b", label: "Rot" },
  { id: "#3cb44b", label: "Grün" },
  { id: "#4363d8", label: "Blau" },
  { id: "#ffe119", label: "Gelb" },
  { id: "#f58231", label: "Orange" },
  { id: "#911eb4", label: "Lila" },
  { id: "#42d4f4", label: "Türkis" },
  { id: "#f032e6", label: "Pink" },
];

export const NAME_MAX_LENGTH = 16;

export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
}
