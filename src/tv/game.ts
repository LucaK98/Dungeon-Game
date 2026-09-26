/**
 * The running game on the host: turns, validation of player actions, rolls and the view each phone gets.
 * The TV is authoritative – phones only send wishes (PlayerAction).
 */
import { perform, type ActionOutcome, type CombatAction } from "../engine/actions";
import { inRange } from "../engine/attack";
import { armorClass, distanceFt, hasCondition, isActive, nextTurn, newTurn } from "../engine/combat";
import { savingThrow, skillCheck, sumParts } from "../engine/core";
import { getSpell } from "../engine/data";
import { averageOf, parseDice, rollDice } from "../engine/dice";
import { explainCheck, explainDamage, explainDeathSave, explainHp, explainOutcome, type ExplainedLine } from "../engine/explain";
import { findPath } from "../engine/grid";
import { nameOf } from "../engine/names";
import type { Rng } from "../engine/rng";
import { maxTargets, validateCast } from "../engine/spells";
import { applyDamage } from "../engine/combat";
import { isWalkable, revealAround } from "../map/walk";
import type { PlayerAction } from "../shared/events";
import type { Creature, GridPos } from "../shared/game";
import { cellIndex } from "../shared/map";
import type { PlayerId } from "../shared/types";
import type { ActionChoice, MiniMap, OrderEntry, PlayerView, RollOutcome, RollPrompt } from "../shared/view";
import type { GameSession } from "./session";

const LOG_SIZE = 40;
const MINIMAP_W = 13;
const MINIMAP_H = 11;
const LOOK_DC = 12;
const TRAP_DC = 12;

interface PendingRoll {
  prompt: RollPrompt;
  playerId: PlayerId;
  creatureId: string;
  run: () => RollOutcome | { error: string };
}

export interface GameEvents {
  /** State changed: redraw the board. */
  changed(): void;
  roll(outcome: RollOutcome): void;
  turn(name: string, color: string | undefined): void;
  roomRevealed(name: string): void;
  lines(lines: ExplainedLine[]): void;
}

export class GameController {
  private log: ExplainedLine[] = [];
  private pending: PendingRoll | undefined;
  private rollCounter = 0;
  private beginner = new Map<PlayerId, boolean>();
  private listeners: Partial<GameEvents>[] = [];

  constructor(
    readonly session: GameSession,
    private rng: Rng,
    /** Sends an event to one phone. */
    private sendTo: (playerId: PlayerId, event: import("../shared/events").GameEvent) => void,
    private sendAll: (event: import("../shared/events").GameEvent) => void,
  ) {}

  on(listener: Partial<GameEvents>): () => void {
    this.listeners.push(listener);
    return () => (this.listeners = this.listeners.filter((l) => l !== listener));
  }

  private emit<K extends keyof GameEvents>(key: K, ...args: Parameters<GameEvents[K]>): void {
    for (const l of this.listeners) (l[key] as ((...a: Parameters<GameEvents[K]>) => void) | undefined)?.(...args);
  }

  get battle() {
    return this.session.battle;
  }

  get map() {
    return this.session.map;
  }

  heroes(): Creature[] {
    return this.session.partyIds.map((id) => this.battle.creatures[id]!).filter(Boolean);
  }

  heroOf(playerId: PlayerId): Creature | undefined {
    return this.heroes().find((c) => c.playerId === playerId);
  }

  active(): Creature | undefined {
    const c = this.battle.combat;
    return c ? this.battle.creatures[c.order[c.turnIndex]!.creatureId] : undefined;
  }

  // ---------------------------------------------------------------- turns

  /** Exploration: the heroes take turns in party order. */
  start(): void {
    const order = this.heroes().map((c) => ({
      creatureId: c.id,
      total: 0,
      parts: [],
      roll: { rolls: [], natural: 0, mode: "normal" as const, reasons: [] },
    }));
    this.battle.combat = { round: 1, order, turnIndex: 0, turn: newTurn(this.heroes()[0]!), reactionUsed: {} };
    this.announceTurn();
    this.broadcast();
  }

  announceTurn(): void {
    const c = this.active();
    if (!c) return;
    this.emit("turn", c.name, c.appearance?.color);
  }

  endTurn(): void {
    this.pending = undefined;
    for (let guard = 0; guard < 10; guard++) {
      const start = nextTurn(this.rng, this.battle);
      if (start.deathSave) this.addLog(explainDeathSave(this.battle, start.deathSave));
      if (!start.skip) break;
    }
    this.announceTurn();
    this.broadcast();
  }

  // ---------------------------------------------------------------- actions

