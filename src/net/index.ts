import type { NetKind, Transport } from "../shared/transport";
import type { PlayerId, PlayerInfo } from "../shared/types";
import { LocalTransport } from "./local";

/** A transport plus the phone-side extras every implementation offers. */
export interface GameTransport extends Transport {
  readonly player?: PlayerInfo;
  updatePlayer(patch: Partial<PlayerInfo>): void;
}

export function createTransport(kind: NetKind, newPlayerId?: () => PlayerId): GameTransport {
  switch (kind) {
    case "local":
      return new LocalTransport(newPlayerId);
    case "peer":
    case "supabase":
      // PeerTransport arrives in A7, SupabaseTransport in B1.
      console.warn(`Transport "${kind}" gibt es noch nicht, nutze "local".`);
      return new LocalTransport(newPlayerId);
  }
}
