/**
 * Balance test bench: every fight of every story, auto-played many times with 2, 4 and 6 heroes
 * at the level they will probably have there (experience from the fights and clues before),
 * with the difficulty's monster bonuses and the potions the heroes start with.
 * The bots play plainly (no tricks), so real groups do a little better than these numbers.
 */
import { seededRng } from "../engine/rng";
import { simulateBattle } from "../engine/simulate";
import { DIFFICULTY, type Difficulty } from "../shared/difficulty";
import { CLUE_XP, levelForXp, monsterXp } from "../shared/progression";
import type { MonsterGroup, Story } from "../shared/story";
import { entourage, fightFactor, groupCount, modFor, type MonsterMod } from "./encounter";

/** The target band of a fight, per kind (on "Normal"). */
export const BANDS = {
  /** The first fight of a story: learning how it works. */
  tutorial: { win: [0.95, 1], hpLoss: [0, 0.6] },
  /** An ordinary fight: you win almost always, but it costs something. */
  regular: { win: [0.85, 1], hpLoss: [0.1, 0.6] },
  /** A boss: real danger, but fair. */
  boss: { win: [0.65, 0.95], hpLoss: [0.3, 0.8] },
} as const;

export type FightKind = keyof typeof BANDS;

export interface StoryFight {
  story: string;
  scene: string;
  sceneIndex: number;
  groups: MonsterGroup[];
  kind: FightKind;
}

export interface BenchRow extends StoryFight {
  players: number;
  level: number;
  enemies: string[];
  win: number;
  hpLoss: number;
  rounds: number;
  downed: number;
}

/** The party for this many players (a typical mix). */
export const PARTY = ["fighter", "cleric", "wizard", "rogue", "ranger", "bard"];

/** Every fight of a story (training fights are left out – nobody gets hurt there). */
export function storyFights(story: Story): StoryFight[] {
  const out: StoryFight[] = [];
  const scenes = story.acts.flatMap((a) => a.scenes);
  scenes.forEach((scene, sceneIndex) => {
    const seen = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (!o || typeof o !== "object") return;
      const rec = o as Record<string, unknown>;
      const fight = rec.fight;
      if (Array.isArray(fight) && fight.length && typeof (fight[0] as MonsterGroup).monster === "string") {
        const groups = fight as MonsterGroup[];
        const key = JSON.stringify(groups);
        if (!groups.some((g) => g.training) && !seen.has(key)) {
          seen.add(key);
          // The first fight of a story, and every fight of the short beginners' adventure, is for learning.
          const kind: FightKind = out.length === 0 || /einstieg/i.test(story.subtitle ?? "") ? "tutorial" : groups.some((g) => g.boss) ? "boss" : "regular";
          out.push({ story: story.id, scene: scene.id, sceneIndex, groups, kind });
        }
      }
      for (const v of Object.values(rec)) walk(v);
    };
    walk(scene);
  });
  return out;
}

/** The monsters of a fight for this many players and difficulty, before fitting them to the group. */
export function fightList(groups: MonsterGroup[], players: number, difficulty: Difficulty): string[] {
  const rules = DIFFICULTY[difficulty];
  const extra = groups.some((g) => g.boss) && !rules.extraWithBoss ? 0 : rules.extraMonsters;
  return [...groups, ...entourage(groups, players)].flatMap((g) => Array.from({ length: groupCount(g, players) + (g.boss || !g.count ? 0 : extra) }, () => g.monster));
}

/** The monsters of a fight as the game spawns them (fitted to the group). */
export function fightMonsters(groups: MonsterGroup[], players: number, difficulty: Difficulty, level = 1, kind: FightKind = "regular"): { monster: string; mod: MonsterMod }[] {
  const list = fightList(groups, players, difficulty);
  const mod = modFor(fightFactor(groups, list, players, level, kind));
  return list.map((monster) => ({ monster, mod }));
}

/** Expected level at each fight: experience of the fights before (shared) plus one clue per scene. */
export function expectedLevels(fights: StoryFight[], players: number, difficulty: Difficulty): number[] {
  let xp = 0;
  let lastScene = -1;
  return fights.map((f) => {
    if (f.sceneIndex !== lastScene) {
      if (lastScene >= 0) xp += CLUE_XP;
      lastScene = f.sceneIndex;
    }
    const level = levelForXp(xp);
    xp += fightList(f.groups, players, difficulty).reduce((s, m) => s + monsterXp(m), 0) / players;
    return level;
  });
}

export interface FightResult {
  win: number;
  hpLoss: number;
  rounds: number;
  downed: number;
}

