/**
 * "Frag den Spielleiter": rules questions from a phone. Without AI the best glossary entry
 * answers; with AI the game master gets the matching glossary entries and answers in its words.
 */
import { glossarForQuestion } from "../data/help/glossar";
import { nameOf } from "../engine/names";
import type { Creature } from "../shared/game";

export function glossaryExcerpt(question: string): { title: string; text: string }[] {
  return glossarForQuestion(question, 4).map(({ entry }) => ({ title: entry.titel, text: `${entry.kurz} ${entry.lang}${entry.beispiel ? ` Beispiel: ${entry.beispiel}` : ""}` }));
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
