/**
 * Light and sight (SRD, simplified for beginners): in a dark scene a creature only sees what
 * is lit (torches on the map, a carried torch) or within its darkvision. Attacking something
 * you cannot see gives disadvantage; attacking someone who cannot see you gives advantage.
 * In normal scenes (no `battle.darkness`) everything is visible.
 */
import type { Battle, Creature, GridPos } from "../shared/game";
import { distanceFt, hasEffect } from "./combat";

/** A burning torch: bright light in a 20 ft (6 m) radius. */
export const TORCH_FT = 20;

function feetBetween(a: GridPos, b: GridPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
}

/** Is this square lit? */
export function isLit(battle: Battle, pos: GridPos): boolean {
  if (!battle.darkness) return true;
  if (battle.darkness.lights.some((l) => feetBetween(l, pos) <= l.radiusFt)) return true;
  return Object.values(battle.creatures).some((c) => c.pos && !c.dead && hasEffect(c, "torch") && feetBetween(c.pos, pos) <= TORCH_FT);
}

/** Can `viewer` see `target`? (lit, or within darkvision) */
export function canSee(battle: Battle, viewer: Creature, target: Creature): boolean {
  if (!battle.darkness || !target.pos) return true;
  if (isLit(battle, target.pos)) return true;
  return viewer.darkvisionFt > 0 && distanceFt(viewer, target) <= viewer.darkvisionFt;
}
