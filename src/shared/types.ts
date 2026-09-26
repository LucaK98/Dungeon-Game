/** 4-character room code, alphabet without 0/O/1/I (see A2). */
export type RoomCode = string;

/** Stable per-device ID, kept in localStorage on the phone (see A2). */
export type PlayerId = string;

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  /** Filled in during character creation (A2). */
  classId?: string;
  raceId?: string;
  color?: string;
  ready?: boolean;
}

export type Ability = "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";

/** One line of a calculation, so the help system can explain every roll. */
export interface BreakdownPart {
  label: string;
  value: number;
  glossarKey?: string;
}
