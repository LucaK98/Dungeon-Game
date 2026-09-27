/**
 * The hero book: heroes keep their level, gold, potions and equipment for the next story.
 * Stored on the player's phone (it is their hero). The TV checks everything that comes back.
 */
import { GEAR } from "../data/gear";
import type { CharacterProfile } from "./lobby";
import { sanitizeBadges, sanitizeTotals, type HeroTotals } from "./achievements";

export interface HeroLegacy {
  level: number;
  gold: number;
  potions: number;
  gear: { owned: string[]; weapon?: string; armor?: string; trinket?: string };
  /** Adventures survived (titles). */
  stories: string[];
  /** Earned badges (src/shared/achievements.ts) and running totals for them. */
  badges?: string[];
  totals?: HeroTotals;
}

export interface SavedHero {
  profile: CharacterProfile;
  legacy: HeroLegacy;
  savedAt: number;
}

const GEAR_IDS = new Set(GEAR.map((g) => g.id));

/** Keeps only what makes sense (the TV never trusts a phone blindly). */
export function sanitizeLegacy(raw: unknown): HeroLegacy | undefined {
  const l = raw as Partial<HeroLegacy> | undefined;
  if (!l || typeof l !== "object") return undefined;
  const num = (v: unknown, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number(v) || 0)));
  const owned = [...new Set((Array.isArray(l.gear?.owned) ? l.gear!.owned : []).filter((id) => typeof id === "string" && GEAR_IDS.has(id)))].slice(0, 12);
  const worn = (id: unknown) => (typeof id === "string" && owned.includes(id) ? id : undefined);
  const weapon = worn(l.gear?.weapon);
  const armor = worn(l.gear?.armor);
  const trinket = worn(l.gear?.trinket);
  const badges = sanitizeBadges(l.badges);
  const totals = sanitizeTotals(l.totals);
  return {
    level: num(l.level, 1, 3),
    gold: num(l.gold, 0, 999),
    potions: num(l.potions, 0, 5),
    gear: { owned, ...(weapon ? { weapon } : {}), ...(armor ? { armor } : {}), ...(trinket ? { trinket } : {}) },
    stories: (Array.isArray(l.stories) ? l.stories : []).filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 60)).slice(-10),
    ...(badges.length ? { badges } : {}),
    ...(Object.keys(totals).length ? { totals } : {}),
  };
}

// ---------------------------------------------------------------- the book on the phone

const KEY = "couch-dungeon.herobook";

export function loadBook(): SavedHero[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedHero[]) : [];
    return Array.isArray(list) ? list.filter((h) => h?.profile?.name && h.legacy) : [];
  } catch {
    return [];
  }
}

/** Adds or updates a hero (same name and class = the same hero). */
export function saveToBook(hero: SavedHero): void {
  const list = loadBook().filter((h) => !(h.profile.name === hero.profile.name && h.profile.classId === hero.profile.classId));
  list.unshift(hero);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    // Storage full: the hero is not kept.
  }
}

export function removeFromBook(name: string, classId: string): void {
  const list = loadBook().filter((h) => !(h.profile.name === name && h.profile.classId === classId));
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}
