/**
 * Animal companions: stray dogs, cats, ravens and wolves the heroes can tame.
 * Each one is unique: its own name and one special gift. They follow their hero, fight in their own
 * turns, come along into the next adventure – and can die.
 */
export type CompanionKind = "dog" | "cat" | "raven" | "wolf";

export interface CompanionTrait {
  id: string;
  name: string;
  text: string;
}

export interface CompanionKindDef {
  kind: CompanionKind;
  monster: string;
  icon: string;
  name: string;
  /** What it takes to tame it: an item or some gold. */
  lure: { itemId?: string; gold?: number; label: string };
  /** Animal Handling DC. */
  dc: number;
  names: string[];
  traits: CompanionTrait[];
  /** Extra hit points per hero level (they grow with their hero). */
  hpPerLevel: number;
}

export const COMPANIONS: Record<CompanionKind, CompanionKindDef> = {
  dog: {
    kind: "dog",
    monster: "mastiff",
    icon: "🐕",
    name: "Hund",
    lure: { itemId: "knochen", label: "Knochen" },
    dc: 10,
    names: ["Struppi", "Bello", "Hasso", "Rex", "Lumpi", "Wuschel", "Brocken", "Harzer", "Bodo", "Krümel"],
    traits: [
      { id: "spuernase", name: "Spürnase", text: "Beim Umsehen hat sein Mensch Vorteil." },
      { id: "beisser", name: "Beißer", text: "Beißt fester: +2 Schaden." },
      { id: "zaeh", name: "Zäh", text: "Hält mehr aus: +6 Trefferpunkte." },
    ],
    hpPerLevel: 3,
  },
  cat: {
    kind: "cat",
    monster: "cat",
    icon: "🐈",
    name: "Katze",
    lure: { itemId: "heilkraut", label: "Heilkraut (Katzenminze)" },
    dc: 12,
    names: ["Mieze", "Tiger", "Minka", "Schnurri", "Pfote", "Samtpfote", "Mohrle", "Flocke", "Nebel", "Gräfin"],
    traits: [
      { id: "glueckskatze", name: "Glückskatze", text: "Zu Beginn jedes Kampfes hat der erste Angriff ihres Menschen Vorteil." },
      { id: "maeusejaeger", name: "Mäusejäger", text: "Schleppt an jedem neuen Ort ein paar Münzen aus Mauselöchern an." },
      { id: "flink", name: "Flink", text: "Schwer zu treffen: +2 Rüstungsklasse." },
    ],
    hpPerLevel: 3,
  },
  raven: {
    kind: "raven",
    monster: "raven",
    icon: "🐦‍⬛",
    name: "Rabe",
    lure: { gold: 3, label: "3 Goldmünzen" },
    dc: 12,
    names: ["Hugin", "Munin", "Krah", "Schwärzling", "Federich", "Kolk", "Rabatz", "Nachtschwinge"],
    traits: [
      { id: "spaeher", name: "Späher", text: "Fliegt voraus: an jedem neuen Ort ist ein weiterer Raum schon aufgedeckt." },
      { id: "elster", name: "Diebische Seele", text: "Bringt an jedem neuen Ort eine Zutat zum Brauen mit." },
      { id: "augenpicker", name: "Augenpicker", text: "Wen er trifft, der ist abgelenkt: der nächste Angriff gegen ihn hat Vorteil." },
    ],
    hpPerLevel: 2,
  },
  wolf: {
    kind: "wolf",
    monster: "wolf",
    icon: "🐺",
    name: "Wolf",
    lure: { itemId: "knochen", label: "Knochen" },
    dc: 14,
    names: ["Grauer", "Silberpfote", "Nachtheuler", "Fenris", "Wolke", "Isegrim", "Schatten"],
    traits: [
      { id: "heuler", name: "Heuler", text: "Zu Beginn jedes Kampfes heult er: alle Gegner in der Nähe sind abgelenkt." },
      { id: "zaeh", name: "Zäh", text: "Hält mehr aus: +6 Trefferpunkte." },
      { id: "beisser", name: "Beißer", text: "Beißt fester: +2 Schaden." },
    ],
    hpPerLevel: 3,
  },
};

/** What a hero's companion is (kept in the hero book). */
export interface CompanionInfo {
  kind: CompanionKind;
  name: string;
  trait: string;
}

export function traitOf(info: CompanionInfo): CompanionTrait | undefined {
  return COMPANIONS[info.kind]?.traits.find((t) => t.id === info.trait);
}

/** A new, unique companion: a name nobody in the group uses yet, and one gift. */
export function newCompanion(kind: CompanionKind, taken: string[], pick: (n: number) => number): CompanionInfo {
  const def = COMPANIONS[kind];
  const free = def.names.filter((n) => !taken.includes(n));
  const name = free.length ? free[pick(free.length)]! : `${def.names[pick(def.names.length)]} ${taken.length + 1}`;
  const trait = def.traits[pick(def.traits.length)]!.id;
  return { kind, name, trait };
}

/** The TV never trusts a phone blindly. */
export function sanitizeCompanion(raw: unknown): CompanionInfo | undefined {
  const c = raw as Partial<CompanionInfo> | undefined;
  if (!c || typeof c !== "object" || typeof c.kind !== "string" || !(c.kind in COMPANIONS)) return undefined;
  const def = COMPANIONS[c.kind as CompanionKind];
  if (typeof c.trait !== "string" || !def.traits.some((t) => t.id === c.trait)) return undefined;
  const name = typeof c.name === "string" ? c.name.replace(/[<>]/g, "").trim().slice(0, 24) : "";
  return { kind: c.kind as CompanionKind, name: name || def.names[0]!, trait: c.trait };
}

/** Which animals may stray around in which kind of place: [kind, chance per map]. */
export const WILD: Partial<Record<string, [CompanionKind, number][]>> = {
  village: [["dog", 0.5], ["cat", 0.3]],
  town: [["dog", 0.35], ["cat", 0.4], ["raven", 0.2]],
  tavern: [["cat", 0.5], ["dog", 0.3]],
  forest: [["raven", 0.35], ["wolf", 0.25]],
  meadow: [["dog", 0.25], ["raven", 0.3]],
  peak: [["raven", 0.4], ["wolf", 0.2]],
  castle: [["dog", 0.3], ["cat", 0.2]],
  church: [["cat", 0.3], ["raven", 0.2]],
  crypt: [["raven", 0.25]],
};
