/**
 * Something a hero gained: a new level (with what got better), a piece of equipment, gold or an item.
 * The TV celebrates it, the phone of that hero shows the details.
 */
import { nameOf } from "../engine/names";
import type { Creature } from "./game";

export interface StatGain {
  icon: string;
  label: string;
  from: string;
  to: string;
  glossarKey?: string;
}

export type Reward =
  | {
      kind: "level";
      heroId: string;
      name: string;
      color?: string;
      level: number;
      gains: StatGain[];
      /** New class features and spells (id for the glossary, readable name). */
      features: { key: string; name: string }[];
      spells: { key: string; name: string }[];
    }
  | { kind: "gear"; heroId: string; name: string; color?: string; icon: string; title: string; detail: string; how: string }
  | { kind: "gold"; heroId: string; name: string; color?: string; amount: number }
  | { kind: "item"; heroId: string; name: string; color?: string; itemId: string; title: string; icon: string; qty: number };

const ABILITIES = [
  ["STR", "💪", "Stärke", "staerke"],
  ["DEX", "🤸", "Geschicklichkeit", "geschicklichkeit"],
  ["CON", "🫀", "Konstitution", "konstitution"],
  ["INT", "🧠", "Intelligenz", "intelligenz"],
  ["WIS", "🦉", "Weisheit", "weisheit"],
  ["CHA", "🗣️", "Charisma", "charisma"],
] as const;

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** What got better from `before` to `after` (same hero, higher level). */
export function levelGains(before: Creature, after: Creature): { gains: StatGain[]; features: { key: string; name: string }[]; spells: { key: string; name: string }[] } {
  const gains: StatGain[] = [];
  if (after.maxHp !== before.maxHp) gains.push({ icon: "❤️", label: "Trefferpunkte", from: String(before.maxHp), to: String(after.maxHp), glossarKey: "trefferpunkte" });
  if (after.proficiencyBonus !== before.proficiencyBonus) gains.push({ icon: "🎯", label: "Übungsbonus", from: signed(before.proficiencyBonus), to: signed(after.proficiencyBonus), glossarKey: "uebungsbonus" });
  for (const [ab, icon, label, key] of ABILITIES) {
    const a = before.abilities[ab];
    const b = after.abilities[ab];
    if (a !== b) gains.push({ icon, label, from: String(a), to: String(b), glossarKey: key });
  }
  const slots = (c: Creature) => (c.pc?.spellSlotsMax ?? []).map((n, i) => (n ? `${n}× ${i + 1}. Grad` : "")).filter(Boolean).join(", ") || "–";
  if (slots(before) !== slots(after)) gains.push({ icon: "🔮", label: "Zauberplätze", from: slots(before), to: slots(after), glossarKey: "zauberplaetze" });
  const oldRes = before.pc?.resources ?? {};
  for (const [id, r] of Object.entries(after.pc?.resources ?? {})) {
    const was = oldRes[id]?.max ?? 0;
    if (r.max > was && was > 0) gains.push({ icon: "⚡", label: nameOf("features", id), from: `${was}×`, to: `${r.max}×`, glossarKey: `merkmal:${id}` });
  }
  const had = new Set(before.pc?.features ?? []);
  const features = [...new Set(after.pc?.features ?? [])].filter((f) => !had.has(f)).map((f) => ({ key: `merkmal:${f}`, name: nameOf("features", f) }));
  const knew = new Set(before.pc?.spells ?? []);
  const spells = (after.pc?.spells ?? []).filter((s) => !knew.has(s)).map((s) => ({ key: `zauber:${s}`, name: nameOf("spells", s) }));
  return { gains, features, spells };
}

const ITEM_ICONS: Record<string, string> = {
  "potion-of-healing": "🧪",
  lance: "🔱",
  torch: "🔥",
  rope: "🪢",
  heilkraut: "🌿",
  pilz: "🍄",
  leuchtpilz: "✨",
  knochen: "🦴",
  spinnenseide: "🕸️",
  oelflasche: "🫙",
  brandflasche: "🔥",
  leuchttrank: "💡",
  staerketrank: "🐻",
  stolperdraht: "🪢",
};

export function itemIcon(itemId: string): string {
  return ITEM_ICONS[itemId] ?? "🎒";
}

export function itemTitle(itemId: string): string {
  return nameOf("items", itemId);
}
