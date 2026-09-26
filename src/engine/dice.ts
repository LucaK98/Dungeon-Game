import type { DiceExpr } from "../shared/rules";
import type { Rng } from "./rng";

export interface DiceTerm {
  count: number;
  sides: number;
}

export interface ParsedDice {
  terms: DiceTerm[];
  flat: number;
}

/** Parses "2d6+3", "1d8 + MOD", "3d4+3", "5". `mod` replaces the word MOD. */
export function parseDice(expr: DiceExpr, mod = 0): ParsedDice {
  const clean = expr.replace(/\s+/g, "").replace(/MOD/g, String(mod)).replace(/\+-/g, "-");
  const terms: DiceTerm[] = [];
  let flat = 0;
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/gy;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(clean))) {
    consumed = re.lastIndex;
    if (m[3]) {
      const sign = m[1] === "-" ? -1 : 1;
      terms.push({ count: sign * Number(m[2] || 1), sides: Number(m[3]) });
    } else {
      flat += (m[4] === "-" ? -1 : 1) * Number(m[5]);
    }
  }
  if (consumed !== clean.length || clean.length === 0) throw new Error(`invalid dice expression "${expr}"`);
  return { terms, flat };
}

export function rollDie(rng: Rng, sides: number): number {
  return rng.int(1, sides);
}

/** Rolls all dice of an expression; `multiplier` doubles dice on a critical hit. */
export function rollDice(rng: Rng, parsed: ParsedDice, multiplier = 1): { dice: number[]; sides: number[]; total: number } {
  const dice: number[] = [];
  const sides: number[] = [];
  let total = parsed.flat;
  for (const t of parsed.terms) {
    const n = Math.abs(t.count) * multiplier;
    for (let i = 0; i < n; i++) {
      const v = rollDie(rng, t.sides);
      dice.push(v);
      sides.push(t.sides);
      total += Math.sign(t.count) * v;
    }
  }
  return { dice, sides, total };
}

export function averageOf(expr: DiceExpr): number {
  const p = parseDice(expr);
  return Math.floor(p.terms.reduce((s, t) => s + t.count * (t.sides + 1) / 2, p.flat));
}

export function formatDice(p: ParsedDice): string {
  const dice = p.terms.map((t) => `${t.count}W${t.sides}`).join(" + ");
  if (!p.flat) return dice || "0";
  return dice ? `${dice} ${p.flat > 0 ? "+" : "−"} ${Math.abs(p.flat)}` : String(p.flat);
}
