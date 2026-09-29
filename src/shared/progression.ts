/**
 * Experience and levels – for one adventure. Every adventure starts at level 1 (gear, gold and potions
 * stay). EP come only from defeating enemies (the group shares them equally) and from finding clues –
 * nothing for dice rolls or talking. Each level and each finished chapter brings one attribute point.
 */
import { getMonster } from "../engine/data";

/** EP needed for each level (index = level): level 2 is earned in the first chapter, 4 and 5 only in long adventures. */
export const XP_FOR_LEVEL = [0, 0, 150, 400, 800, 1400];
export const TOP_LEVEL = XP_FOR_LEVEL.length - 1;

/** EP for every hero when the group finds a clue. */
export const CLUE_XP = 25;

export function levelForXp(xp: number): number {
  let level = 1;
  for (let l = 2; l <= TOP_LEVEL; l++) if (xp >= XP_FOR_LEVEL[l]!) level = l;
  return level;
}

/** EP a hero of this level starts with (older heroes from the hero book had no EP yet). */
export function xpForLevel(level: number): number {
  return XP_FOR_LEVEL[Math.max(1, Math.min(TOP_LEVEL, level))]!;
}

/** Progress to the next level: "120 / 300". */
export function xpProgress(xp: number): { level: number; from: number; to?: number } {
  const level = levelForXp(xp);
  return { level, from: XP_FOR_LEVEL[level]!, ...(level < TOP_LEVEL ? { to: XP_FOR_LEVEL[level + 1]! } : {}) };
}

/** What defeating this monster is worth for the whole group (rule-book EP; unknown monsters 10). */
export function monsterXp(monsterId: string | undefined): number {
  if (!monsterId) return 0;
  try {
    return getMonster(monsterId).xp ?? 10;
  } catch {
    return 10;
  }
}

/** Every hero gets the same share (rounded up, at least 1). */
export function shareXp(total: number, heroes: number): number {
  return heroes > 0 && total > 0 ? Math.max(1, Math.ceil(total / heroes)) : 0;
}
