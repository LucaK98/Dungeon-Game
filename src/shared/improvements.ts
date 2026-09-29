/**
 * At level 4 a hero improves: +2 on one attribute, +1 on two, or a talent.
 * Stored as short strings in the hero book ("asi:STR+2", "asi:DEX+1,CON+1", "talent:zaeh").
 */
import type { Ability } from "./types";

export const ABILITY_IDS: Ability[] = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

export interface Talent {
  id: string;
  icon: string;
  name: string;
  text: string;
}

/** Simple talents of our own (no rules text copied): each does one clear thing. */
export const TALENTS: Talent[] = [
  { id: "zaeh", icon: "❤️", name: "Zäh", text: "+2 maximale Trefferpunkte pro Stufe" },
  { id: "wachsam", icon: "👁️", name: "Wachsam", text: "+5 auf die Initiative – du bist oft zuerst dran" },
  { id: "flink", icon: "🥾", name: "Flink", text: "+2 Felder Bewegung pro Zug" },
];

/**
 * Levels at which a hero picked a big improvement (+2 or a talent) in older versions. Heroes from the
 * hero book keep theirs; new heroes get one attribute point per level instead ("pt:STR").
 */
export const IMPROVEMENT_LEVELS: number[] = [];
const LEGACY_LEVELS = [4];

export function improvementsDue(level: number): number {
  return IMPROVEMENT_LEVELS.filter((l) => level >= l).length;
}

/** Attribute points a hero has earned: one per level above 1, plus one per finished chapter. */
export function pointsDue(level: number, chapters = 0): number {
  return Math.max(0, level - 1) + Math.max(0, chapters);
}

/** Points spent so far ("pt:DEX" entries). */
export function pointsSpent(improvements: readonly string[] | undefined): number {
  return (improvements ?? []).filter((i) => i.startsWith("pt:")).length;
}

export type ParsedImprovement = { kind: "asi"; bonus: Partial<Record<Ability, number>> } | { kind: "talent"; talent: Talent };

export function parseImprovement(raw: unknown): ParsedImprovement | undefined {
  if (typeof raw !== "string") return undefined;
  // One attribute point from a level-up: +1 on one attribute.
  const pt = /^pt:(STR|DEX|CON|INT|WIS|CHA)$/.exec(raw);
  if (pt) return { kind: "asi", bonus: { [pt[1] as Ability]: 1 } };
  if (raw.startsWith("talent:")) {
    const talent = TALENTS.find((t) => t.id === raw.slice(7));
    return talent ? { kind: "talent", talent } : undefined;
  }
  if (!raw.startsWith("asi:")) return undefined;
  const bonus: Partial<Record<Ability, number>> = {};
  let total = 0;
  for (const part of raw.slice(4).split(",")) {
    const m = /^(STR|DEX|CON|INT|WIS|CHA)\+([12])$/.exec(part);
    if (!m) return undefined;
    const ab = m[1] as Ability;
    bonus[ab] = (bonus[ab] ?? 0) + Number(m[2]);
    total += Number(m[2]);
  }
  // Exactly +2 in total: +2 on one, or +1 on two different attributes.
  if (total !== 2 || Object.values(bonus).some((v) => (v ?? 0) > 2)) return undefined;
  return { kind: "asi", bonus };
}

/** Valid improvements only, and not more than the level allows. */
export function sanitizeImprovements(raw: unknown, level: number, chapters = 0): string[] {
  const list = (Array.isArray(raw) ? raw : []).filter((x): x is string => !!parseImprovement(x));
  const points = list.filter((x) => x.startsWith("pt:")).slice(0, pointsDue(level, chapters));
  const legacy = list.filter((x) => !x.startsWith("pt:")).slice(0, LEGACY_LEVELS.filter((l) => level >= l).length);
  return [...legacy, ...points];
}

/** "Stärke +2", "Geschick +1, Konstitution +1", "Talent: Zäh". */
export function describeImprovement(raw: string, abilityName: (a: Ability) => string): string {
  const p = parseImprovement(raw);
  if (!p) return "";
  if (p.kind === "talent") return `${p.talent.icon} Talent: ${p.talent.name}`;
  return Object.entries(p.bonus)
    .map(([a, v]) => `${abilityName(a as Ability)} +${v}`)
    .join(", ");
}
