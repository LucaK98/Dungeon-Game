/**
 * Save game: kept in the TV's localStorage and, if online, also in the cloud (Supabase),
 * so the adventure can go on on another device with the save code.
 */
import type { StoryState } from "../dm/director";
import { cloudSave, type CloudId } from "../net/cloud-save";
import type { Creature } from "../shared/game";
import type { LobbyPlayer } from "../shared/lobby";

const KEY = "couch-dungeon.save";

export interface SaveGame {
  savedAt: number;
  state: StoryState;
  heroes: Creature[];
  players: LobbyPlayer[];
  /** Cloud copy: code to load it elsewhere, token to overwrite it (only on this device). */
  cloud?: CloudId;
}

/** Stores the save locally; with a cloud id also online. Resolves whether the cloud copy worked. */
export function writeSave(save: SaveGame): Promise<boolean> {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage full or blocked: the cloud copy may still work.
  }
  if (!save.cloud) return Promise.resolve(false);
  const { cloud, ...data } = save;
  return cloudSave(cloud, data);
}

export function readSave(): SaveGame | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SaveGame) : undefined;
  } catch {
    return undefined;
  }
}

/** A save loaded from the cloud: does it look like one of ours? */
export function isSaveGame(data: unknown): data is Omit<SaveGame, "cloud"> {
  const d = data as Partial<SaveGame> | undefined;
  return !!d && typeof d === "object" && !!d.state && typeof d.state.storyId === "string" && Array.isArray(d.heroes) && Array.isArray(d.players);
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
