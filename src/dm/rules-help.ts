/**
 * "Frag den Spielleiter": rules questions from a phone. Without AI the best glossary entry
 * answers; with AI the game master gets the matching glossary entries and answers in its words.
 */
import { glossarForQuestion, glossarScores } from "../data/help/glossar";
import { nameOf } from "../engine/names";
import type { Creature } from "../shared/game";

export function glossaryExcerpt(question: string): { title: string; text: string }[] {
  return glossarForQuestion(question, 4).map(({ entry }) => ({ title: entry.titel, text: `${entry.kurz} ${entry.lang}${entry.beispiel ? ` Beispiel: ${entry.beispiel}` : ""}` }));
}

/**
 * "Was ist Vorteil?", "Was bedeutet Initiative?": a plain question about a word the rule book
 * explains is answered from the book right away (no AI call). Questions about the hero's own
 * situation ("Kann ich noch angreifen?") still go to the game master.
 */
export function glossaryDirect(question: string): string | undefined {
  const q = question.trim().toLowerCase();
  if (!/^(was (ist|sind|bedeutet|bedeuten|heißt|heisst|macht|bringt)|wie funktionier|erklär)/.test(q)) return undefined;
  if (/\b(ich|mich|mir|mein|meine|wir|uns|unser)\b/.test(q)) return undefined;
  const [best, next] = glossarScores(question);
  if (!best || best.score < 6 || (next && next.score >= best.score)) return undefined;
  return `${best.entry.titel}: ${best.entry.kurz} ${best.entry.lang}`;
}

export function glossaryAnswer(question: string): string {
  const [best] = glossarForQuestion(question, 1);
  if (!best) return "Dazu finde ich nichts im Regelbuch. Probiert es einfach aus – oder fragt mit anderen Worten, z. B. „Was ist Vorteil?“.";
  return `${best.entry.titel}: ${best.entry.kurz} ${best.entry.lang}`;
}

/** The asking hero in a few words (class, HP, conditions, what is left this turn). */
export function heroSummary(hero: Creature, turn?: { actions: number; bonusAction: boolean; movementLeftFt: number }): string {
  const parts = [`${hero.name}, ${nameOf("classes", hero.pc?.classId ?? "")} Stufe ${hero.pc?.level ?? 1}, ${hero.hp}/${hero.maxHp} TP`];
  if (hero.conditions.length) parts.push(`Zustände: ${hero.conditions.map((c) => nameOf("conditions", c.id)).join(", ")}`);
  if (turn) parts.push(`in diesem Zug noch: ${turn.actions ? "Aktion" : "keine Aktion"}, ${turn.bonusAction ? "Bonusaktion" : "keine Bonusaktion"}, ${Math.floor(turn.movementLeftFt / 5)} Felder Bewegung`);
  return parts.join("; ");
}
