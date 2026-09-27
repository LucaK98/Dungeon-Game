/**
 * The map's furniture in the rules: difficult terrain (double movement), cover (AC bonus against attacks
 * from beyond it) and high ground (advantage for ranged attacks downwards).
 * The TV keeps battle.terrain up to date; without it everything is open floor.
 */
import type { Battle, Creature, GridPos } from "../shared/game";
import type { BreakdownPart } from "../shared/types";

const key = (p: GridPos) => `${p.x},${p.y}`;

/** Movement cost of stepping onto a square, in squares (1 or 2). */
export function stepCost(battle: Battle, p: GridPos): number {
  return battle.terrain?.difficult.includes(key(p)) ? 2 : 1;
}

export function pathCost(battle: Battle, path: GridPos[]): number {
  return path.reduce((s, p) => s + stepCost(battle, p), 0);
}

export function onHighGround(battle: Battle, p: GridPos | undefined): boolean {
  return !!p && !!battle.terrain?.high.includes(key(p));
}

export function isHazard(battle: Battle, p: GridPos): boolean {
  return !!battle.terrain?.hazard.includes(key(p));
}

/**
 * Cover for `target` against `attacker`: a cover square on the target's own square, or next to it
 * on the attacker's side (within 45°). Only against attacks from further away than the next square.
 */
export function coverBonus(battle: Battle, attacker: Creature, target: Creature): number {
  const cover = battle.terrain?.cover;
  if (!cover || !attacker.pos || !target.pos) return 0;
  const ax = attacker.pos.x - target.pos.x;
  const ay = attacker.pos.y - target.pos.y;
  if (Math.max(Math.abs(ax), Math.abs(ay)) <= 1) return 0;
  let best = cover[key(target.pos)] ?? 0;
  const len = Math.hypot(ax, ay);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const bonus = cover[`${target.pos.x + dx},${target.pos.y + dy}`];
      if (!bonus) continue;
      const cos = (dx * ax + dy * ay) / (Math.hypot(dx, dy) * len);
      if (cos >= 0.7) best = Math.max(best, bonus);
    }
  }
  return best;
}

export function coverParts(battle: Battle, attacker: Creature, target: Creature): BreakdownPart[] {
  const bonus = coverBonus(battle, attacker, target);
  if (!bonus) return [];
  return [{ label: bonus >= 5 ? "Volle Deckung (Möbel)" : "Deckung (Möbel)", value: bonus, glossarKey: "deckung" }];
}
