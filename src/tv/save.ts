/** Save point of a long game, kept in the TV's localStorage (Teil A). */
import type { StoryState } from "../dm/director";
import type { Creature } from "../shared/game";
import type { LobbyPlayer } from "../shared/lobby";

const KEY = "couch-dungeon.save";

export interface SaveGame {
  savedAt: number;
  state: StoryState;
  heroes: Creature[];
  players: LobbyPlayer[];
}

export function writeSave(save: SaveGame): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage full or blocked: the game goes on without a save point.
  }
}

export function readSave(): SaveGame | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SaveGame) : undefined;
  } catch {
    return undefined;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