  handle(playerId: PlayerId, action: PlayerAction): void {
    if (action.kind === "set_beginner_mode") {
      this.beginner.set(playerId, action.on);
      this.sendView(playerId);
      return;
    }
    const hero = this.heroOf(playerId);
    if (!hero) return;
    if (action.kind === "roll") {
      if (!this.pending || this.pending.playerId !== playerId || this.pending.prompt.id !== action.rollId) return;
      const pending = this.pending;
      this.pending = undefined;
      const result = pending.run();
      if ("error" in result) this.sendTo(playerId, { type: "action_error", reason: result.error });
      else this.publishRoll(result);
      this.afterAction();
      return;
    }
    if (this.active()?.id !== hero.id) {
      this.sendTo(playerId, { type: "action_error", reason: `${this.active()?.name ?? "Jemand anderes"} ist gerade dran.` });
      return;
    }
    if (this.pending) {
      this.sendTo(playerId, { type: "action_error", reason: "Erst würfeln!" });
      return;
    }
    switch (action.kind) {
      case "end_turn":
        this.endTurn();
        return;
      case "move":
        this.move(playerId, hero, action.to);
        return;
      case "free_text":
        this.addLog([{ text: `${hero.name} versucht: „${action.text.slice(0, 140)}“`, glossarKeys: ["freie_aktion"] }]);
        this.broadcast();
        return;
      case "interact":
        this.interact(playerId, hero, action.objectId);
        return;
      case "check":
        this.ask(playerId, hero, { title: `Umsehen (${nameOf("skills", action.skill)})`, sides: 20, glossarKey: "umsehen" }, () => this.lookAround(hero));
        return;
      default: {
        const engineAction = this.toEngineAction(action);
        if (!engineAction) return;
        const prompt = this.promptFor(hero, action);
        const run = () => {
          const outcome = perform(this.rng, this.battle, hero.id, engineAction);
          if (!outcome.ok) return { error: outcome.reason };
          return this.outcomeToRoll(hero, prompt?.title ?? "", prompt?.sides ?? 20, outcome);
        };
        if (prompt) this.ask(playerId, hero, prompt, run);
        else {
          const result = run();
          if ("error" in result) this.sendTo(playerId, { type: "action_error", reason: result.error });
          else this.publishRoll(result);
          this.afterAction();
        }
      }
    }
  }

  private toEngineAction(a: PlayerAction): CombatAction | undefined {
    switch (a.kind) {
      case "attack":
        return { type: "attack", targetId: a.targetId, optionId: a.optionId, ...(a.smiteSlot ? { smiteSlot: a.smiteSlot } : {}) };
      case "cast":
        return { type: "cast", spellId: a.spellId, targetIds: a.targetIds, ...(a.slotLevel ? { slotLevel: a.slotLevel } : {}) };
      case "use_item":
        return { type: "use-item", itemId: a.itemId, ...(a.targetId ? { targetId: a.targetId } : {}) };
      case "feature":
        switch (a.feature) {
          case "lay-on-hands":
            return { type: "lay-on-hands", targetId: a.targetId ?? "", amount: a.amount ?? 0 };
          case "turn-undead":
            return { type: "turn-undead", targetIds: this.enemiesVisible().map((c) => c.id) };
          case "dash":
          case "disengage":
            return { type: a.feature, ...(a.bonus ? { bonus: true } : {}) };
          default:
            return { type: a.feature } as CombatAction;
        }
      default:
        return undefined;
    }
  }

  /** Which die the phone animates, or undefined if nothing is rolled by the player. */
  private promptFor(hero: Creature, a: PlayerAction): Omit<RollPrompt, "id"> | undefined {
    if (a.kind === "attack") {
      const target = this.battle.creatures[a.targetId];
      return { title: `Angriff auf ${target?.name ?? "?"}`, sides: 20, glossarKey: "angriffswurf" };
    }
    if (a.kind === "cast") {
      const spell = getSpell(a.spellId);
      const name = nameOf("spells", spell.id);
      if (spell.attack) return { title: name, sides: 20, glossarKey: `zauber:${spell.id}` };
      const dice = spell.damage?.byCharLevel?.["1"] ?? spell.damage?.bySlot?.[String(spell.level)] ?? spell.heal?.[String(spell.level)] ?? spell.hpPool?.["1"];
      if (!dice) return undefined;
      const sides = parseDice(dice, 0).terms[0]?.sides ?? 6;
      return { title: name, sides, glossarKey: `zauber:${spell.id}` };
    }
    if (a.kind === "use_item") return { title: "Heiltrank", sides: 4, glossarKey: "gegenstand:potion-of-healing" };
    if (a.kind === "feature") {
      if (a.feature === "second-wind") return { title: "Durchatmen", sides: 10, glossarKey: "merkmal:second-wind" };
      if (a.feature === "hide") return { title: "Verstecken", sides: 20, glossarKey: "verstecken" };
    }
    void hero;
    return undefined;
  }

  private ask(playerId: PlayerId, hero: Creature, prompt: Omit<RollPrompt, "id">, run: PendingRoll["run"]): void {
    const full: RollPrompt = { ...prompt, id: `r${++this.rollCounter}` };
    this.pending = { prompt: full, playerId, creatureId: hero.id, run };
    this.sendTo(playerId, { type: "request_roll", prompt: full });
    this.sendView(playerId);
  }

