/**
 * Short texts for the TV (no Phaser here, so they can be tested): the colour language, the
 * verdict of a roll, and the round summary of small things.
 */
import type { RollOutcome } from "../shared/view";

/** The colour language: green = good for you, red = danger, gold = reward, blue = info. */
export const TONE = { good: "#7fdc8a", danger: "#ff7a6e", reward: "#ffd75e", info: "#8fc3ff", text: "#e8dcc4" } as const;

/** Small things for the round summary (short form), or undefined for news that shows at once. */
export function summaryOf(text: string): string | undefined {
  let m = /^✨ \+(\d+) EP/u.exec(text);
  if (m) return `+${m[1]} EP`;
  m = /^💰 .*? (?:sammelt|findet) (\d+) (?:Gold)?[mM]ünzen/u.exec(text);
  if (m) return `+${m[1]} Gold`;
  m = /^🔥 (.+?) fängt Feuer/u.exec(text);
  if (m) return `${m[1]} brennt`;
  m = /^❄️ (.+?) ist unterkühlt/u.exec(text);
  if (m) return `${m[1]} unterkühlt`;
  m = /^⚡ (.+?) ist geschockt/u.exec(text);
  if (m) return `${m[1]} geschockt`;
  return undefined;
}

/** EP and gold added up, the rest listed once: "+20 EP · +12 Gold · Goblin 2 brennt". */
export function mergeSummary(items: string[]): string {
  let ep = 0;
  let gold = 0;
  const rest: string[] = [];
  for (const i of items) {
    const e = /^\+(\d+) EP$/.exec(i);
    const g = /^\+(\d+) Gold$/.exec(i);
    if (e) ep += Number(e[1]);
    else if (g) gold += Number(g[1]);
    else if (!rest.includes(i)) rest.push(i);
  }
  return [ep ? `+${ep} EP` : "", gold ? `+${gold} Gold` : "", ...rest.slice(0, 4), rest.length > 4 ? "…" : ""].filter(Boolean).join(" · ");
}

/** "Treffer!", "Kritisch!", "Daneben!", "Geschafft!" … in the colour of the outcome. */
export function rollVerdict(r: Pick<RollOutcome, "success" | "crit" | "lines" | "title" | "playerId">): { text: string; color: string } {
  const attack = /^Angriff|greift an|gegen RK/.test(r.title) || r.lines.some((l) => /gegen RK/.test(l.text));
  // A roll without a player is the foes' (or the world's): their success is danger for you.
  const ours = !!r.playerId;
  if (r.crit) return { text: "💥 Kritisch!", color: ours ? TONE.reward : TONE.danger };
  if (r.success === true) return { text: attack ? "🎯 Treffer!" : "✅ Geschafft!", color: ours ? TONE.good : TONE.danger };
  if (r.success === false) return { text: attack ? "💨 Daneben!" : "❌ Nicht geschafft", color: ours ? TONE.danger : TONE.good };
  return { text: "🎲 Gewürfelt", color: TONE.info };
}

