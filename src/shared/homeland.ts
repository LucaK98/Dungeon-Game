/**
 * Between adventures: the heroes' home village (built up with gold from the adventures) and the
 * saga of everything they lived through (earlier endings come back: old friends help, old foes return).
 * Both are kept on the TV (the group's device), not on the phones.
 */

// ---------------------------------------------------------------- the village

export interface Building {
  id: string;
  icon: string;
  name: string;
  price: number;
  /** What it does, for the TV and the phones. */
  text: string;
}

export const BUILDINGS: Building[] = [
  { id: "kraeuterhuette", icon: "🌿", name: "Kräuterhütte", price: 120, text: "Jeder Held bricht mit einem Heiltrank und zwei Heilkräutern mehr auf." },
  { id: "taverne", icon: "🍺", name: "Taverne „Zum Heimkehrer“", price: 120, text: "Stammtisch-Kasse: Jeder Held startet mit 5 Gold mehr." },
  { id: "zwinger", icon: "🐕", name: "Hundezwinger", price: 150, text: "Im ersten Raum jedes Abenteuers wartet ein Hund auf einen Menschen. Begleiter sind an jedem neuen Ort wieder gesund." },
  { id: "schmiede", icon: "⚒️", name: "Schmiede", price: 180, text: "Frisch geschärft: +1 Schaden mit allen Waffen." },
  { id: "wachturm", icon: "🗼", name: "Wachturm", price: 210, text: "Späher melden alles: An jedem neuen Ort sind alle Räume schon aufgedeckt." },
  { id: "tempel", icon: "⛪", name: "Tempel", price: 270, text: "Einmal pro Abenteuer steht der erste Held, der zu Boden geht, sofort wieder auf." },
];

export interface Village {
  gold: number;
  built: string[];
}

export function buildingById(id: string): Building | undefined {
  return BUILDINGS.find((b) => b.id === id);
}

/** Gold the village gets from an adventure: more for a win and for a bigger group. */
export function villageIncome(won: boolean, heroes: number): number {
  return won ? 10 + 5 * heroes : 2 * heroes;
}

export function build(v: Village, id: string): string | undefined {
  const b = buildingById(id);
  if (!b) return "Dieses Gebäude gibt es nicht.";
  if (v.built.includes(id)) return "Das steht schon.";
  if (v.gold < b.price) return `Dafür fehlen noch ${b.price - v.gold} Gold.`;
  v.gold -= b.price;
  v.built.push(id);
  return undefined;
}

export function sanitizeVillage(raw: unknown): Village {
  const v = raw as Partial<Village> | undefined;
  return {
    gold: Math.max(0, Math.min(99999, Math.floor(Number(v?.gold) || 0))),
    built: (Array.isArray(v?.built) ? v!.built : []).filter((id): id is string => typeof id === "string" && !!buildingById(id)).filter((id, i, a) => a.indexOf(id) === i),
  };
}

// ---------------------------------------------------------------- the saga

export interface SagaNpc {
  monster: string;
  name: string;
}

export interface SagaEntry {
  storyId: string;
  title: string;
  endingTitle: string;
  kind: "sieg" | "bittersuess" | "friedlich" | "scheitern";
  heroes: string[];
  at: number;
  /** Someone the heroes won over: may come to help later. */
  ally?: SagaNpc;
  /** The foe who got away: may come back for revenge. */
  nemesis?: SagaNpc;
  /** Ally/nemesis already came back once (they don't keep coming). */
  allyDone?: boolean;
  nemesisDone?: boolean;
}

export interface Saga {
  entries: SagaEntry[];
}

/** What the saga brings into the next adventure. */
export interface SagaCarry {
  /** "Beim letzten Mal …" */
  recap?: string;
  ally?: SagaNpc & { from: string };
  nemesis?: SagaNpc & { from: string };
}

export function sagaCarry(saga: Saga): SagaCarry {
  const out: SagaCarry = {};
  const last = saga.entries[saga.entries.length - 1];
  if (last) out.recap = `Beim letzten Mal – „${last.title}“: ${last.endingTitle}.`;
  const friend = [...saga.entries].reverse().find((e) => e.ally && !e.allyDone && e.kind !== "scheitern");
  if (friend?.ally) out.ally = { ...friend.ally, from: friend.title };
  const foe = [...saga.entries].reverse().find((e) => e.nemesis && !e.nemesisDone && (e.kind === "scheitern" || e.kind === "bittersuess"));
  if (foe?.nemesis) out.nemesis = { ...foe.nemesis, from: foe.title };
  return out;
}

/** After an adventure: the ally and nemesis that came back are used up. */
export function markCarried(saga: Saga, carry: SagaCarry): void {
  for (const e of saga.entries) {
    if (carry.ally && e.title === carry.ally.from && e.ally?.name === carry.ally.name) e.allyDone = true;
    if (carry.nemesis && e.title === carry.nemesis.from && e.nemesis?.name === carry.nemesis.name) e.nemesisDone = true;
  }
}

export function sanitizeSaga(raw: unknown): Saga {
  const s = raw as Partial<Saga> | undefined;
  const npc = (n: unknown): SagaNpc | undefined => {
    const x = n as Partial<SagaNpc> | undefined;
    return x && typeof x.monster === "string" && typeof x.name === "string" ? { monster: x.monster.slice(0, 40), name: x.name.slice(0, 60) } : undefined;
  };
  const entries = (Array.isArray(s?.entries) ? s!.entries : [])
    .filter((e): e is SagaEntry => !!e && typeof e.title === "string" && typeof e.endingTitle === "string")
    .map((e) => {
      const ally = npc(e.ally);
      const nemesis = npc(e.nemesis);
      return {
        storyId: String(e.storyId ?? ""),
        title: e.title.slice(0, 80),
        endingTitle: e.endingTitle.slice(0, 80),
        kind: (["sieg", "bittersuess", "friedlich", "scheitern"] as const).includes(e.kind) ? e.kind : "sieg",
        heroes: (Array.isArray(e.heroes) ? e.heroes : []).filter((h): h is string => typeof h === "string").slice(0, 6),
        at: Number(e.at) || 0,
        ...(ally ? { ally } : {}),
        ...(nemesis ? { nemesis } : {}),
        ...(e.allyDone ? { allyDone: true } : {}),
        ...(e.nemesisDone ? { nemesisDone: true } : {}),
      };
    });
  return { entries: entries.slice(-30) };
}
