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

/** Levels at which a hero may improve (one choice each). */
export const IMPROVEMENT_LEVELS = [4];

export function improvementsDue(level: number): number {
  return IMPROVEMENT_LEVELS.filter((l) => level >= l).length;
}

export type ParsedImprovement = { kind: "asi"; bonus: Partial<Record<Ability, number>> } | { kind: "talent"; talent: Talent };

export function parseImprovement(raw: unknown): ParsedImprovement | undefined {
  if (typeof raw !== "string") return undefined;
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
export function sanitizeImprovements(raw: unknown, level: number): string[] {
  const list = (Array.isArray(raw) ? raw : []).filter((x): x is string => !!parseImprovement(x));
  return list.slice(0, improvementsDue(level));
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
