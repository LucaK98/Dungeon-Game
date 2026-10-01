/**
 * Fights that fit the group – the same rules for the game (spawnGroups) and the balance bench.
 *
 * The rule book's encounter maths (Dungeon Master's Guide): every fight has an XP budget that grows
 * with the number of heroes and their level; several foes count extra (they act more often). The
 * foes of a fight are made a little tougher or weaker until the fight lands on its target:
 * - the first fight of a story (and the beginners' adventure): easy to medium,
 * - an ordinary fight: between medium and hard,
 * - a boss: between hard and deadly.
 * A lone ogre against two heroes is softened, the same ogre against six grows. The numbers were
 * found with the bench (src/dm/balance.test.ts keeps every fight of every story in its band).
 */
import { getMonster } from "../engine/data";
import type { MonsterGroup } from "../shared/story";
import TABLE from "./balance-table.json";

export interface MonsterMod {
  hp: number;
  attack: number;
  damage: number;
}

export type EncounterKind = "tutorial" | "regular" | "boss";

/** XP thresholds per hero: easy, medium, hard, deadly (index = level). */
const THRESHOLDS: [number, number, number, number][] = [
  [25, 50, 75, 100],
  [25, 50, 75, 100],
  [50, 100, 150, 200],
  [75, 150, 225, 400],
  [125, 250, 375, 500],
  [250, 500, 750, 1100],
];

export const TUNING = {
  /** Where on the scale easy (0) – medium (1) – hard (2) – deadly (3) each kind of fight should land. */
  target: { tutorial: 0.5, regular: 3.0, boss: 4.0 } as Record<EncounterKind, number>,
  /** How the gap is closed: hit points × k^hpPow, to-hit and damage by log2(k). */
  hpPow: 0.6,
  attackPerDouble: 1,
  damagePerDouble: 1.5,
  /**
   * In the game the foes are this much softer than on the bench: the bench's heroes start every
   * fight fresh and play like tacticians, beginners on the couch carry wounds from fight to fight.
   */
  realism: 0.65,
  /** Rule-book EP from which a foe counts as strong (added for every second extra hero only). */
  strongXp: 200,
};

function xpOf(monster: string): number {
  try {
    return getMonster(monster).xp ?? 10;
  } catch {
    return 10;
  }
}

/** How many of this group come for this many heroes. */
export function groupCount(g: MonsterGroup, players: number): number {
  const strong = xpOf(g.monster) >= TUNING.strongXp;
  const extraHeroes = Math.max(0, players - 2);
  const extra = (strong ? Math.floor(extraHeroes / 2) : extraHeroes) * (g.perExtraPlayer ?? 0);
  const fewer = players < 2 && !g.boss && g.count > 1 ? 1 : 0;
  return Math.max(0, g.count + extra - fewer);
}

/** Who follows a boss that would otherwise stand alone (fitting the story: the piper calls rats …). */
const FOLLOWERS: Record<string, { monster: string; name: string }> = {
  ogre: { monster: "wolf", name: "Hungriger Wolf" },
  spy: { monster: "giant-rat", name: "Gerufene Ratte" },
  "werewolf-hybrid": { monster: "wolf", name: "Wolf des Rudels" },
  "red-dragon-wyrmling": { monster: "kobold", name: "Drachenkobold" },
};

/**
 * A lone boss against four or more heroes is over in no time, however tough: from the fourth hero on
 * it brings followers (one per hero beyond the third).
 */
export function entourage(groups: MonsterGroup[], players: number): MonsterGroup[] {
  const boss = groups.length === 1 && groups[0]!.boss ? groups[0]! : undefined;
  const follower = boss ? FOLLOWERS[boss.monster] : undefined;
  if (!follower || players < 4) return [];
  return [{ monster: follower.monster, count: players - 3, name: follower.name }];
}

/** The rule book's multiplier for several foes (small groups count harder, big ones easier). */
function crowd(count: number, players: number): number {
  const steps = [1, 1.5, 2, 2.5, 3, 4];
  let i = count <= 1 ? 0 : count === 2 ? 1 : count <= 6 ? 2 : count <= 10 ? 3 : count <= 14 ? 4 : 5;
  if (players < 3) i = Math.min(5, i + 1);
  else if (players >= 6) i = Math.max(0, i - 1);
  return steps[i]!;
}

/** The XP budget for this kind of fight (between two thresholds for fractional targets). */
function budget(kind: EncounterKind, players: number, level: number): number {
  const t = THRESHOLDS[Math.max(1, Math.min(5, Math.round(level)))]!;
  const at = TUNING.target[kind];
  // Past "deadly" the scale goes on in steps of that size (the bots and real groups play smarter than the book assumes).
  const per = at >= 3 ? t[3] * (1 + (at - 3)) : t[Math.floor(at)]! + (t[Math.floor(at) + 1]! - t[Math.floor(at)]!) * (at - Math.floor(at));
  return per * players;
}

/** How much tougher (k > 1) or weaker (k < 1) the foes of this fight should be. */
export function encounterFactor(monsters: string[], players: number, level: number, kind: EncounterKind): number {
  if (!monsters.length) return 1;
  const actual = monsters.reduce((s, m) => s + xpOf(m), 0) * crowd(monsters.length, players);
  return Math.max(0.35, Math.min(4, budget(kind, players, level) / actual));
}

/** k → a modifier for each foe. */
export function modFor(k: number): MonsterMod {
  const steps = Math.log2(k);
  return {
    hp: Math.max(0.4, Math.min(4, Math.pow(k, TUNING.hpPow))),
    attack: Math.max(-3, Math.min(4, Math.round(steps * TUNING.attackPerDouble))),
    damage: Math.max(-4, Math.min(5, Math.round(steps * TUNING.damagePerDouble))),
  };
}

/** The kind of a fight from its groups (the game also knows whether it is the first one). */
export function kindOf(groups: MonsterGroup[], first: boolean, gentle: boolean): EncounterKind {
  if (first || gentle) return "tutorial";
  return groups.some((g) => g.boss) ? "boss" : "regular";
}

/** The key of a fight in the table: its groups as written in the story. */
export function fightKey(groups: MonsterGroup[]): string {
  return JSON.stringify(groups.map((g) => [g.monster, g.count, g.perExtraPlayer ?? 0, g.boss ? 1 : 0]));
}

/**
 * How tough the foes of this fight should be: for the stories' fights the value the bench found
 * (src/dm/balance-table.json, per number of heroes and level), for anything else (random adventures) the rule book's maths.
 */
export function fightFactor(groups: MonsterGroup[], monsters: string[], players: number, level: number, kind: EncounterKind): number {
  const row = (TABLE as Record<string, Record<string, number>>)[`${kind}:${fightKey(groups)}`];
  const p = Math.max(1, Math.min(6, players));
  // The row has "players@level" entries: this level, or the nearest one the bench played.
  const near = row ? Object.keys(row).filter((key) => key.startsWith(`${p}@`)).sort((a, b) => Math.abs(Number(a.split("@")[1]) - level) - Math.abs(Number(b.split("@")[1]) - level))[0] : undefined;
  if (near) return row![near]!;
  // Fights the bench never played (world events, random adventures): the rule book's maths, but
  // only gently – it overrates many small foes and does not know how worn out the heroes are.
  return Math.max(0.5, Math.min(1.5, encounterFactor(monsters, players, level, kind)));
}
