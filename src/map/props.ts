/**
 * Furniture, plants and other props: how they look and what they mean in the rules.
 * Every prop does something – cover, difficult ground, a place to stand high, something to burn,
 * smash, throw, pick, pray at … – so the rooms are not just wallpaper.
 */
import type { Terrain } from "../shared/game";
import type { DungeonMap, MapObject, PropId } from "../shared/map";

export interface LightDef {
  color: number;
  /** In squares. */
  radius: number;
}

export interface PropDef {
  name: string;
  /** Atlas frames; one is picked per prop. */
  frames: string[];
  blocking: boolean;
  /** AC bonus for someone behind (or in) it. */
  cover?: number;
  /** Double movement to enter. */
  difficult?: boolean;
  /** Stand on it for advantage on ranged attacks downwards. */
  high?: boolean;
  /** Catches fire from fire spells, torches and neighbouring flames. */
  flammable?: boolean;
  /** Can be smashed (a chance to find something). */
  smash?: boolean;
  /** Gives light (for dark maps) and a coloured glow on the TV. */
  light?: LightDef;
  /** Glossary entry explaining it on the phone. */
  glossarKey: string;
}

export const PROPS: Record<PropId, PropDef> = {
  table: { name: "Tisch", frames: ["table"], blocking: true, cover: 2, flammable: true, glossarKey: "deckung" },
  "table-flipped": { name: "umgeworfener Tisch", frames: ["table.flipped"], blocking: true, cover: 5, flammable: true, glossarKey: "deckung" },
  stool: { name: "Hocker", frames: ["stool"], blocking: false, flammable: true, glossarKey: "werfen" },
  bench: { name: "Bank", frames: ["bench"], blocking: true, cover: 2, flammable: true, glossarKey: "deckung" },
  counter: { name: "Tresen", frames: ["counter"], blocking: true, cover: 5, flammable: true, glossarKey: "deckung" },
  bookshelf: { name: "Bücherregal", frames: ["bookshelf"], blocking: true, flammable: true, glossarKey: "buecherregal" },
  crate: { name: "Kiste", frames: ["crate"], blocking: true, cover: 2, flammable: true, smash: true, glossarKey: "zerschlagen" },
  pot: { name: "Tonkrug", frames: ["pot"], blocking: true, smash: true, glossarKey: "zerschlagen" },
  "weapon-rack": { name: "Waffenständer", frames: ["weapon-rack"], blocking: true, glossarKey: "werfen" },
  hay: { name: "Heuballen", frames: ["hay"], blocking: false, cover: 2, difficult: true, flammable: true, glossarKey: "feuer" },
  web: { name: "Spinnennetz", frames: ["web"], blocking: false, difficult: true, flammable: true, glossarKey: "schwieriges_gelaende" },
  rubble: { name: "Geröll", frames: ["rubble"], blocking: false, difficult: true, glossarKey: "schwieriges_gelaende" },
  bush: { name: "Gebüsch", frames: ["bush.0", "bush.1", "bush.2"], blocking: false, cover: 2, difficult: true, flammable: true, glossarKey: "schwieriges_gelaende" },
  thorns: { name: "Dornengestrüpp", frames: ["thorns"], blocking: false, difficult: true, flammable: true, glossarKey: "schwieriges_gelaende" },
  herbs: { name: "Heilkräuter", frames: ["herbs", "fern"], blocking: false, flammable: true, glossarKey: "kraeuter" },
  mushrooms: { name: "Pilze", frames: ["mushrooms"], blocking: false, glossarKey: "pilze" },
  "mushrooms-glow": { name: "Leuchtpilze", frames: ["mushrooms.glow"], blocking: false, light: { color: 0x4dffb0, radius: 2.2 }, glossarKey: "pilze" },
  stalagmite: { name: "Tropfstein", frames: ["stalagmite"], blocking: true, cover: 2, glossarKey: "deckung" },
  candles: { name: "Kerzenständer", frames: ["candles"], blocking: true, light: { color: 0xffc766, radius: 2.8 }, glossarKey: "licht_loeschen" },
  brazier: { name: "Kohlebecken", frames: ["brazier.lit"], blocking: true, light: { color: 0xff8a2a, radius: 3.6 }, glossarKey: "licht_loeschen" },
  well: { name: "Wunschbrunnen", frames: ["well"], blocking: true, cover: 2, glossarKey: "wunschbrunnen" },
  coffin: { name: "Sarg", frames: ["coffin"], blocking: true, cover: 2, glossarKey: "sarg" },
  stump: { name: "Baumstumpf", frames: ["stump"], blocking: false, high: true, difficult: true, glossarKey: "erhoeht" },
  "column-broken": { name: "Säulenstumpf", frames: ["column.broken"], blocking: true, cover: 2, glossarKey: "deckung" },
  stage: { name: "Bühne", frames: ["stage"], blocking: false, high: true, glossarKey: "erhoeht" },
  "rock-ledge": { name: "Felsvorsprung", frames: ["rock-ledge"], blocking: false, high: true, difficult: true, glossarKey: "erhoeht" },
};

/** Cover from the old blocking objects of the room modules. */
const OBJECT_COVER: Partial<Record<MapObject["kind"], number>> = { statue: 2, column: 2, boulder: 2, box: 2, barrel: 2, altar: 2, throne: 2, fountain: 2, chest: 2, cauldron: 2 };

export function propDef(o: MapObject): PropDef | undefined {
  return o.kind === "prop" && o.prop ? PROPS[o.prop] : undefined;
}

/** Is a prop still standing (smashed, burnt or used-up ones leave only debris)? */
export function standing(o: MapObject): boolean {
  return o.state !== "used";
}

/** Light-giving props (and whether they burn right now). */
export function propLight(o: MapObject): LightDef | undefined {
  const def = propDef(o);
  if (!def?.light || !standing(o) || o.variant === "out") return undefined;
  return def.light;
}

/** The rules' view of the map's furniture and ground (see engine/terrain.ts). */
export function terrainOf(map: DungeonMap): Terrain {
  const difficult = new Set<string>();
  const cover: Record<string, number> = {};
  const high = new Set<string>();
  const hazard = new Set<string>();
  for (let i = 0; i < map.cells.length; i++) {
    if (map.cells[i] === "water") difficult.add(`${i % map.width},${Math.floor(i / map.width)}`);
  }
  for (const o of map.objects) {
    const k = `${o.x},${o.y}`;
    const def = propDef(o);
    if (def) {
      if (!standing(o)) continue;
      if (def.difficult) difficult.add(k);
      if (def.cover) cover[k] = Math.max(cover[k] ?? 0, def.cover);
      if (def.high) high.add(k);
    } else if (o.kind === "stairs-up" || o.kind === "stairs-down") high.add(k);
    else if (OBJECT_COVER[o.kind] && o.blocking) cover[k] = Math.max(cover[k] ?? 0, OBJECT_COVER[o.kind]!);
  }
  for (const [key, s] of Object.entries(map.surface ?? {})) {
    const i = Number(key);
    const k = `${i % map.width},${Math.floor(i / map.width)}`;
    if (s.kind === "fire") hazard.add(k);
    if (s.kind === "ice") difficult.add(k);
  }
  return { difficult: [...difficult], cover, high: [...high], hazard: [...hazard] };
}

/** Prop standing on a square (if any). */
export function propAt(map: DungeonMap, x: number, y: number): MapObject | undefined {
  return map.objects.find((o) => o.kind === "prop" && o.x === x && o.y === y && standing(o));
}