  private publishRoll(r: RollOutcome): void {
    this.addLog(r.lines);
    this.sendAll({ type: "roll_result", result: r });
    this.emit("roll", r);
  }

  private afterAction(): void {
    // Revealed rooms from spells like fire bolt don't exist, but death and moves change the board.
    const turn = this.battle.combat?.turn;
    const c = this.active();
    // Nothing left to do → next turn automatically.
    if (c && turn && turn.actions <= 0 && !turn.bonusAction && turn.movementLeftFt <= 0) {
      this.endTurn();
      return;
    }
    if (c && !isActive(c)) {
      this.endTurn();
      return;
    }
    this.broadcast();
  }

  private outcomeToRoll(hero: Creature, title: string, sides: number, o: ActionOutcome): RollOutcome {
    const lines = explainOutcome(this.battle, o);
    let dice: number[] = [];
    let kept = 0;
    let success: boolean | undefined;
    let crit: boolean | undefined;
    if (o.ok) {
      if (o.kind === "attack") {
        dice = o.attack.roll.rolls;
        kept = o.attack.roll.natural;
        success = o.attack.hit;
        crit = o.attack.crit;
      } else if (o.kind === "spell") {
        const first = o.spell.targets[0];
        if (first?.attack) {
          dice = first.attack.roll.rolls;
          kept = first.attack.roll.natural;
          success = first.attack.hit;
          crit = first.attack.crit;
        } else if (first?.damage) {
          dice = first.damage.lines[0]?.dice ?? [];
          kept = dice[0] ?? 0;
        } else if (first?.heal) {
          dice = first.heal.parts.filter((p) => /^W\d+$/.test(p.label)).map((p) => p.value);
          kept = dice[0] ?? 0;
        } else if (o.spell.pool) {
          dice = o.spell.pool.parts.map((p) => p.value);
          kept = dice[0] ?? 0;
        }
      } else if (o.kind === "heal") {
        dice = o.parts.filter((p) => /^W\d+$/.test(p.label)).map((p) => p.value);
        kept = dice[0] ?? 0;
      } else if (o.kind === "hide") {
        dice = o.check.roll.rolls;
        kept = o.check.roll.natural;
        success = o.check.success;
      }
    }
    return {
      id: `o${++this.rollCounter}`,
      creatureId: hero.id,
      ...(hero.playerId ? { playerId: hero.playerId } : {}),
      title,
      sides,
      dice,
      kept,
      lines,
      ...(success !== undefined ? { success } : {}),
      ...(crit !== undefined ? { crit } : {}),
    };
  }

  // ---------------------------------------------------------------- movement & exploring

  private move(playerId: PlayerId, hero: Creature, to: GridPos): void {
    const turn = this.battle.combat?.turn;
    const steps = Math.floor((turn?.movementLeftFt ?? hero.speedFt) / 5);
    const path = findPath(this.battle, hero, (p) => p.x === to.x && p.y === to.y, (p) => isWalkable(this.map, p), steps);
    if (!path || path.length === 0 || path.length > steps) {
      this.sendTo(playerId, { type: "action_error", reason: "Dorthin kommst du in diesem Zug nicht." });
      return;
    }
    // Stop on the first hidden trap on the way.
    let walk = path;
    const trapIndex = path.findIndex((p) => this.map.objects.some((o) => o.kind === "trap" && o.state === "hidden" && o.x === p.x && o.y === p.y));
    if (trapIndex >= 0) walk = path.slice(0, trapIndex + 1);
    const outcome = perform(this.rng, this.battle, hero.id, { type: "move", path: walk });
    if (!outcome.ok) {
      this.sendTo(playerId, { type: "action_error", reason: outcome.reason });
      return;
    }
    const lines = explainOutcome(this.battle, outcome);
    if (hero.pos) {
      for (const room of revealAround(this.map, hero.pos)) {
        const name = this.map.rooms[room]!.name;
        lines.push({ text: `🗺️ ${hero.name} betritt: ${name}`, glossarKeys: [] });
        this.emit("roomRevealed", name);
      }
      lines.push(...this.pickUp(hero));
      if (trapIndex >= 0) lines.push(...this.triggerTrap(hero));
    }
    this.addLog(lines);
    this.emit("lines", lines);
    this.afterAction();
  }

  private triggerTrap(hero: Creature): ExplainedLine[] {
    const trap = this.map.objects.find((o) => o.kind === "trap" && o.x === hero.pos!.x && o.y === hero.pos!.y);
    if (!trap) return [];
    trap.state = "used";
    const save = savingThrow(this.rng, hero, "DEX", TRAP_DC);
    const lines: ExplainedLine[] = [{ text: `💥 Klick! ${hero.name} tritt auf eine versteckte Falle. Pfeile schießen aus der Wand!`, glossarKeys: ["falle"] }];
    lines.push(...explainCheck(this.battle, hero.id, save));
    if (save.success) {
      lines.push({ text: `${hero.name} springt rechtzeitig zur Seite.`, glossarKeys: ["rettungswurf"] });
      return lines;
    }
    const d = rollDice(this.rng, parseDice("1d6"));
    const damage = { lines: [{ type: "piercing" as const, dice: d.dice, parts: d.dice.map((v) => ({ label: "W6", value: v, glossarKey: "w6" })), raw: d.total, final: d.total }], total: d.total, crit: false };
    lines.push(...explainDamage(damage));
    lines.push(...explainHp(this.battle, applyDamage(this.rng, hero, d.total)));
    return lines;
  }

