/**
 * The evening's report: the TV quietly counts how the game went (how long the fights took, how
 * much they hurt, how long the players waited, who was quiet) and shows it in the look back –
 * with a short checklist for talking about it afterwards.
 */
export interface FightStat {
  rounds: number;
  /** Share of the heroes' life lost in this fight (0–1). */
  hpLost: number;
  won: boolean;
  boss: boolean;
}

export interface EveningStats {
  fights: FightStat[];
  /** Seconds from the start of a hero's turn to the first thing they did. */
  waits: number[];
  /** How often the spotlight guard gave an idle hero a hook. */
  spotlights: number;
  /** Things of note each hero did (by name), and the free actions (tricks, ideas) of all. */
  acts: Record<string, number>;
  tricks: number;
}

export interface ReportLine {
  icon: string;
  text: string;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function reportLines(s: EveningStats): ReportLine[] {
  const out: ReportLine[] = [];
  const fights = s.fights;
  if (fights.length) {
    const rounds = avg(fights.map((f) => f.rounds));
    const lost = avg(fights.map((f) => f.hpLost));
    const tight = fights.filter((f) => f.hpLost >= 0.5 || !f.won).length;
    out.push({ icon: "⚔️", text: `${fights.length} ${fights.length === 1 ? "Kampf" : "Kämpfe"}, im Schnitt ${rounds.toFixed(1).replace(".", ",")} Runden und ${pct(lost)} Leben verloren${tight ? ` – ${tight}× wurde es richtig knapp` : ""}.` });
    if (rounds > 7) out.push({ icon: "🐢", text: "Die Kämpfe zogen sich – beim nächsten Mal ruhig „Schnell“ als Spieltempo probieren." });
    if (lost < 0.12 && fights.length >= 2) out.push({ icon: "🥱", text: "Kaum Kratzer: Wenn's zu leicht war, beim nächsten Mal eine Stufe schwerer wählen." });
  }
  if (s.waits.length) {
    const wait = avg(s.waits);
    const slow = s.waits.filter((w) => w > 45).length;
    out.push({ icon: "⏱️", text: `Bis zum ersten Zug vergingen im Schnitt ${Math.round(wait)} Sekunden${slow ? ` (${slow}× länger als 45 Sekunden)` : ""}.` });
  }
  out.push({ icon: "🎭", text: s.tricks ? `${s.tricks} freie Ideen und Kunststücke ausprobiert.` : "Noch keine freien Ideen – schreibt beim nächsten Mal einfach, was ihr tun wollt!" });
  const acts = Object.entries(s.acts);
  if (acts.length >= 2) {
    const total = acts.reduce((sum, [, n]) => sum + n, 0);
    const quiet = acts.filter(([, n]) => total > 0 && n / total < 0.5 / acts.length).map(([name]) => name);
    out.push(quiet.length ? { icon: "🤫", text: `Eher still: ${quiet.join(", ")} – vielleicht nächstes Mal öfter ins Rampenlicht holen.` } : { icon: "🤝", text: "Alle waren ungefähr gleich oft dran – schön verteilt!" });
  }
  if (s.spotlights) out.push({ icon: "🔦", text: `${s.spotlights}× hat der Spielleiter jemanden angestupst, der länger nichts zu tun hatte.` });
  return out;
}

/** A few questions for after the game (to make the next evening better). */
export const CHECKLIST = [
  "Hatte jede und jeder mindestens einen großen Moment?",
  "Gab es einen Kampf, der zu lang oder zu leicht war?",
  "Wusste immer jemand, was als Nächstes zu tun ist?",
  "Welche Idee war die witzigste – und hat sie geklappt?",
];
