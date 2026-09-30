/**
 * Types like in Pokémon, on D&D's math: every foe has strengths and weaknesses against the
 * damage types (vulnerable ×2, resistant ×½, immune ×0). The rule book knows only a few; this
 * table gives every foe a character, and elemental variants (Feuerkobold, Frost-Skelett …) add
 * their own. Heroes only see the numbers once they have learned them (src/tv/game.ts).
 */
import type { Creature } from "../shared/game";
import type { DamageType } from "../shared/rules";

export interface TypeProfile {
  vulnerable?: DamageType[];
  resistant?: DamageType[];
  immune?: DamageType[];
}

/** Extra strengths and weaknesses per foe (on top of the rule book). */
export const TYPE_CHART: Record<string, TypeProfile> = {
  goblin: { vulnerable: ["thunder"], resistant: ["poison"] },
  kobold: { vulnerable: ["cold"], resistant: ["fire"] },
  wolf: { vulnerable: ["fire"] },
  "dire-wolf": { vulnerable: ["fire"] },
  rat: { vulnerable: ["fire"] },
  "giant-rat": { vulnerable: ["fire"] },
  "swarm-of-rats": { vulnerable: ["fire"] },
  "swarm-of-bats": { vulnerable: ["thunder"] },
  "giant-spider": { vulnerable: ["fire"], resistant: ["poison"] },
  skeleton: { vulnerable: ["radiant"] },
  zombie: { vulnerable: ["radiant", "fire"] },
  ghoul: { vulnerable: ["radiant"] },
  ghost: { vulnerable: ["radiant"] },
  specter: { vulnerable: ["radiant"] },
  ogre: { vulnerable: ["psychic"] },
  "red-dragon-wyrmling": { vulnerable: ["cold"] },
  cultist: { vulnerable: ["radiant"] },
  "cult-fanatic": { vulnerable: ["radiant"] },
  "green-hag": { vulnerable: ["radiant"], resistant: ["poison"] },
  "werewolf-hybrid": { vulnerable: ["radiant"] },
};

export type Element = "fire" | "frost" | "swamp" | "storm";

export interface ElementDef {
  /** "Feuer" → "Feuerkobold"; "Frost-" → "Frost-Skelett". */
  prefix: string;
  icon: string;
  /** What its attacks add. */
  damage: DamageType;
  profile: TypeProfile;
}

export const ELEMENTS: Record<Element, ElementDef> = {
  fire: { prefix: "Feuer", icon: "🔥", damage: "fire", profile: { resistant: ["fire"], vulnerable: ["cold"] } },
  frost: { prefix: "Frost-", icon: "❄️", damage: "cold", profile: { resistant: ["cold"], vulnerable: ["fire"] } },
  swamp: { prefix: "Sumpf-", icon: "🟢", damage: "poison", profile: { resistant: ["poison"], vulnerable: ["fire"] } },
  storm: { prefix: "Sturm-", icon: "⚡", damage: "lightning", profile: { resistant: ["lightning"], vulnerable: ["thunder"] } },
};

/** Which foes come in which elemental variants. */
export const VARIANTS: Partial<Record<string, Element[]>> = {
  kobold: ["fire", "storm"],
  goblin: ["fire", "swamp"],
  skeleton: ["frost", "fire"],
  zombie: ["swamp", "frost"],
  wolf: ["frost", "storm"],
  "giant-rat": ["swamp"],
  bandit: ["fire", "frost"],
  "giant-spider": ["swamp"],
  cultist: ["fire", "frost"],
};

function merge(c: Creature, p: TypeProfile): void {
  const add = (list: DamageType[], more?: DamageType[]) => {
    for (const t of more ?? []) if (!list.includes(t)) list.push(t);
  };
  c.vulnerabilities = [...c.vulnerabilities];
  c.resistances = [...c.resistances];
  c.immunities = [...c.immunities];
  add(c.vulnerabilities, p.vulnerable);
  add(c.resistances, p.resistant);
  add(c.immunities, p.immune);
  // Immune beats resistant beats vulnerable (a Feuerkobold is not both).
  c.resistances = c.resistances.filter((t) => !c.immunities.includes(t));
  c.vulnerabilities = c.vulnerabilities.filter((t) => !c.immunities.includes(t) && !c.resistances.includes(t));
}

/** The type chart for a freshly created monster. */
export function applyTypeChart(c: Creature): void {
  const p = c.monsterId ? TYPE_CHART[c.monsterId] : undefined;
  if (p) merge(c, p);
}

/** Turns a foe into its elemental variant: new name, resistances, and a bit of the element on its attacks. */
export function applyElement(c: Creature, element: Element): void {
  const def = ELEMENTS[element];
  c.element = element;
  merge(c, def.profile);
  const base = c.name;
  c.name = def.prefix.endsWith("-") ? `${def.prefix}${base}` : `${def.prefix}${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  // Small foes a little (1d2), bigger ones more (1d4) – a flavour, not a new monster.
  const extra = c.maxHp < 20 ? "1d2" : "1d4";
  for (const a of c.attacks) a.damage = [...a.damage, { dice: extra, type: def.damage }];
}

/** How a damage type works against this creature: 2, 0.5, 0 or 1. */
export function effectiveness(c: Pick<Creature, "vulnerabilities" | "resistances" | "immunities">, type: DamageType): number {
  if (c.immunities.includes(type)) return 0;
  if (c.resistances.includes(type)) return 0.5;
  if (c.vulnerabilities.includes(type)) return 2;
  return 1;
}

/** One key per kind of foe (the same goblin kind shares what the heroes learned). */
export function typeKey(c: Pick<Creature, "monsterId" | "element">): string {
  return `${c.monsterId ?? "?"}${c.element ? `:${c.element}` : ""}`;
}

export const TYPE_ICON: Partial<Record<DamageType, string>> = {
  fire: "🔥", cold: "❄️", lightning: "⚡", thunder: "💥", poison: "🟢", acid: "🧪", radiant: "✨", necrotic: "💀", psychic: "🧠", force: "🔮",
  bludgeoning: "🔨", piercing: "🏹", slashing: "🗡️",
};

export const TYPE_NAME: Record<DamageType, string> = {
  fire: "Feuer", cold: "Kälte", lightning: "Blitz", thunder: "Donner", poison: "Gift", acid: "Säure", radiant: "Strahlend", necrotic: "Nekrotisch",
  psychic: "Psychisch", force: "Kraft", bludgeoning: "Wucht", piercing: "Stich", slashing: "Hieb",
};

/** "×2 sehr effektiv" and friends. */
export function effectLabel(mult: number): string {
  return mult === 0 ? "wirkt nicht" : mult < 1 ? "×½ nicht sehr effektiv" : mult > 1 ? "×2 sehr effektiv" : "×1 normal";
}
export const ELEMENT_CHANCE = 0.18;