  private pickUp(hero: Creature): ExplainedLine[] {
    const lines: ExplainedLine[] = [];
    for (const o of this.map.objects) {
      if (o.x !== hero.pos!.x || o.y !== hero.pos!.y || o.state === "used") continue;
      if (o.kind === "gold") {
        const amount = rollDice(this.rng, parseDice("2d10")).total;
        this.addItem(hero, "gold", amount);
        o.state = "used";
        lines.push({ text: `💰 ${hero.name} findet ${amount} Goldmünzen.`, glossarKeys: ["gegenstand:gold"] });
      } else if (o.kind === "potion") {
        this.addItem(hero, "potion-of-healing", 1);
        o.state = "used";
        lines.push({ text: `🧪 ${hero.name} hebt einen Heiltrank auf.`, glossarKeys: ["gegenstand:potion-of-healing"] });
      }
    }
    return lines;
  }

  private addItem(hero: Creature, itemId: string, qty: number): void {
    const inv = hero.pc?.inventory;
    if (!inv) return;
    const entry = inv.find((i) => i.itemId === itemId);
    if (entry) entry.qty += qty;
    else inv.push({ itemId, qty });
  }

  private interact(playerId: PlayerId, hero: Creature, objectId: string): void {
    const o = this.map.objects.find((x) => x.id === objectId);
    if (!o || !hero.pos || Math.max(Math.abs(o.x - hero.pos.x), Math.abs(o.y - hero.pos.y)) > 1) {
      this.sendTo(playerId, { type: "action_error", reason: "Dafür musst du direkt daneben stehen." });
      return;
    }
    const lines: ExplainedLine[] = [];
    if (o.kind === "chest" && o.state !== "open") {
      o.state = "open";
      o.frame = "chest.open";
      if (this.rng.next() < 0.5) {
        this.addItem(hero, "potion-of-healing", 1);
        lines.push({ text: `🧰 ${hero.name} öffnet die Truhe und findet einen Heiltrank!`, glossarKeys: ["truhe", "gegenstand:potion-of-healing"] });
      } else {
        const amount = rollDice(this.rng, parseDice("3d10")).total;
        this.addItem(hero, "gold", amount);
        lines.push({ text: `🧰 ${hero.name} öffnet die Truhe: ${amount} Goldmünzen!`, glossarKeys: ["truhe", "gegenstand:gold"] });
      }
    } else if (o.kind === "door") {
      o.state = o.state === "open" ? "closed" : "open";
      o.frame = o.state === "open" ? "door.open" : "door.closed";
      o.blocking = o.state === "closed";
      lines.push({ text: `🚪 ${hero.name} ${o.state === "open" ? "öffnet" : "schließt"} die Tür.`, glossarKeys: [] });
    } else return;
    this.addLog(lines);
    this.emit("lines", lines);
    this.broadcast();
  }

  private lookAround(hero: Creature): RollOutcome | { error: string } {
    const turn = this.battle.combat?.turn;
    if (turn && turn.creatureId === hero.id) {
      if (turn.actions <= 0) return { error: "Du hast deine Aktion schon benutzt." };
      turn.actions--;
    }
    const check = skillCheck(this.rng, hero, "perception", LOOK_DC);
    const lines = explainCheck(this.battle, hero.id, check);
    const roomIndex = hero.pos ? (this.map.roomOf[cellIndex(this.map, hero.pos.x, hero.pos.y)] ?? -1) : -1;
    const traps = this.map.objects.filter((o) => o.kind === "trap" && o.state === "hidden" && (roomIndex < 0 || o.roomId === this.map.rooms[roomIndex]?.id));
    if (check.success) {
      traps.forEach((t) => (t.state = "found"));
      lines.push({
        text: traps.length
          ? `👀 ${hero.name} entdeckt ${traps.length === 1 ? "eine versteckte Falle" : `${traps.length} versteckte Fallen`} im Boden!`
          : `👀 ${hero.name} schaut sich genau um, findet aber nichts Verdächtiges.`,
        glossarKeys: ["falle"],
      });
    } else {
      lines.push({ text: `${hero.name} sieht nichts Besonderes.`, glossarKeys: [] });
    }
    return {
      id: `o${++this.rollCounter}`,
      creatureId: hero.id,
      ...(hero.playerId ? { playerId: hero.playerId } : {}),
      title: "Umsehen",
      sides: 20,
      dice: check.roll.rolls,
      kept: check.roll.natural,
      lines,
      success: check.success,
    };
  }

