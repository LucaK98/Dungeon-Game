/**
 * What an action did, as a few coloured points instead of a paragraph:
 * 🔴 −7 Schaden an Goblin 1 · 🟢 +5 Heilung für Brunhild · 🟡 Goblin 2 schläft · 🔵 +2 RK für Ole.
 */
import type { RollOutcome } from "./view";

export type BulletTone = "damage" | "heal" | "miss" | "status" | "buff" | "down" | "info";

export interface Bullet {
  text: string;
  tone: BulletTone;
}

export interface BulletWho {
  name: string;
  hp: number;
  enemy: boolean;
}

/** Status lines from the rules explanations: [pattern, tone, text]. */
const STATUS: [RegExp, BulletTone, (m: RegExpMatchArray) => string][] = [
  [/^(.+?) schläft tief und fest/, "status", (m) => `${m[1]} schläft`],
  [/Betäubender Schlag: (.+?) ist betäubt/, "status", (m) => `${m[1]} ist betäubt – verliert den nächsten Zug`],
  [/^(.+?) ist gesegnet/, "buff", (m) => `${m[1]}: +1W4 auf Angriffe und Rettungswürfe`],
  [/^(.+?) wird von einem schimmernden Schild/, "buff", (m) => `${m[1]}: +2 Rüstungsklasse`],
  [/^(.+?) Waffe glüht/, "buff", () => "+1W4 Glanzschaden pro Treffer"],
  [/lenkt (.+?) ab\b|^(?:.+? – )?(.+?) ist abgelenkt/, "status", (m) => `${m[1] ?? m[2]} ist abgelenkt – nächster Angriff mit Vorteil`],
  [/^(.+?) ist behindert/, "status", (m) => `${m[1]}: Angriffe mit Nachteil`],
  [/^Rückschlag: (.+?) stolpert/, "status", (m) => `${m[1]} liegt am Boden`],
  [/^Rückschlag: (.+?) behindert sich selbst/, "status", (m) => `${m[1]}: Angriffe mit Nachteil`],
  [/^(.+?) kommt wieder zu sich/, "heal", (m) => `${m[1]} ist wieder auf den Beinen`],
  [/^(.+?) (liegt am Boden:|liegt jetzt am Boden|wird umgestoßen|geht zu Boden|stürzt zu Boden)/, "status", (m) => `${m[1]} liegt am Boden`],
  [/^(.+?) ist stabil/, "info", (m) => `${m[1]} ist stabil`],
  [/^(.+?) ist gestorben/, "down", (m) => `${m[1]} ist gestorben`],
  [/^(.+?) weigert sich zu fallen/, "info", (m) => `${m[1]} steht mit 1 TP wieder auf!`],
  [/Geschosse abwehren: .+? – (\d+) Schaden weniger/, "info", (m) => `${m[1]} Schaden abgewehrt`],
  [/Unheimliches Ausweichen/, "info", () => "Nur halber Schaden (ausgewichen)"],
];

export function bulletsFor(r: Pick<RollOutcome, "hits" | "lines" | "success">, who: (id: string) => BulletWho | undefined): Bullet[] {
  const out: Bullet[] = [];
  const byTarget = new Map<string, { dmg: number; heal: number; miss: boolean; crit: boolean }>();
  for (const h of r.hits ?? []) {
    const e = byTarget.get(h.targetId) ?? { dmg: 0, heal: 0, miss: false, crit: false };
    if (h.miss) e.miss = true;
    else if (h.heal) e.heal += h.amount;
    else e.dmg += h.amount;
    e.crit ||= !!h.crit;
    byTarget.set(h.targetId, e);
  }
  const downed = new Set<string>();
  for (const [id, e] of byTarget) {
    const w = who(id);
    const name = w?.name ?? "?";
    if (e.dmg > 0) out.push({ tone: "damage", text: `−${e.dmg} Schaden an ${name}${e.crit ? " (kritisch!)" : ""}` });
    if (e.heal > 0) out.push({ tone: "heal", text: `+${e.heal} Heilung für ${name}` });
    if (e.miss && !e.dmg && !e.heal) out.push({ tone: "miss", text: `Verfehlt: ${name}` });
    if (w && e.dmg > 0 && w.hp <= 0) {
      downed.add(name);
      out.push({ tone: "down", text: w.enemy ? `${name} ist besiegt` : `${name} ist bewusstlos` });
    }
  }
  for (const l of r.lines) {
    const line = l.text.replace(/^[^\p{L}]+/u, "");
    for (const [re, tone, text] of STATUS) {
      const m = line.match(re);
      if (!m) continue;
      const b = { tone, text: text(m) };
      if (tone === "down" && [...downed].some((n) => b.text.startsWith(n))) break;
      if (!out.some((x) => x.text === b.text)) out.push(b);
      break;
    }
  }
  if (!out.length && r.success !== undefined) out.push({ tone: r.success ? "buff" : "miss", text: r.success ? "Geschafft!" : "Nicht geschafft" });
  return out.slice(0, 6);
}

export const BULLET_ICON: Record<BulletTone, string> = {
  damage: "⚔️",
  heal: "💚",
  miss: "💨",
  status: "💫",
  buff: "🛡️",
  down: "💀",
  info: "ℹ️",
};

/** Colours for the TV (Phaser) and the phone (CSS classes use the same names). */
export const BULLET_COLOR: Record<BulletTone, string> = {
  damage: "#ff6b5e",
  heal: "#6fdc7a",
  miss: "#b8b0a0",
  status: "#8fc3ff",
  buff: "#7fdc8a",
  down: "#e08aff",
  info: "#e8dcc4",
};
