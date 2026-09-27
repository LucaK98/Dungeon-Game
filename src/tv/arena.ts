/**
 * Boss arenas: the fight against a boss changes the room as the boss weakens.
 * At two thirds and one third of its hit points a new phase starts (a banner on the TV),
 * and each round the arena does its thing: the ceiling cracks and comes down, lava bursts,
 * the swamp rises, webs spread, the lights go out.
 * Falling rocks are announced a round ahead (red circles) – step out of the way!
 */
import { addCondition, applyDamage, isActive } from "../engine/combat";
import { savingThrow } from "../engine/core";
import { parseDice, rollDice } from "../engine/dice";
import type { Rng } from "../engine/rng";
import { isOutdoorCell } from "../map/props";
import type { Battle, Creature, GridPos } from "../shared/game";
import { cellIndex, inBounds, type DungeonMap } from "../shared/map";
import { fireHits, type WorldResult } from "./environment";

export type ArenaKind = "collapse" | "fire" | "swamp" | "webs" | "dark";

/** Which boss shapes its arena how. */
export const ARENA_OF: Record<string, ArenaKind> = {
  "red-dragon-wyrmling": "fire",
  ogre: "collapse",
  knight: "collapse",
  veteran: "collapse",
  "bandit-captain": "collapse",
  spy: "collapse",
  "werewolf-hybrid": "dark",
  "cult-fanatic": "dark",
  "green-hag": "swamp",
  "giant-spider": "webs",
};

const PHASE_TEXT: Record<ArenaKind, [string, string][]> = {
  collapse: [
    ["Die Decke bebt!", "Staub rieselt herab – rote Kreise zeigen, wo gleich Steine fallen. Geht da weg!"],
    ["Alles stürzt ein!", "Jetzt kracht es überall. Achtet auf die roten Kreise!"],
  ],
  fire: [
    ["Der Boden glüht!", "Aus Rissen im Boden schießen Flammen. Weicht dem Feuer aus!"],
    ["Ein Meer aus Feuer!", "Die Hitze wird unerträglich – überall brechen Flammen hervor, und die Decke bröckelt."],
  ],
  swamp: [
    ["Der Sumpf steigt!", "Brackiges Wasser quillt aus dem Boden. Schlamm kostet doppelte Bewegung."],
    ["Alles versinkt im Morast!", "Der Sumpf breitet sich weiter aus."],
  ],
  webs: [
    ["Netze überall!", "Klebrige Fäden spannen sich durch den Raum (schwieriges Gelände – aber es brennt gut!)."],
    ["Ein Kokon aus Seide!", "Noch mehr Netze. Feuer wäre jetzt eine gute Idee …"],
  ],
  dark: [
    ["Die Lichter erlöschen!", "Ein eisiger Hauch löscht Kerzen und Kohlebecken. Wer keine Fackel hat, sieht schlecht."],
    ["Finsternis!", "Kälte kriecht über den Boden – Pfützen gefrieren zu Eis."],
  ],
};

export interface ArenaState {
  bossId: string;
  kind: ArenaKind;
  phase: number;
}


function freeFloor(map: DungeonMap, p: GridPos): boolean {
  return inBounds(map, p.x, p.y) && map.cells[cellIndex(map, p.x, p.y)] === "floor" && !map.objects.some((o) => o.blocking && o.x === p.x && o.y === p.y);
}

/** A few floor squares near the heroes (where the arena strikes). */
function targets(map: DungeonMap, rng: Rng, heroes: Creature[], n: number): GridPos[] {
  const out: GridPos[] = [];
  for (let tries = 0; tries < 60 && out.length < n; tries++) {
    const h = heroes[rng.int(0, heroes.length - 1)];
    if (!h?.pos) continue;
    const p = { x: h.pos.x + rng.int(-2, 2), y: h.pos.y + rng.int(-2, 2) };
    if (freeFloor(map, p) && !out.some((q) => q.x === p.x && q.y === p.y) && !map.surface?.[cellIndex(map, p.x, p.y)]) out.push(p);
  }
  return out;
}

export interface ArenaResult extends WorldResult {
  banner?: { icon: string; title: string; text: string };
}

