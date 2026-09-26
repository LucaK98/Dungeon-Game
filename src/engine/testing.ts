/** Helpers for engine tests. */
import type { Battle, Creature } from "../shared/game";

export function battleOf(...creatures: [Creature, number, number][]): Battle {
  const battle: Battle = { creatures: {} };
  for (const [c, x, y] of creatures) {
    c.pos = { x, y };
    battle.creatures[c.id] = c;
  }
  return battle;
}
