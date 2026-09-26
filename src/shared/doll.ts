/**
 * The character builder: a figure is a stack of DCSS "paper doll" layers.
 * Part IDs match the frames "doll.<layer>.<id>" in public/assets/tileset.json.
 */

export const DOLL_LAYERS = ["base", "cloak", "boots", "legs", "body", "weapon", "shield", "hair", "beard", "head"] as const;
export type DollLayer = (typeof DOLL_LAYERS)[number];

export type DollLook = { base: string } & Partial<Record<Exclude<DollLayer, "base">, string>>;

/** Options the phone offers, with German labels. `null` = nothing. */
export const DOLL_OPTIONS: Record<Exclude<DollLayer, "base" | "boots" | "legs">, { id: string | null; label: string }[]> = {
  hair: [
    { id: null, label: "Glatze" },
    { id: "short_black", label: "Kurz, schwarz" },
    { id: "short_red", label: "Kurz, rot" },
    { id: "short_yellow", label: "Kurz, blond" },
    { id: "short_white", label: "Kurz, weiß" },
    { id: "brown", label: "Wuschelig, braun" },
    { id: "long_black", label: "Lang, schwarz" },
    { id: "long_red", label: "Lang, rot" },
    { id: "long_yellow", label: "Lang, blond" },
    { id: "long_white", label: "Lang, weiß" },
    { id: "pigtails", label: "Zöpfe" },
    { id: "ponytail", label: "Pferdeschwanz" },
    { id: "knot", label: "Dutt" },
  ],
  beard: [
    { id: null, label: "Kein Bart" },
    { id: "short_black", label: "Kurz, schwarz" },
    { id: "short_red", label: "Kurz, rot" },
    { id: "short_yellow", label: "Kurz, blond" },
    { id: "short_white", label: "Kurz, weiß" },
    { id: "long_black", label: "Lang, schwarz" },
    { id: "long_red", label: "Lang, rot" },
    { id: "long_white", label: "Lang, weiß" },
  ],
  body: [
    { id: "chainmail", label: "Kettenpanzer" },
    { id: "plate", label: "Plattenrüstung" },
    { id: "half_plate", label: "Halbe Platte" },
    { id: "scalemail", label: "Schuppenpanzer" },
    { id: "leather", label: "Lederrüstung" },
    { id: "leather_green", label: "Grünes Leder" },
    { id: "jacket", label: "Nietenjacke" },
    { id: "robe_blue", label: "Blaue Robe" },
    { id: "robe_red", label: "Rote Robe" },
    { id: "robe_green", label: "Grüne Robe" },
    { id: "robe_white", label: "Weiße Robe" },
    { id: "robe_purple", label: "Lila Robe" },
    { id: "shirt", label: "Hemd" },
  ],
  weapon: [
    { id: "longsword", label: "Langschwert" },
    { id: "greatsword", label: "Zweihänder" },
    { id: "rapier", label: "Rapier" },
    { id: "shortsword", label: "Kurzschwert" },
    { id: "dagger", label: "Dolch" },
    { id: "mace", label: "Streitkolben" },
    { id: "hammer", label: "Hammer" },
    { id: "axe", label: "Handaxt" },
    { id: "battleaxe", label: "Streitaxt" },
    { id: "spear", label: "Speer" },
    { id: "staff", label: "Kampfstab" },
    { id: "magestaff", label: "Zauberstab" },
    { id: "bow", label: "Bogen" },
    { id: "crossbow", label: "Armbrust" },
    { id: null, label: "Keine" },
  ],
  shield: [
    { id: null, label: "Kein Schild" },
    { id: "kite", label: "Drachenschild" },
    { id: "knight", label: "Ritterschild" },
    { id: "round", label: "Rundschild" },
    { id: "buckler", label: "Faustschild" },
    { id: "holy", label: "Heiliger Schild" },
  ],
  cloak: [
    { id: null, label: "Kein Umhang" },
    { id: "red", label: "Rot" },
    { id: "blue", label: "Blau" },
    { id: "green", label: "Grün" },
    { id: "black", label: "Schwarz" },
    { id: "white", label: "Weiß" },
    { id: "yellow", label: "Gelb" },
  ],
  head: [
    { id: null, label: "Nichts" },
    { id: "helm", label: "Federhelm" },
    { id: "iron", label: "Eisenhelm" },
    { id: "viking", label: "Hörnerhelm" },
    { id: "wizard", label: "Zauberhut, blau" },
    { id: "wizard_red", label: "Zauberhut, rot" },
    { id: "hood", label: "Kapuze, grün" },
    { id: "hood_red", label: "Kapuze, rot" },
    { id: "crown", label: "Krone" },
  ],
};

/** Legs and boots follow the chosen body armour automatically (fewer choices for beginners). */
const LEGS_FOR_BODY: Record<string, [legs: string | undefined, boots: string | undefined]> = {
  chainmail: ["black", "gray"],
  plate: ["armor", "gray"],
  half_plate: ["metal", "gray"],
  scalemail: ["brown", "brown"],
  leather: ["black", "short"],
  leather_green: ["brown", "short"],
  jacket: ["blue", "brown"],
  shirt: ["brown", "short"],
};

export function withAutoParts(look: DollLook): DollLook {
  const out: DollLook = { ...look };
  delete out.legs;
  delete out.boots;
  const [legs, boots] = LEGS_FOR_BODY[look.body ?? ""] ?? [undefined, "brown"];
  if (legs) out.legs = legs;
  if (boots) out.boots = boots;
  return out;
}

export function baseOptions(raceId: string): { id: string; label: string }[] {
  return [
    { id: `${raceId}_1`, label: "Figur 1" },
    { id: `${raceId}_2`, label: "Figur 2" },
  ];
}

/** Sensible starting look for class and people. */
export function defaultLook(classId: string, raceId: string, variant: 1 | 2 = 1): DollLook {
  const base = `${raceId}_${variant}`;
  const hair = raceId === "dwarf" ? "short_red" : raceId === "elf" ? "long_yellow" : "short_black";
  const beard = raceId === "dwarf" && variant === 1 ? "long_red" : undefined;
  const byClass: Record<string, Omit<DollLook, "base">> = {
    fighter: { body: "chainmail", weapon: "longsword", shield: "kite" },
    paladin: { body: "plate", weapon: "longsword", shield: "knight", cloak: "white" },
    wizard: { body: "robe_blue", weapon: "magestaff", head: "wizard" },
    rogue: { body: "leather", weapon: "rapier", cloak: "black" },
    cleric: { body: "scalemail", weapon: "mace", shield: "holy" },
  };
  return withAutoParts({ base, hair, ...(beard ? { beard } : {}), ...(byClass[classId] ?? {}) });
}

export function frameName(layer: DollLayer, id: string): string {
  return `doll.${layer}.${id}`;
}

/** Frames to draw, bottom to top. */
export function dollFrames(look: DollLook): string[] {
  const full = withAutoParts(look);
  return DOLL_LAYERS.flatMap((layer) => {
    const id = full[layer];
    return id ? [frameName(layer, id)] : [];
  });
}
