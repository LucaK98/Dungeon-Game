/**
 * Messages between TV and phones, shared by all transports.
 * The TV (host) is the only one that answers; phones never talk to each other.
 */
import type { GameEvent } from "../shared/events";
import type { PlayerId, PlayerInfo } from "../shared/types";

export type Wire =
  /** Phone → host: join and heartbeat. `instance` is new on every page load. */
  | { t: "hello"; player: PlayerInfo; instance: string; claim?: boolean }
  | { t: "bye"; playerId: PlayerId; instance: string }
  /** Host → phone: this ID is in use by another open tab, pick a new one. */
  | { t: "id-taken"; instance: string }
  /** Host → phone: this seat was taken over by a newer page of the same player (reopened app). */
  | { t: "replaced"; instance: string }
  /** Host → all: who is here. */
  | { t: "presence"; players: PlayerInfo[] }
  /** Host → all: the TV (re)started, please say hello. */
  | { t: "host-hello" }
  | { t: "event"; from: PlayerId | "host"; to?: PlayerId; event: GameEvent };

export const HEARTBEAT_MS = 2000;
export const TIMEOUT_MS = 6000;

export function isWire(x: unknown): x is Wire {
  return typeof x === "object" && x !== null && typeof (x as { t?: unknown }).t === "string";
}