/** Plays one fight many times with the foes made k times as tough. */
export function runFight(enemies: string[], players: number, level: number, difficulty: Difficulty, k: number, seeds: number, salt = 0): FightResult {
  const rules = DIFFICULTY[difficulty];
  const heroes = Array.from({ length: players }, (_, i) => PARTY[i % PARTY.length]!);
  const mod = modFor(k);
  let wins = 0;
  let loss = 0;
  let rounds = 0;
  let downed = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = simulateBattle(seededRng(seed * 7919 + salt), { heroes, enemies, enemyMods: enemies.map(() => mod), level, potions: rules.potions, harden: rules });
    const party = Object.values(r.battle.creatures).filter((c) => c.side === "party");
    if (r.winner === "party") wins++;
    loss += 1 - party.reduce((sum, h) => sum + Math.max(0, h.hp), 0) / party.reduce((sum, h) => sum + h.maxHp, 0);
    rounds += r.rounds;
    downed += party.filter((h) => h.hp <= 0 || h.dead).length;
  }
  return { win: wins / seeds, hpLoss: loss / seeds, rounds: rounds / seeds, downed: downed / seeds };
}

/** What each kind of fight aims at (lost life, on average). */
const AIM: Record<FightKind, number> = { tutorial: 0.12, regular: 0.32, boss: 0.5 };

/**
 * The toughness that puts this fight into its band. Every k on a scale (weaker < 1 < tougher) is
 * played with the same dice; the curves are then smoothed (more toughness never means more wins or
 * less lost life) so a lucky point cannot win. Then: as tough as the aimed lost life asks, but softer
 * again while too few fights are won.
 */
export function solveFactor(enemies: string[], players: number, level: number, kind: FightKind, seeds = 40): number {
  const band = BANDS[kind];
  const at = (k: number) => runFight(enemies, players, level, "normal", k, seeds, 11);
  if (kind === "tutorial") {
    const base = at(1);
    if (base.win >= band.win[0] + 0.02 && base.hpLoss <= band.hpLoss[1]) return 1;
  }
  const ks: number[] = [];
  for (let k = 0.3; k <= 10.01; k *= 1.22) ks.push(k);
  const runs = ks.map(at);
  // Smoothing: a running mean of three, then monotone (wins fall, losses rise with k).
  const smooth = (xs: number[]) => xs.map((_, i) => (xs[Math.max(0, i - 1)]! + xs[i]! + xs[Math.min(xs.length - 1, i + 1)]!) / 3);
  const win = smooth(runs.map((r) => r.win));
  const loss = smooth(runs.map((r) => r.hpLoss));
  for (let i = 1; i < ks.length; i++) {
    win[i] = Math.min(win[i]!, win[i - 1]!);
    loss[i] = Math.max(loss[i]!, loss[i - 1]!);
  }
  let i = loss.findIndex((l) => l >= AIM[kind]);
  if (i < 0) i = ks.length - 1;
  // Bosses must not be won every time: tougher while (nearly) every fight is won.
  if (kind === "boss") while (i < ks.length - 1 && win[i]! > band.win[1] - 0.03) i++;
  // Some fights tip over quickly (an ogre against two heroes): keep a safe distance from the edge.
  const margin = kind === "boss" ? 0.1 : 0.06;
  while (i > 0 && win[i]! < band.win[0] + margin) i--;
  return Math.round(ks[i]! * 100) / 100;
}

export function benchStory(story: Story, players: number, difficulty: Difficulty = "normal", seeds = 60): BenchRow[] {
  const fights = storyFights(story);
  const levels = expectedLevels(fights, players, difficulty);
  return fights.map((f, i) => {
    const list = fightList(f.groups, players, difficulty);
    const k = fightFactor(f.groups, list, players, levels[i]!, f.kind);
    return { ...f, players, level: levels[i]!, enemies: list, ...runFight(list, players, levels[i]!, difficulty, k, seeds, i) };
  });
}

/** Outside its band? Returns a short reason, or undefined when the fight is fine. */
export function offBand(row: BenchRow): string | undefined {
  const band = BANDS[row.kind];
  if (row.win < band.win[0]) return `zu schwer (${Math.round(row.win * 100)} % Siege)`;
  if (row.win > band.win[1]) return `zu leicht (${Math.round(row.win * 100)} % Siege)`;
  if (row.hpLoss < band.hpLoss[0]) return `zu harmlos (nur ${Math.round(row.hpLoss * 100)} % Leben verloren)`;
  if (row.hpLoss > band.hpLoss[1]) return `zu blutig (${Math.round(row.hpLoss * 100)} % Leben verloren)`;
  return undefined;
}