/** Called at every new round of a boss fight. */
export function arenaRound(state: ArenaState, map: DungeonMap, battle: Battle, rng: Rng, dc: number): ArenaResult {
  const r: ArenaResult = { lines: [], hits: [] };
  const boss = battle.creatures[state.bossId];
  if (!boss || boss.dead || !isActive(boss)) return r;
  map.surface ??= {};
  const heroes = Object.values(battle.creatures).filter((c) => c.side === "party" && isActive(c) && c.pos);
  if (!heroes.length) return r;

  // Rocks announced last round come down now.
  for (const [k, s] of Object.entries(map.surface)) {
    if (s.kind !== "warn") continue;
    const i = Number(k);
    delete map.surface[i];
    const p = { x: i % map.width, y: Math.floor(i / map.width) };
    const outdoor = isOutdoorCell(map, i);
    for (const c of Object.values(battle.creatures)) {
      if (!c.pos || c.dead || c.pos.x !== p.x || c.pos.y !== p.y) continue;
      const save = savingThrow(rng, c, "DEX", dc);
      if (save.success) {
        r.lines.push({ text: `🪨 ${c.name} springt im letzten Moment zur Seite! (Geschicklichkeit ${save.total} gegen SG ${dc})`, glossarKeys: ["boss_arena"] });
        continue;
      }
      const dmg = rollDice(rng, parseDice("2d6")).total;
      applyDamage(rng, c, dmg);
      if (isActive(c)) addCondition(c, { id: "prone" });
      r.hits.push({ targetId: c.id, amount: dmg });
      r.lines.push({ text: `🪨 ${outdoor ? "Ein Ast" : "Ein Felsbrocken"} trifft ${c.name}: ${dmg} Schaden – umgeworfen!`, glossarKeys: ["boss_arena", "zustand:prone"] });
    }
    if (!map.objects.some((o) => o.x === p.x && o.y === p.y)) map.objects.push({ id: `rubble${i}-${map.objects.length}`, kind: "prop", prop: "rubble", x: p.x, y: p.y, frame: "rubble", blocking: false });
  }

  // A new phase?
  const ratio = boss.hp / boss.maxHp;
  const phase = ratio <= 1 / 3 ? 2 : ratio <= 2 / 3 ? 1 : 0;
  if (phase > state.phase) {
    state.phase = phase;
    const [title, text] = PHASE_TEXT[state.kind][phase - 1]!;
    r.banner = { icon: state.kind === "fire" ? "🔥" : state.kind === "swamp" ? "🌊" : state.kind === "webs" ? "🕸️" : state.kind === "dark" ? "🌑" : "🪨", title, text };
    r.lines.push({ text: `⚠️ ${title} ${text}`, glossarKeys: ["boss_arena"] });
    if (state.kind === "dark") {
      for (const o of map.objects) if (o.kind === "prop" && (o.prop === "brazier" || o.prop === "candles") && o.variant !== "out") {
        o.variant = "out";
        o.frame = o.prop === "candles" ? "candles.out" : "brazier.out";
      }
      map.dark = true;
      if (phase === 2) for (const [k, s] of Object.entries(map.surface)) if (s.kind === "puddle") map.surface[Number(k)] = { kind: "ice", turns: 6 };
    }
  }
  if (!state.phase) return r;

  // What the arena does every round from the first phase on.
  const n = state.phase + 1;
  switch (state.kind) {
    case "collapse":
      for (const p of targets(map, rng, heroes, n + 1)) map.surface[cellIndex(map, p.x, p.y)] = { kind: "warn", turns: 1 };
      break;
    case "fire": {
      const spots = targets(map, rng, heroes, n);
      for (const p of spots) map.surface[cellIndex(map, p.x, p.y)] = { kind: "fire", turns: 2 };
      if (spots.length) r.lines.push({ text: "🔥 Flammen schießen aus dem Boden!", glossarKeys: ["feuer", "boss_arena"] });
      r.lines.push(...fireHits(map, rng, spots).lines.filter((l) => !l.text.startsWith("💧")));
      if (state.phase === 2) for (const p of targets(map, rng, heroes, 2)) map.surface[cellIndex(map, p.x, p.y)] = { kind: "warn", turns: 1 };
      break;
    }
    case "swamp":
      for (const p of targets(map, rng, heroes, n + 2)) map.surface[cellIndex(map, p.x, p.y)] = { kind: "mud" };
      break;
    case "webs":
      for (const p of targets(map, rng, heroes, n + 1)) {
        if (!map.objects.some((o) => o.x === p.x && o.y === p.y)) map.objects.push({ id: `web${p.x}-${p.y}-${map.objects.length}`, kind: "prop", prop: "web", x: p.x, y: p.y, frame: "web", blocking: false });
      }
      break;
    case "dark":
      break;
  }
  return r;
}

/** The arena a fight gets (if its boss has one), e.g. for the TV banner at the start. */
export function arenaFor(boss: Creature): ArenaState | undefined {
  const kind = boss.monsterId ? ARENA_OF[boss.monsterId] : undefined;
  return kind ? { bossId: boss.id, kind, phase: 0 } : undefined;
}
