/**
 * Secret goals: every hero gets a small private mission on the phone at the start.
 * The TV checks them from the numbers it collects anyway; at the end they are revealed,
 * and whoever made it gets bonus gold.
 */
import type { HeroStats } from "./recap";

export interface SecretGoal {
  id: string;
  icon: string;
  /** For the phone, "du"-form. */
  text: string;
  /** For the reveal on the TV: "… wollte …". */
  reveal: string;
  /** Current value and the target (for "2 / 3" on the phone). */
  progress(s: HeroStats): [number, number];
  /** Only decided at the very end (e.g. "never knocked out"). */
  atEnd?: boolean;
  /** Only for some classes (healing needs healers). */
  classes?: string[];
}

const count = (value: (s: HeroStats) => number, target: number) => (s: HeroStats): [number, number] => [Math.min(value(s), target), target];

export const SECRET_GOALS: SecretGoal[] = [
  { id: "jaeger", icon: "🏹", text: "Besiege mindestens 3 Gegner.", reveal: "wollte mindestens 3 Gegner besiegen", progress: count((s) => s.kills, 3) },
  { id: "volltreffer", icon: "🎯", text: "Lande einen kritischen Treffer (eine 20 auf dem Würfel beim Angriff).", reveal: "wollte einen kritischen Treffer landen", progress: count((s) => s.crits, 1) },
  { id: "heiler", icon: "💚", text: "Heile insgesamt 12 Trefferpunkte.", reveal: "wollte 12 Trefferpunkte heilen", progress: count((s) => s.healing, 12), classes: ["cleric", "paladin", "druid", "bard"] },
  { id: "schatz", icon: "💰", text: "Sammle mindestens 40 Gold ein.", reveal: "wollte 40 Gold einsammeln", progress: count((s) => s.gold, 40) },
  { id: "truhen", icon: "🧰", text: "Öffne 2 Truhen.", reveal: "wollte 2 Truhen öffnen", progress: count((s) => s.chests ?? 0, 2) },
  { id: "ideen", icon: "💡", text: "Probiere 3 eigene Ideen aus (freie Aktion: „Etwas anderes tun“).", reveal: "wollte 3 eigene Ideen ausprobieren", progress: count((s) => s.freeActions, 3) },
  { id: "standhaft", icon: "🛡️", text: "Geh im ganzen Abenteuer kein einziges Mal zu Boden.", reveal: "wollte nie zu Boden gehen", progress: (s) => [s.downs ? 0 : 1, 1], atEnd: true },
  { id: "wucht", icon: "💥", text: "Mach mit einem einzigen Treffer 10 oder mehr Schaden.", reveal: "wollte mit einem Treffer 10 Schaden machen", progress: count((s) => (s.biggestHit >= 10 ? 1 : 0), 1) },
  { id: "spaeher", icon: "👀", text: "Schaff 3 Proben beim „Umsehen“.", reveal: "wollte sich dreimal erfolgreich umsehen", progress: count((s) => s.finds ?? 0, 3) },
  { id: "tueftler", icon: "🔧", text: "Benutze 2 Dinge in der Umgebung (Hebel, Fässer, Kronleuchter …).", reveal: "wollte 2 Dinge in der Umgebung benutzen", progress: count((s) => s.objects ?? 0, 2) },
  { id: "stimmung", icon: "🎉", text: "Schick 8 Reaktionen (😀-Knopf) an den Fernseher.", reveal: "wollte 8 Reaktionen schicken", progress: count((s) => s.emotes, 8) },
  { id: "draufgaenger", icon: "⚔️", text: "Richte insgesamt 40 Schaden an.", reveal: "wollte 40 Schaden anrichten", progress: count((s) => s.damageDealt, 40) },
  { id: "fels", icon: "🪨", text: "Steck insgesamt 25 Schaden ein.", reveal: "wollte 25 Schaden einstecken", progress: count((s) => s.damageTaken, 25) },
  { id: "helfer", icon: "🤝", text: "Hilf zweimal einem Freund (freie Aktion, z. B. „Ich helfe Mira“).", reveal: "wollte zweimal helfen", progress: count((s) => s.helps ?? 0, 2) },
];

/** Bonus gold for a goal that was reached. */
export const GOAL_GOLD = 25;

export function goalById(id: string): SecretGoal | undefined {
  return SECRET_GOALS.find((g) => g.id === id);
}

export function goalReached(goal: SecretGoal, s: HeroStats): boolean {
  const [have, need] = goal.progress(s);
  return have >= need;
}

/** One goal per hero, all different, fitting the class. */
export function assignGoals(heroes: { id: string; classId: string }[], pick: (n: number) => number): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const h of heroes) {
    const pool = SECRET_GOALS.filter((g) => !used.has(g.id) && (!g.classes || g.classes.includes(h.classId)));
    const g = pool[pick(pool.length)];
    if (!g) continue;
    used.add(g.id);
    out[h.id] = g.id;
  }
  return out;
}
