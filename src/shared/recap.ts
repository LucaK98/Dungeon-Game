/**
 * The look back at the end of an adventure: who hit hardest, who healed, who had bad luck …
 * The TV collects the numbers during the game; this file turns them into highlights.
 */
import type { DollLook } from "./doll";

export interface HeroStats {
  damageDealt: number;
  damageTaken: number;
  biggestHit: number;
  biggestHitTarget?: string;
  crits: number;
  fumbles: number;
  kills: number;
  healing: number;
  gold: number;
  downs: number;
  emotes: number;
  freeActions: number;
  /** For the secret goals (optional: older saves do not have them). */
  chests?: number;
  finds?: number;
  objects?: number;
  helps?: number;
  /** Monster ids this hero defeated (for badges like "Drachentöter"). */
  slain?: string[];
}

export function emptyStats(): HeroStats {
  return { damageDealt: 0, damageTaken: 0, biggestHit: 0, crits: 0, fumbles: 0, kills: 0, healing: 0, gold: 0, downs: 0, emotes: 0, freeActions: 0, chests: 0, finds: 0, objects: 0, helps: 0 };
}

export interface RecapHero {
  id: string;
  name: string;
  color: string;
  look?: DollLook;
  classId: string;
  level: number;
  stats: HeroStats;
}

export interface Highlight {
  icon: string;
  title: string;
  heroId: string;
  text: string;
}

export interface Recap {
  story: string;
  ending: { title: string; kind: string };
  minutes: number;
  heroes: RecapHero[];
  highlights: Highlight[];
  /** The most memorable free action, in the players' own words. */
  bestIdea?: string;
  /** The final blow against the boss, in the player's words and as the game master told it. */
  finalBlow?: { heroId: string; name: string; boss: string; text: string; narration: string };
  /** Badges earned in this adventure. */
  badges?: { heroId: string; name: string; color: string; icon: string; title: string; how: string }[];
  /** The secret goals, revealed. */
  goals?: { heroId: string; name: string; color: string; icon: string; reveal: string; done: boolean }[];
}

/** Picks up to six highlights, each hero at most twice, only with real numbers. */
export function buildHighlights(heroes: RecapHero[]): Highlight[] {
  const out: Highlight[] = [];
  const count = new Map<string, number>();
  const best = (value: (s: HeroStats) => number) => {
    const sorted = [...heroes].sort((a, b) => value(b.stats) - value(a.stats));
    return sorted[0] && value(sorted[0].stats) > 0 ? sorted[0] : undefined;
  };
  const add = (hero: RecapHero | undefined, icon: string, title: string, text: (h: RecapHero) => string) => {
    if (!hero || (count.get(hero.id) ?? 0) >= 2 || out.length >= 6) return;
    count.set(hero.id, (count.get(hero.id) ?? 0) + 1);
    out.push({ icon, title, heroId: hero.id, text: text(hero) });
  };
  add(best((s) => s.biggestHit), "💥", "Härtester Schlag", (h) => `${h.stats.biggestHit} Schaden${h.stats.biggestHitTarget ? ` gegen ${h.stats.biggestHitTarget}` : ""}`);
  add(best((s) => s.kills), "⚔️", "Bezwinger", (h) => `${h.stats.kills} ${h.stats.kills === 1 ? "Gegner" : "Gegner"} besiegt`);
  add(best((s) => s.healing), "💚", "Heiler", (h) => `${h.stats.healing} Trefferpunkte geheilt`);
  add(best((s) => s.crits), "🎯", "Volltreffer", (h) => `${h.stats.crits} kritische ${h.stats.crits === 1 ? "Treffer" : "Treffer"}`);
  add(best((s) => s.damageTaken), "🛡️", "Fels in der Brandung", (h) => `${h.stats.damageTaken} Schaden eingesteckt`);
  add(best((s) => s.gold), "💰", "Schatzsucher", (h) => `${h.stats.gold} Gold gefunden`);
  add(best((s) => s.fumbles), "🎲", "Pechvogel", (h) => `${h.stats.fumbles}× eine 1 gewürfelt`);
  add(best((s) => s.freeActions), "🎭", "Ideenreich", (h) => `${h.stats.freeActions} eigene Ideen ausprobiert`);
  add(best((s) => s.emotes), "😂", "Stimmungskanone", (h) => `${h.stats.emotes} Reaktionen geschickt`);
  return out;
}
