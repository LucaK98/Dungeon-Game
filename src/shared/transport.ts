import type { GameEvent } from "./events";
import type { PlayerId, PlayerInfo, RoomCode } from "./types";

/**
 * Network layer. The game logic only talks to this interface so that
 * LocalTransport (A2), PeerTransport (A7) and SupabaseTransport (B1)
 * can be swapped without touching the rules.
 */
export interface Transport {
  /** TV only. `preferred` keeps the code across a reload of the TV. */
  createRoom(preferred?: RoomCode): Promise<RoomCode>;
  /** Phone only. */
  joinRoom(code: RoomCode, player: PlayerInfo): Promise<void>;
  /** Without `to` the event goes to everyone. */
  send(event: GameEvent, to?: PlayerId): void;
  onEvent(handler: (e: GameEvent, from: PlayerId | "host") => void): void;
  onPresence(handler: (players: PlayerInfo[]) => void): void;
  /** Phone only: connection to the TV lost / back. */
  onConnection?(handler: (connected: boolean) => void): void;
  close(): void;
}

export type NetKind = "local" | "peer" | "supabase";

export const NET_KINDS: readonly NetKind[] = ["local", "peer", "supabase"];
