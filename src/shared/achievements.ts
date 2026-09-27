/**
 * Badges for the hero book: earned in one adventure or over several (the book keeps running totals).
 * They are only for showing off – no rules change.
 */
import type { HeroStats } from "./recap";

/** Running totals over all adventures of a hero. */
export type HeroTotals = Partial<Record<"kills" | "crits" | "healing" | "damageDealt" | "chests" | "freeActions" | "fumbles", number>>;

export interface BadgeContext {
  stats: HeroStats;
  /** Totals including this adventure. */
  totals: HeroTotals;
  won: boolean;
  difficulty: string;
  /** Adventures survived including this one. */
  stories: number;
  level: number;
  gold: number;
  goalMet: boolean;
  finalBlow: boolean;
  /** Monster ids this hero defeated in this adventure. */
  slain: string[];
}

export interface Badge {
  id: string;
  icon: string;
  name: string;
  /** How it is earned (for the phone). */
  how: string;
  earned(c: BadgeContext): boolean;
}

export const BADGES: Badge[] = [
  { id: "drachentoeter", icon: "🐉", name: "Drachentöter", how: "Einen Drachen besiegt", earned: (c) => c.slain.some((m) => m.includes("dragon")) },
  { id: "letzter_schlag", icon: "⚔️", name: "Der letzte Schlag", how: "Den Endgegner selbst niedergestreckt", earned: (c) => c.finalBlow },
  { id: "unverwundbar", icon: "🛡️", name: "Nie ohnmächtig", how: "Ein ganzes Abenteuer gewonnen, ohne einmal zu Boden zu gehen", earned: (c) => c.won && c.stats.downs === 0 },
  { id: "geheimagent", icon: "🤫", name: "Geheimagent", how: "Das geheime Ziel erfüllt", earned: (c) => c.goalMet },
  { id: "volltreffer", icon: "🎯", name: "Meisterschütze", how: "10 kritische Treffer (über alle Abenteuer)", earned: (c) => (c.totals.crits ?? 0) >= 10 },
  { id: "monsterjaeger", icon: "💀", name: "Monsterjäger", how: "25 Gegner besiegt (über alle Abenteuer)", earned: (c) => (c.totals.kills ?? 0) >= 25 },
  { id: "heilige_haende", icon: "💚", name: "Heilige Hände", how: "60 Trefferpunkte geheilt (über alle Abenteuer)", earned: (c) => (c.totals.healing ?? 0) >= 60 },
  { id: "truhenknacker", icon: "🧰", name: "Truhenknacker", how: "8 Truhen geöffnet (über alle Abenteuer)", earned: (c) => (c.totals.chests ?? 0) >= 8 },
  { id: "ideenreich", icon: "💡", name: "Ideenreich", how: "10 eigene Ideen ausprobiert (über alle Abenteuer)", earned: (c) => (c.totals.freeActions ?? 0) >= 10 },
  { id: "pechvogel", icon: "🍀", name: "Pechvogel", how: "In einem Abenteuer 4-mal eine 1 gewürfelt – und trotzdem durchgehalten", earned: (c) => c.stats.fumbles >= 4 },
  { id: "reich", icon: "💰", name: "Reich wie ein König", how: "200 Gold besessen", earned: (c) => c.gold >= 200 },
  { id: "veteran", icon: "📜", name: "Veteran", how: "3 Abenteuer überstanden", earned: (c) => c.stories >= 3 },
  { id: "legende", icon: "👑", name: "Legende", how: "Stufe 5 erreicht", earned: (c) => c.level >= 5 },
  { id: "hartgesotten", icon: "🔥", name: "Hartgesotten", how: "Ein Abenteuer auf „Schwer“ gewonnen", earned: (c) => c.won && (c.difficulty === "schwer" || c.difficulty === "toedlich") },
  { id: "todesmutig", icon: "☠️", name: "Todesmutig", how: "Ein Abenteuer auf „Tödlich“ gewonnen", earned: (c) => c.won && c.difficulty === "toedlich" },
];

const byId = new Map(BADGES.map((b) => [b.id, b]));

export function badgeById(id: string): Badge | undefined {
  return byId.get(id);
}

const TOTAL_KEYS = ["kills", "crits", "healing", "damageDealt", "chests", "freeActions", "fumbles"] as const;

/** Adds this adventure's numbers to the running totals. */
export function addTotals(before: HeroTotals | undefined, s: HeroStats): HeroTotals {
  const out: HeroTotals = { ...(before ?? {}) };
  for (const k of TOTAL_KEYS) out[k] = Math.min(99999, (out[k] ?? 0) + (Number(s[k]) || 0));
  return out;
}

/** Badges earned now that the hero did not have yet. */
export function newBadges(had: string[], c: BadgeContext): Badge[] {
  return BADGES.filter((b) => !had.includes(b.id) && b.earned(c));
}

/** Keeps only valid badges and sane totals (the TV never trusts a phone blindly). */
export function sanitizeBadges(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : []).filter((id): id is string => typeof id === "string" && byId.has(id)).filter((id, i, a) => a.indexOf(id) === i);
}

export function sanitizeTotals(raw: unknown): HeroTotals {
  const t = (raw ?? {}) as Record<string, unknown>;
  const out: HeroTotals = {};
  for (const k of TOTAL_KEYS) {
    const v = Math.floor(Number(t[k]) || 0);
    if (v > 0) out[k] = Math.min(99999, v);
  }
  return out;
}