  // ---------------------------------------------------------------- views

  private addLog(lines: ExplainedLine[]): void {
    this.log.push(...lines);
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
  }

  broadcast(): void {
    for (const hero of this.heroes()) if (hero.playerId) this.sendView(hero.playerId);
    this.emit("changed");
  }

  sendView(playerId: PlayerId): void {
    const view = this.viewFor(playerId);
    if (view) this.sendTo(playerId, { type: "state_update", state: view });
    if (this.pending?.playerId === playerId) this.sendTo(playerId, { type: "request_roll", prompt: this.pending.prompt });
  }

  enemiesVisible(): Creature[] {
    return Object.values(this.battle.creatures).filter(
      (c) => c.side === "enemy" && !c.dead && c.pos && this.map.explored[cellIndex(this.map, c.pos.x, c.pos.y)],
    );
  }

  viewFor(playerId: PlayerId): PlayerView | undefined {
    const me = this.heroOf(playerId);
    if (!me) return undefined;
    const active = this.active();
    const turn = this.battle.combat?.turn;
    const mine = active?.id === me.id;
    const roomIndex = me.pos ? (this.map.roomOf[cellIndex(this.map, me.pos.x, me.pos.y)] ?? -1) : -1;
    const order: OrderEntry[] = (this.battle.combat?.order ?? []).map((o) => {
      const c = this.battle.creatures[o.creatureId]!;
      return {
        id: c.id,
        name: c.name,
        ...(c.appearance ? { color: c.appearance.color } : {}),
        enemy: c.side === "enemy",
        health: c.maxHp ? c.hp / c.maxHp : 0,
        active: c.id === active?.id,
      };
    });
    const view: PlayerView = {
      me,
      mode: "explore",
      round: this.battle.combat?.round ?? 1,
      turn: {
        activeId: active?.id ?? "",
        activeName: active?.name ?? "",
        ...(active?.appearance ? { activeColor: active.appearance.color } : {}),
        mine,
        movementLeftFt: mine ? (turn?.movementLeftFt ?? 0) : 0,
        actions: mine ? (turn?.actions ?? 0) + (turn?.attacksLeft ?? 0) : 0,
        bonusAction: mine ? (turn?.bonusAction ?? false) : false,
      },
      order,
      roomName: roomIndex >= 0 ? this.map.rooms[roomIndex]!.name : "Gang",
      minimap: this.minimap(me, mine),
      choices: this.choicesFor(me, mine, this.beginner.get(playerId) ?? true),
      log: this.log.slice(-15),
      beginnerMode: this.beginner.get(playerId) ?? true,
    };
    if (this.pending?.playerId === playerId) view.pendingRoll = this.pending.prompt;
    return view;
  }

