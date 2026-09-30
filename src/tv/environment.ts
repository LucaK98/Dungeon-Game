/**
 * The room reacts: fire spells set webs, hay, oil and furniture alight, the fire spreads and burns out,
 * frost turns puddles to ice, and fights leave traces (blood, scorch marks, bones).
 * Pure functions on the map and the battle; the game controller calls them and shows the lines.
 */
import { addCondition, applyDamage, isActive } from "../engine/combat";
import { savingThrow } from "../engine/core";
import { parseDice, rollDice } from "../engine/dice";
import type { ExplainedLine } from "../engine/explain";
import type { Rng } from "../engine/rng";
import { isOutdoorCell, PROPS, propDef, standing } from "../map/props";
import type { Battle, Creature, GridPos } from "../shared/game";
import { cellIndex, inBounds, type DungeonMap, type MapObject } from "../shared/map";

export interface WorldResult {
  lines: ExplainedLine[];
  hits: { targetId: string; amount: number }[];
}

const FIRE_TURNS = 3;
const ICE_TURNS = 8;
export const FIRE_DAMAGE = "1d6";
export const ICE_DC = 10;

const empty = (): WorldResult => ({ lines: [], hits: [] });

function around(p: GridPos, r = 1): GridPos[] {
  const out: GridPos[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push({ x: p.x + dx, y: p.y + dy });
  return out;
}

function flammableAt(map: DungeonMap, p: GridPos): MapObject | undefined {
  return map.objects.find((o) => o.x === p.x && o.y === p.y && standing(o) && (propDef(o)?.flammable || o.kind === "barrel"));
}

/** Sets a square on fire (if there is something to burn). Returns what caught fire. */
function igniteCell(map: DungeonMap, p: GridPos, lines: ExplainedLine[], turns = FIRE_TURNS): boolean {
  if (!inBounds(map, p.x, p.y)) return false;
  const i = cellIndex(map, p.x, p.y);
  map.surface ??= {};
  const s = map.surface[i];
  if (s?.kind === "fire") return false;
  if (s?.kind === "puddle" || s?.kind === "ice") return false;
  const thing = flammableAt(map, p);
  if (s?.kind === "oil") {
    map.surface[i] = { kind: "fire", turns: turns + 1 };
    lines.push({ text: "🔥 Das Öl auf dem Boden fängt Feuer!", glossarKeys: ["feuer"] });
    if (thing) burnUp(map, thing);
    return true;
  }
  if (!thing) return false;
  const def = propDef(thing);
  map.surface[i] = { kind: "fire", turns: thing.prop === "web" ? 1 : thing.prop === "hay" ? turns + 1 : turns };
  lines.push({ text: `🔥 ${def ? PROPS[thing.prop!].name : "Das Fass"} fängt Feuer!`, glossarKeys: ["feuer"] });
  burnUp(map, thing);
  // Chain reaction: a burning barrel bursts and splashes burning oil around.
  if (thing.kind === "barrel") {
    for (const q of around(p)) {
      if (!inBounds(map, q.x, q.y) || (q.x === p.x && q.y === p.y) || map.cells[cellIndex(map, q.x, q.y)] !== "floor") continue;
      const k = cellIndex(map, q.x, q.y);
      if (map.surface[k]?.kind === "puddle") continue;
      map.surface[k] = { kind: "fire", turns: 2 };
    }
    lines.push({ text: "💥 Das Fass platzt – brennendes Öl spritzt nach allen Seiten!", glossarKeys: ["feuer"] });
  }
  return true;
}

/** The thing is gone: webs and plants vanish, furniture leaves charred debris. */
function burnUp(map: DungeonMap, o: MapObject): void {
  o.state = "used";
  o.blocking = false;
  o.frame = o.prop === "web" || o.prop === "bush" || o.prop === "thorns" || o.prop === "herbs" || o.prop === "hay" ? "" : "debris";
  map.decals ??= {};
  map.decals[cellIndex(map, o.x, o.y)] = "scorch";
}

/** A fire spell or fire breath hits these squares: the room may catch fire. */
export function fireHits(map: DungeonMap, rng: Rng, squares: GridPos[]): WorldResult {
  const r = empty();
  const seen = new Set<string>();
  for (const sq of squares) {
    for (const p of around(sq)) {
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const centre = p.x === sq.x && p.y === sq.y;
      const s = inBounds(map, p.x, p.y) ? map.surface?.[cellIndex(map, p.x, p.y)] : undefined;
      // Oil and webs always catch; other things on the hit square always, next to it sometimes.
      const sure = centre || s?.kind === "oil" || flammableAt(map, p)?.prop === "web";
      if (sure || rng.next() < 0.35) igniteCell(map, p, r.lines);
    }
    // Frost melts.
    if (inBounds(map, sq.x, sq.y)) {
      const i = cellIndex(map, sq.x, sq.y);
      if (map.surface?.[i]?.kind === "ice") {
        map.surface[i] = { kind: "puddle" };
        r.lines.push({ text: "💧 Das Eis schmilzt zu einer Pfütze.", glossarKeys: [] });
      }
    }
  }
  return r;
}

/** A frost spell hits these squares: puddles freeze, fire goes out. */
export function coldHits(map: DungeonMap, squares: GridPos[]): WorldResult {
  const r = empty();
  map.surface ??= {};
  let froze = false;
  for (const sq of squares) {
    for (const p of around(sq)) {
      if (!inBounds(map, p.x, p.y)) continue;
      const i = cellIndex(map, p.x, p.y);
      const s = map.surface[i];
      if (s?.kind === "puddle") {
        map.surface[i] = { kind: "ice", turns: ICE_TURNS };
        froze = true;
      } else if (s?.kind === "fire" && p.x === sq.x && p.y === sq.y) {
        delete map.surface[i];
        r.lines.push({ text: "❄️ Die Kälte erstickt die Flammen.", glossarKeys: [] });
      }
    }
  }
  if (froze) r.lines.push({ text: "🧊 Die Pfütze gefriert zu spiegelglattem Eis! Wer darüber läuft, kann ausrutschen.", glossarKeys: ["eis"] });
  return r;
}

/** Sets a flammable thing next to someone alight on purpose (torch, flint). */
export function setAlight(map: DungeonMap, o: MapObject): WorldResult {
  const r = empty();
  igniteCell(map, { x: o.x, y: o.y }, r.lines);
  return r;
}

/** Tips a brazier over: burning coals spill onto the neighbouring squares. */
export function spillCoals(map: DungeonMap, rng: Rng, o: MapObject, towards: GridPos): WorldResult {
  const r = empty();
  o.state = "used";
  o.blocking = false;
  o.frame = "brazier.out";
  map.surface ??= {};
  const dx = Math.sign(towards.x - o.x);
  const dy = Math.sign(towards.y - o.y);
  const squares = [{ x: o.x + dx, y: o.y + dy }, { x: o.x + dx + (dy ? 1 : 0), y: o.y + dy + (dx ? 1 : 0) }, { x: o.x + dx - (dy ? 1 : 0), y: o.y + dy - (dx ? 1 : 0) }];
  for (const p of squares) {
    if (!inBounds(map, p.x, p.y) || map.cells[cellIndex(map, p.x, p.y)] !== "floor") continue;
    const i = cellIndex(map, p.x, p.y);
    if (map.surface[i]?.kind === "puddle") continue;
    igniteCell(map, p, r.lines);
    if (map.surface[i]?.kind !== "fire") map.surface[i] = { kind: "fire", turns: 2 };
  }
  r.lines.push({ text: "🔥 Glühende Kohlen prasseln über den Boden!", glossarKeys: ["feuer"] });
  void rng;
  return r;
}

/** Fire and ice age by one round: fire spreads to things next to it and burns out, ice melts. */
export function tickWorldSurface(map: DungeonMap, rng: Rng): WorldResult {
  const r = empty();
  const surface = map.surface;
  if (!surface) return r;
  const burning = Object.entries(surface).filter(([, s]) => s.kind === "fire").map(([k]) => Number(k));
  let doused = false;
  for (const i of burning) {
    const p = { x: i % map.width, y: Math.floor(i / map.width) };
    const open = isOutdoorCell(map, i);
    // Rain puts outdoor fires out fast; wind fans them.
    const rain = open && map.weather === "rain";
    const spread = rain ? 0 : open && map.weather === "wind" ? 0.8 : 0.5;
    for (const q of around(p)) {
      if ((q.x !== p.x || q.y !== p.y) && flammableAt(map, q) && rng.next() < spread) igniteCell(map, q, r.lines);
    }
    const s = surface[i]!;
    s.turns = (s.turns ?? FIRE_TURNS) - (rain ? 2 : 1);
    if (rain && s.turns <= 0) doused = true;
    if (s.turns <= 0) {
      delete surface[i];
      map.decals ??= {};
      map.decals[i] = "scorch";
    }
  }
  if (doused) r.lines.push({ text: "🌧️ Der Regen löscht die Flammen.", glossarKeys: ["wetter"] });
  for (const [k, s] of Object.entries(surface)) {
    if (s.kind !== "ice") continue;
    // In the snow, ice under open sky does not melt.
    if (map.weather === "snow" && isOutdoorCell(map, Number(k))) continue;
    s.turns = (s.turns ?? ICE_TURNS) - 1;
    if (s.turns <= 0) surface[Number(k)] = { kind: "puddle" };
  }
  return r;
}

/** Someone is standing in fire (walked in, or starts the turn there): 1d6 fire damage. */
export function burnCreature(rng: Rng, c: Creature): WorldResult {
  const r = empty();
  if (!isActive(c) && c.kind === "monster") return r;
  const dmg = rollDice(rng, parseDice(FIRE_DAMAGE)).total;
  applyDamage(rng, c, dmg);
  r.hits.push({ targetId: c.id, amount: dmg });
  r.lines.push({ text: `🔥 ${c.name} steht im Feuer: ${dmg} Feuerschaden!`, glossarKeys: ["feuer"] });
  return r;
}

/** Walking over ice: Dexterity save or fall over. */
export function slipOnIce(rng: Rng, c: Creature, dc: number): WorldResult {
  const r = empty();
  const save = savingThrow(rng, c, "DEX", dc);
  if (save.success) r.lines.push({ text: `🧊 ${c.name} schlittert übers Eis, bleibt aber stehen (Geschicklichkeit ${save.total} gegen SG ${dc}).`, glossarKeys: ["eis"] });
  else {
    addCondition(c, { id: "prone" });
    r.lines.push({ text: `🧊 ${c.name} rutscht auf dem Eis aus und fällt hin! (Geschicklichkeit ${save.total} gegen SG ${dc})`, glossarKeys: ["eis", "zustand:prone"] });
  }
  return r;
}

export function surfaceKind(map: DungeonMap, p: GridPos | undefined): string | undefined {
  if (!p || !inBounds(map, p.x, p.y)) return undefined;
  return map.surface?.[cellIndex(map, p.x, p.y)]?.kind;
}

/** Fights leave traces: blood where someone was hurt badly, bones where undead fall. */
export function leaveTrace(map: DungeonMap, rng: Rng, c: Creature, amount: number): void {
  if (!c.pos || amount <= 0) return;
  const i = cellIndex(map, c.pos.x, c.pos.y);
  map.decals ??= {};
  if (map.decals[i] === "scorch" || map.decals[i] === "rug") return;
  if (c.dead && c.creatureType === "undead") map.decals[i] = "bones";
  else if (c.creatureType === "undead" || c.creatureType === "construct" || c.creatureType === "elemental") return;
  else if (c.dead || amount >= 6 || rng.next() < 0.3) map.decals[i] = rng.next() < 0.5 ? "blood.0" : "blood.1";
}

/** Everyone standing on these squares. */
export function creaturesOn(battle: Battle, squares: GridPos[]): Creature[] {
  const keys = new Set(squares.map((p) => `${p.x},${p.y}`));
  return Object.values(battle.creatures).filter((c) => c.pos && !c.dead && keys.has(`${c.pos.x},${c.pos.y}`));
}

/** Weather at work: rain leaves puddles under open sky, snow freezes them. */
export function weatherTick(map: DungeonMap, rng: Rng): void {
  if (map.weather !== "rain" && map.weather !== "snow") return;
  map.surface ??= {};
  if (map.weather === "snow") {
    for (const [k, s] of Object.entries(map.surface)) if (s.kind === "puddle" && isOutdoorCell(map, Number(k))) map.surface[Number(k)] = { kind: "ice", turns: 99 };
    return;
  }
  const puddles = Object.values(map.surface).filter((s) => s.kind === "puddle").length;
  if (puddles >= 14 || rng.next() > 0.3) return;
  for (let tries = 0; tries < 20; tries++) {
    const i = rng.int(0, map.cells.length - 1);
    if (map.cells[i] !== "floor" || map.surface[i] || !isOutdoorCell(map, i) || !map.explored[i]) continue;
    if (map.objects.some((o) => o.blocking && cellIndex(map, o.x, o.y) === i)) continue;
    map.surface[i] = { kind: "puddle" };
    return;
  }
}
