import type { NetKind, Transport } from "../shared/transport";
import type { PlayerId, PlayerInfo } from "../shared/types";
import { LocalTransport } from "./local";
import { PeerTransport } from "./peer";
import { SupabaseTransport } from "./supabase";

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
      return new PeerTransport(newPlayerId);
    case "supabase":
      return new SupabaseTransport(newPlayerId);
  }
}
