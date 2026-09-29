/**
 * The characters' memory, kept on this TV (like the home village and the saga).
 */
import { emptyWorld, type NpcWorld } from "../dm/npc-world";

const KEY = "couch-dungeon.npc-world";

export function loadNpcWorld(): NpcWorld {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as NpcWorld | null;
    return raw && raw.version === 1 && raw.npcs ? raw : emptyWorld();
  } catch {
    return emptyWorld();
  }
}

export function saveNpcWorld(world: NpcWorld): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(world));
  } catch {
    // Private mode: the memory lasts for this page only.
  }
}
