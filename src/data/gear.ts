/**
 * Equipment to find and buy: magic weapons and armour (+1) and a few trinkets.
 * Kept small and simple for beginners: every piece does one clear thing.
 */
import type { DollLayer } from "../shared/doll";

export type GearSlot = "weapon" | "armor" | "trinket";

export interface Gear {
  id: string;
  name: string;
  slot: GearSlot;
  /** SRD weapon or armour it is made from. */
  base?: string;
  /** +1: to hit and damage (weapons), armour class (armour, ring). */
  bonus: number;
  /** Trinkets: what they do. */
  effect?: "ac" | "hp" | "speed";
  price: number;
  icon: string;
  /** One line for the phone. */
  detail: string;
  /** How it looks on the figure. */
  doll?: { layer: Exclude<DollLayer, "base">; id: string };
}

export const GEAR: Gear[] = [
  { id: "longsword+1", name: "Runenschwert", slot: "weapon", base: "longsword", bonus: 1, price: 40, icon: "🗡️", detail: "Langschwert +1: trifft besser und macht mehr Schaden", doll: { layer: "weapon", id: "longsword" } },
  { id: "greatsword+1", name: "Drachenzahn-Zweihänder", slot: "weapon", base: "greatsword", bonus: 1, price: 50, icon: "⚔️", detail: "Zweihänder +1", doll: { layer: "weapon", id: "greatsword" } },
  { id: "battleaxe+1", name: "Zwergenaxt", slot: "weapon", base: "battleaxe", bonus: 1, price: 40, icon: "🪓", detail: "Streitaxt +1", doll: { layer: "weapon", id: "battleaxe" } },
  { id: "warhammer+1", name: "Donnerhammer", slot: "weapon", base: "warhammer", bonus: 1, price: 40, icon: "🔨", detail: "Kriegshammer +1", doll: { layer: "weapon", id: "hammer" } },
  { id: "mace+1", name: "Heiliger Streitkolben", slot: "weapon", base: "mace", bonus: 1, price: 35, icon: "🔱", detail: "Streitkolben +1", doll: { layer: "weapon", id: "mace" } },
  { id: "rapier+1", name: "Flüsterklinge", slot: "weapon", base: "rapier", bonus: 1, price: 40, icon: "🤺", detail: "Rapier +1", doll: { layer: "weapon", id: "rapier" } },
  { id: "shortsword+1", name: "Elfenklinge", slot: "weapon", base: "shortsword", bonus: 1, price: 35, icon: "🗡️", detail: "Kurzschwert +1", doll: { layer: "weapon", id: "shortsword" } },
  { id: "dagger+1", name: "Mondsilberdolch", slot: "weapon", base: "dagger", bonus: 1, price: 25, icon: "🔪", detail: "Dolch +1 (auch zum Werfen)", doll: { layer: "weapon", id: "dagger" } },
  { id: "shortbow+1", name: "Jägerbogen", slot: "weapon", base: "shortbow", bonus: 1, price: 40, icon: "🏹", detail: "Kurzbogen +1", doll: { layer: "weapon", id: "bow" } },
  { id: "longbow+1", name: "Eibenbogen", slot: "weapon", base: "longbow", bonus: 1, price: 50, icon: "🏹", detail: "Langbogen +1", doll: { layer: "weapon", id: "bow" } },
  { id: "crossbow-light+1", name: "Präzisionsarmbrust", slot: "weapon", base: "crossbow-light", bonus: 1, price: 40, icon: "🎯", detail: "Leichte Armbrust +1", doll: { layer: "weapon", id: "crossbow" } },
  { id: "quarterstaff+1", name: "Wanderstab der Weisen", slot: "weapon", base: "quarterstaff", bonus: 1, price: 30, icon: "🪄", detail: "Kampfstab +1", doll: { layer: "weapon", id: "magestaff" } },
  { id: "studded-leather+1", name: "Schattenleder", slot: "armor", base: "studded-leather-armor", bonus: 1, price: 45, icon: "🧥", detail: "Beschlagenes Leder +1 (leichte Rüstung)", doll: { layer: "body", id: "leather_green" } },
  { id: "chain-shirt+1", name: "Elfenkettenhemd", slot: "armor", base: "chain-shirt", bonus: 1, price: 50, icon: "🥋", detail: "Kettenhemd +1 (mittlere Rüstung)", doll: { layer: "body", id: "chainmail" } },
  { id: "scale-mail+1", name: "Drachenschuppenpanzer", slot: "armor", base: "scale-mail", bonus: 1, price: 55, icon: "🐉", detail: "Schuppenpanzer +1 (mittlere Rüstung)", doll: { layer: "body", id: "scalemail" } },
  { id: "chain-mail+1", name: "Paladinplatte", slot: "armor", base: "chain-mail", bonus: 1, price: 60, icon: "🛡️", detail: "Kettenpanzer +1 (schwere Rüstung)", doll: { layer: "body", id: "half_plate" } },
  { id: "ring-protection", name: "Schutzring", slot: "trinket", bonus: 1, effect: "ac", price: 45, icon: "💍", detail: "+1 Rüstungsklasse, für alle" },
  { id: "amulet-health", name: "Amulett der Lebenskraft", slot: "trinket", bonus: 5, effect: "hp", price: 40, icon: "📿", detail: "+5 maximale Trefferpunkte, für alle" },
  { id: "boots-travel", name: "Stiefel des Wanderers", slot: "trinket", bonus: 10, effect: "speed", price: 35, icon: "🥾", detail: "+2 Felder Bewegung, für alle" },
];

const byId = new Map(GEAR.map((g) => [g.id, g]));

export function getGear(id: string): Gear | undefined {
  return byId.get(id);
}
