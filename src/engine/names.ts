import de from "../data/i18n/de.json";
import type { Ability } from "../shared/types";

type Section = Exclude<keyof typeof de, "abilities">;

/** German display name for a data ID. Falls back to the ID so missing entries are visible. */
export function nameOf(section: Section, id: string): string {
  const table = de[section] as Record<string, string>;
  return table[id] ?? id;
}

export function abilityName(a: Ability): string {
  return de.abilities[a].name;
}

export function abilityShort(a: Ability): string {
  return de.abilities[a].short;
}

export const I18N = de;