  private minimap(me: Creature, mine: boolean): MiniMap {
    const map = this.map;
    const pos = me.pos ?? { x: 0, y: 0 };
    const w = Math.min(MINIMAP_W, map.width);
    const h = Math.min(MINIMAP_H, map.height);
    const x0 = Math.max(0, Math.min(map.width - w, pos.x - Math.floor(w / 2)));
    const y0 = Math.max(0, Math.min(map.height - h, pos.y - Math.floor(h / 2)));
    const frames: string[] = [];
    const overlays: (string | null)[] = [];
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = cellIndex(map, x, y);
        frames.push(map.explored[i] ? (map.frames[i] ?? "") : "");
        overlays.push(map.explored[i] ? (map.overlays[i] ?? null) : null);
      }
    }
    const inWindow = (p: GridPos) => p.x >= x0 && p.y >= y0 && p.x < x0 + w && p.y < y0 + h;
    const objects = map.objects
      .filter((o) => o.state !== "hidden" && o.state !== "used" && inWindow(o) && map.explored[cellIndex(map, o.x, o.y)])
      .map((o) => ({ x: o.x, y: o.y, frame: o.frame }));
    const creatures = Object.values(this.battle.creatures)
      .filter((c) => !c.dead && c.pos && inWindow(c.pos) && map.explored[cellIndex(map, c.pos.x, c.pos.y)])
      .map((c) => ({
        id: c.id,
        x: c.pos!.x,
        y: c.pos!.y,
        name: c.name,
        enemy: c.side === "enemy",
        me: c.id === me.id,
        ...(c.appearance ? { color: c.appearance.color, look: c.appearance.look } : {}),
        ...(c.monsterId ? { monsterId: c.monsterId } : {}),
        health: c.maxHp ? c.hp / c.maxHp : 0,
        down: c.hp === 0,
      }));
    return { x0, y0, w, h, frames, overlays, objects, creatures, reachable: mine && !this.pending ? this.reachable(me).filter(inWindow) : [] };
  }

  /** Squares reachable with the movement left (8 directions, around creatures and obstacles). */
  reachable(me: Creature): GridPos[] {
    const turn = this.battle.combat?.turn;
    const steps = Math.floor((turn?.movementLeftFt ?? 0) / 5) - (hasCondition(me, "prone") ? Math.ceil(me.speedFt / 10) : 0);
    if (!me.pos || steps <= 0) return [];
    const occupied = new Set(
      Object.values(this.battle.creatures)
        .filter((c) => c.id !== me.id && c.pos && !c.dead)
        .map((c) => `${c.pos!.x},${c.pos!.y}`),
    );
    const enemies = new Set(
      Object.values(this.battle.creatures)
        .filter((c) => c.side !== me.side && c.pos && !c.dead)
        .map((c) => `${c.pos!.x},${c.pos!.y}`),
    );
    const seen = new Map<string, number>([[`${me.pos.x},${me.pos.y}`, 0]]);
    let frontier: GridPos[] = [me.pos];
    const out: GridPos[] = [];
    for (let s = 1; s <= steps; s++) {
      const next: GridPos[] = [];
      for (const p of frontier) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const q = { x: p.x + dx, y: p.y + dy };
            const k = `${q.x},${q.y}`;
            if ((!dx && !dy) || seen.has(k) || enemies.has(k) || !isWalkable(this.map, q)) continue;
            if (!this.map.explored[cellIndex(this.map, q.x, q.y)] && !this.map.explored[cellIndex(this.map, p.x, p.y)]) continue;
            seen.set(k, s);
            next.push(q);
            if (!occupied.has(k)) out.push(q);
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  // ---------------------------------------------------------------- choices

  private choicesFor(me: Creature, mine: boolean, beginnerMode: boolean): ActionChoice[] {
    const pc = me.pc!;
    const turn = this.battle.combat?.turn;
    const hasAction = mine && ((turn?.actions ?? 0) > 0 || (turn?.attacksLeft ?? 0) > 0);
    const hasBonus = mine && !!turn?.bonusAction;
    const notMine = mine ? undefined : "Warte, bis du dran bist.";
    const enemies = this.enemiesVisible().filter(isActive);
    const allies = this.heroes().filter((c) => !c.dead);
    const choices: ActionChoice[] = [];
    const costReason = (cost: "action" | "bonus") =>
      notMine ?? (cost === "action" && !hasAction ? "Deine Aktion ist in diesem Zug schon verbraucht." : cost === "bonus" && !hasBonus ? "Deine Bonusaktion ist schon verbraucht." : undefined);

    // Attacks
    for (const option of me.attacks.filter((a) => a.source !== "unarmed")) {
      const targets = enemies.filter((e) => inRange(me, e, option));
      const toHit = sumParts(option.toHit);
      const dmg = `${option.damage.map((d) => d.dice.replace("d", "W")).join(" + ")}${sumParts(option.damageBonus) ? ` + ${sumParts(option.damageBonus)}` : ""}`;
      const reason = costReason("action") ?? (targets.length ? undefined : enemies.length ? "Kein Gegner in Reichweite. Geh näher heran." : "Hier ist kein Gegner.");
      choices.push({
        id: `attack:${option.id}`,
        group: "attack",
        label: `${nameOf("weapons", option.sourceId)}`,
        detail: `${toHit >= 0 ? "+" : ""}${toHit} zum Treffen · ${dmg} Schaden${option.kind === "ranged" ? " · Fernkampf" : option.thrown ? " · auch werfen" : ""}`,
        glossarKey: `waffe:${option.sourceId}`,
        cost: "action",
        enabled: !reason,
        ...(reason ? { reason } : {}),
        action: { kind: "attack", targetId: "", optionId: option.id },
        targets: targets.map((t) => ({ id: t.id, name: t.name, detail: `RK ${armorClass(t)} · ${Math.round(distanceFt(me, t) / 5)} Felder` })),
      });
      if (pc.features.includes("divine-smite") && option.kind === "melee" && (pc.spellSlots[0] ?? 0) > 0) {
        choices.push({
          id: `smite:${option.id}`,
          group: "attack",
          label: `${nameOf("weapons", option.sourceId)} + Göttlicher Schlag`,
          detail: "Bei einem Treffer +2W8 Glanzschaden, kostet einen Zauberplatz",
          glossarKey: "merkmal:divine-smite",
          cost: "action",
          enabled: !reason,
          ...(reason ? { reason } : {}),
          action: { kind: "attack", targetId: "", optionId: option.id, smiteSlot: 1 },
          targets: targets.map((t) => ({ id: t.id, name: t.name, detail: `RK ${armorClass(t)}` })),
        });
      }
    }

    // Spells
    for (const spellId of pc.spells) {
      const spell = getSpell(spellId);
      const slot = spell.level;
      const cost = spell.castingTime === "bonus" ? "bonus" : "action";
      const slotsLeft = slot ? (pc.spellSlots[slot - 1] ?? 0) : Infinity;
      const range = spell.rangeFt === "touch" ? 5 : spell.rangeFt === "self" ? (spell.area?.sizeFt ?? 0) : spell.rangeFt;
      const healing = !!spell.heal || spell.id === "bless" || spell.id === "shield-of-faith";
      let pool = healing ? allies : enemies;
      if (spell.id === "divine-favor") pool = [me];
      const targets = pool.filter((t) => t.id === me.id || distanceFt(me, t) <= range);
      const n = maxTargets(spell, slot || 1);
      const repeat = spell.id === "magic-missile" || spell.id === "scorching-ray";
      const area = spell.id === "burning-hands" || spell.id === "sleep";
      const reason =
        costReason(cost) ??
        (slotsLeft <= 0 ? "Keine Zauberplätze mehr. Sie kommen nach einer langen Rast zurück." : targets.length ? undefined : healing ? "Niemand in Reichweite." : "Kein Ziel in Reichweite.");
      const kurz = (spell.level === 0 ? "Zaubertrick · " : `Grad ${spell.level} · `) + (cost === "bonus" ? "Bonusaktion" : "Aktion");
      const choice: ActionChoice = {
        id: `spell:${spellId}`,
        group: "spell",
        label: nameOf("spells", spellId),
        detail: `${kurz}${slot ? ` · noch ${slotsLeft} Platz${slotsLeft === 1 ? "" : "e"}` : ""}`,
        glossarKey: `zauber:${spellId}`,
        cost,
        enabled: !reason,
        ...(reason ? { reason } : {}),
        action: { kind: "cast", spellId, targetIds: area ? targets.map((t) => t.id) : [] },
      };
      if (!area && spell.id !== "divine-favor") {
        choice.targets = targets.map((t) => ({ id: t.id, name: t.id === me.id ? `${t.name} (du)` : t.name, detail: `TP ${t.hp}/${t.maxHp}` }));
        choice.pick = { min: 1, max: n, repeat };
      } else if (spell.id === "divine-favor") {
        choice.action = { kind: "cast", spellId, targetIds: [me.id] };
      }
      // Validate the automatic part (area spells) with the engine.
      if (choice.enabled && area) {
        const err = validateCast(this.battle, me, { spellId, targetIds: targets.map((t) => t.id) });
        if (err) Object.assign(choice, { enabled: false, reason: err });
      }
      choices.push(choice);
    }

    // Items
    const potions = pc.inventory.find((i) => i.itemId === "potion-of-healing")?.qty ?? 0;
    if (potions > 0) {
      const targets = allies.filter((a) => a.id === me.id || distanceFt(me, a) <= 5);
      const reason = costReason("action");
      choices.push({
        id: "item:potion",
        group: "item",
        label: `Heiltrank (${potions})`,
        detail: "Heilt 2W4 + 2 · weckt Bewusstlose auf",
        glossarKey: "gegenstand:potion-of-healing",
        cost: "action",
        enabled: !reason,
        ...(reason ? { reason } : {}),
        action: { kind: "use_item", itemId: "potion-of-healing" },
        targets: targets.map((t) => ({ id: t.id, name: t.id === me.id ? `${t.name} (du)` : t.name, detail: `TP ${t.hp}/${t.maxHp}` })),
        pick: { min: 1, max: 1, repeat: false },
      });
    }

    // Class features and standard actions
    const feature = (id: string, label: string, detail: string, key: string, cost: "action" | "bonus" | "free", action: PlayerAction, extra?: Partial<ActionChoice>, blocked?: string) => {
      const reason = blocked ?? (cost === "free" ? notMine : costReason(cost));
      choices.push({ id, group: "ability", label, detail, glossarKey: key, cost, enabled: !reason, ...(reason ? { reason } : {}), action, ...extra });
    };
    const res = pc.resources;
    if (res["second-wind"]) {
      const left = res["second-wind"].max - res["second-wind"].used;
      feature("second-wind", "Durchatmen", `Heilt 1W10 + ${pc.level} · Bonusaktion`, "merkmal:second-wind", "bonus", { kind: "feature", feature: "second-wind" }, undefined, left ? (me.hp >= me.maxHp ? "Du bist unverletzt." : undefined) : "Schon benutzt. Kommt nach einer Rast zurück.");
    }
    if (res["action-surge"]) {
      const left = res["action-surge"].max - res["action-surge"].used;
      feature("action-surge", "Tatendrang", "Eine zusätzliche Aktion in diesem Zug", "merkmal:action-surge-1-use", "free", { kind: "feature", feature: "action-surge" }, undefined, left ? undefined : "Schon benutzt. Kommt nach einer Rast zurück.");
    }
    if (res["lay-on-hands"]) {
      const left = res["lay-on-hands"].max - res["lay-on-hands"].used;
      const targets = allies.filter((a) => (a.id === me.id || distanceFt(me, a) <= 5) && a.hp < a.maxHp);
      feature(
        "lay-on-hands",
        `Handauflegen (${left} übrig)`,
        "Heilt aus deinem Vorrat, so viel wie nötig",
        "merkmal:lay-on-hands",
        "action",
        { kind: "feature", feature: "lay-on-hands", amount: left },
        { targets: targets.map((t) => ({ id: t.id, name: t.id === me.id ? `${t.name} (du)` : t.name, detail: `TP ${t.hp}/${t.maxHp}` })), pick: { min: 1, max: 1, repeat: false } },
        left <= 0 ? "Dein Heilvorrat ist leer." : targets.length ? undefined : "Niemand neben dir ist verletzt.",
      );
    }
    if (res["channel-divinity"]) {
      const undead = enemies.filter((e) => e.creatureType === "undead" && distanceFt(me, e) <= 30);
      const left = res["channel-divinity"].max - res["channel-divinity"].used;
      feature("turn-undead", "Untote vertreiben", "Untote in 6 Feldern fliehen", "merkmal:channel-divinity-turn-undead", "action", { kind: "feature", feature: "turn-undead" }, undefined, left <= 0 ? "Schon benutzt." : undead.length ? undefined : "Keine Untoten in der Nähe.");
    }
    const cunning = pc.features.includes("cunning-action");
    feature("dash", cunning ? "Spurt (Bonusaktion)" : "Spurt", "Doppelt so weit laufen", "spurt", cunning ? "bonus" : "action", { kind: "feature", feature: "dash", bonus: cunning });
    feature("disengage", cunning ? "Rückzug (Bonusaktion)" : "Rückzug", "Weggehen ohne Gelegenheitsangriffe", "rueckzug", cunning ? "bonus" : "action", { kind: "feature", feature: "disengage", bonus: cunning });
    feature("dodge", "Ausweichen", "Angriffe gegen dich haben Nachteil", "ausweichen", "action", { kind: "feature", feature: "dodge" });
    feature("hide", cunning ? "Verstecken (Bonusaktion)" : "Verstecken", "Probe auf Heimlichkeit", "verstecken", cunning ? "bonus" : "action", { kind: "feature", feature: "hide" });
    if (hasCondition(me, "prone")) feature("stand-up", "Aufstehen", "Kostet die halbe Bewegung", "zustand:prone", "free", { kind: "feature", feature: "stand-up" });

    // Looking around and objects next to you
    {
      const reason = costReason("action");
      choices.push({
        id: "look",
        group: "look",
        label: "Umsehen",
        detail: "Wahrnehmung: Fallen und Verstecktes finden",
        glossarKey: "umsehen",
        cost: "action",
        enabled: !reason,
        ...(reason ? { reason } : {}),
        action: { kind: "check", skill: "perception" },
      });
    }
    for (const o of this.map.objects) {
      if (!me.pos || Math.max(Math.abs(o.x - me.pos.x), Math.abs(o.y - me.pos.y)) > 1) continue;
      if (o.kind === "chest" && o.state !== "open") {
        choices.push({ id: `open:${o.id}`, group: "look", label: "Truhe öffnen", detail: "Direkt neben dir · kostet nichts", glossarKey: "truhe", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
      }
      if (o.kind === "door") {
        choices.push({ id: `door:${o.id}`, group: "look", label: o.state === "open" ? "Tür schließen" : "Tür öffnen", detail: "Direkt neben dir · kostet nichts", glossarKey: "aktion", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
      }
    }
    choices.push({ id: "free", group: "free", label: "Freie Aktion", detail: "Beschreibe, was du tun willst", glossarKey: "freie_aktion", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "free_text", text: "" } });
    choices.push({ id: "end", group: "end", label: "Zug beenden", detail: "Der Nächste ist dran", glossarKey: "zug_beenden", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "end_turn" } });

    if (beginnerMode && mine) this.recommend(me, choices);
    return choices;
  }

  /** Beginner mode: highlight one sensible next step. */
  private recommend(me: Creature, choices: ActionChoice[]): void {
    const enabled = choices.filter((c) => c.enabled);
    const downed = this.heroes().find((c) => c.hp === 0 && !c.dead);
    const pick =
      (downed && enabled.find((c) => (c.id === "spell:healing-word" || c.id === "spell:cure-wounds" || c.id === "item:potion") && c.targets?.some((t) => t.id === downed.id))) ||
      (me.hp < me.maxHp / 3 && enabled.find((c) => c.id === "second-wind")) ||
      enabled
        .filter((c) => c.group === "attack" && c.targets?.length)
        .sort((a, b) => avg(b) - avg(a))[0] ||
      enabled.find((c) => c.group === "spell" && c.targets?.length && !["spell:cure-wounds", "spell:healing-word", "spell:bless", "spell:shield-of-faith"].includes(c.id)) ||
      (!this.enemiesVisible().length && enabled.find((c) => c.id === "look")) ||
      undefined;
    if (pick) pick.recommended = true;
    function avg(c: ActionChoice): number {
      const option = me.attacks.find((a) => c.action.kind === "attack" && a.id === c.action.optionId);
      return option ? option.damage.reduce((s, d) => s + averageOf(d.dice), 0) : 0;
    }
  }
}
