/**
 * The numbers of a roll for people on the sofa: what the die had to show and what it showed.
 * Read from the explanation line ("🎲 9 + 3 (Stärke) = 12 gegen RK 13 → …"), so it works for every
 * roll – heroes, foes, saves.
 */
import type { RollOutcome } from "./view";

export interface RollMath {
  /** The die that counts. */
  die: number;
  /** Everything added to it (ability, training, magic …). */
  bonus: number;
  total: number;
  /** "RK" (armour class, attacks) or "SG" (difficulty, checks and saves). */
  label: "RK" | "SG";
  target: number;
  /** The smallest die face that would have done it (1 = always, 21 = only a natural 20). */
  need: number;
}

const MATH = /= (-?\d+) gegen (RK|SG) (-?\d+)/;

export function rollMath(r: Pick<RollOutcome, "dice" | "kept" | "lines">): RollMath | undefined {
  if (!r.dice.length) return undefined;
  for (const l of r.lines) {
    const m = MATH.exec(l.text);
    if (!m) continue;
    const total = Number(m[1]);
    const target = Number(m[3]);
    const bonus = total - r.kept;
    return { die: r.kept, bonus, total, label: m[2] as "RK" | "SG", target, need: target - bonus };
  }
  return undefined;
}

/** "Nötig: 12 · Gewürfelt: 9" – the two numbers side by side. */
export function needText(need: number): string {
  return need <= 1 ? "Klappt immer" : need >= 20 ? "Nötig: eine 20" : `Nötig: ${need}+`;
}

/** The small sum underneath: "9 + 3 Bonus = 12 gegen RK 13". */
export function sumText(m: RollMath): string {
  const bonus = m.bonus === 0 ? "" : m.bonus > 0 ? ` + ${m.bonus} Bonus` : ` − ${-m.bonus} Malus`;
  return `${m.die}${bonus} = ${m.total} gegen ${m.label} ${m.target}`;
}
