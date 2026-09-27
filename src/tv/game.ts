/**
 * The running game on the host: turns, validation of player actions, rolls and the view each phone gets.
 * The TV is authoritative – phones only send wishes (PlayerAction).
 */
import { perform, type ActionOutcome, type CombatAction } from "../engine/actions";
import { inRange } from "../engine/attack";
import { addCondition, addEffect, applyDamage, armorClass, combatWinner, distanceFt, endCombat, hasCondition, hasEffect, heal, isActive, nextTurn, newTurn, squaresOf, startCombat } from "../engine/combat";
import { advantage, savingThrow, skillCheck, sumParts } from "../engine/core";
import { getSpell } from "../engine/data";
import { averageOf, parseDice, rollDice } from "../engine/dice";
import { explainCheck, explainDamage, explainDeathSave, explainHp, explainInitiative, explainOutcome, type ExplainedLine } from "../engine/explain";
import { runAutoTurn } from "../engine/ai";
import { createMonster } from "../engine/creatures";
import { findPath } from "../engine/grid";
import { nameOf } from "../engine/names";
import type { Rng } from "../engine/rng";
import { maxTargets, validateCast } from "../engine/spells";
import { isWalkable, partyStartSpots, revealAround } from "../map/walk";
import { isLit } from "../engine/vision";
import type { PlayerAction } from "../shared/events";
import type { DmEffect } from "../shared/dm";
import { BRIBE_PER_ENEMY } from "../dm/effects";
import { glossaryAnswer } from "../dm/rules-help";
import type { Creature, GridPos, TurnState } from "../shared/game";
import { cellIndex } from "../shared/map";
import type { PlayerId } from "../shared/types";
import type { ActionChoice, ActionFx, MiniMap, OrderEntry, PlayerView, RollOutcome, RollPrompt, StoryView } from "../shared/view";
import type { MonsterGroup, Narration } from "../shared/story";
import type { CheckResult } from "../shared/game";
import type { SkillId } from "../shared/rules";
import type { DungeonMap, MapObject } from "../shared/map";
import { createCharacter } from "../engine/creatures";
import { scaleGroup } from "../dm/planner";
import { getModule, moduleExits } from "../map/modules";
import type { GameSession } from "./session";

export interface StoryChoiceOffer {
  id: string;
  label: string;
  detail: string;
  recommended?: boolean;
}

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
  turn(name: string, color: string | undefined, free?: boolean): void;
  roomRevealed(name: string): void;
  lines(lines: ExplainedLine[]): void;
  combat(started: boolean): void;
  narration(lines: Narration[]): void;
  /** A new map was loaded (next scene): the board must rebuild. */
  mapChanged(): void;
  /** A boss enters: the board shows it off. */
  spotlight(creatureId: string): void;
  /** A little show on the board (dust, sparkle, splash, shaking screen) at a square. */
  fx(kind: "puff" | "shake" | "sparkle" | "splash", pos: GridPos | undefined): void;
}

export interface ControllerOptions {
  /** Pause between monster actions so everyone can follow on the TV (0 in tests). */
  monsterDelayMs?: number;
  /** Demo: heroes fight on their own, too. */
  autoHeroes?: boolean;
  /** Old behaviour: heroes explore in turns as well (default: everyone at the same time). */
  turnBasedExplore?: boolean;
}

/** Has not noticed the heroes yet (sleeping or keeping watch). */
function unaware(c: Creature): boolean {
  return hasEffect(c, "asleep") || hasEffect(c, "on-guard");
}

export class GameController {
  private log: ExplainedLine[] = [];
  private pending: PendingRoll | undefined;
  private rollCounter = 0;
  private beginner = new Map<PlayerId, boolean>();
  private listeners: Partial<GameEvents>[] = [];
  mode: "explore" | "combat" = "explore";
  private monsterTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  // Story hooks (A6): the director awaits these.
  storyView: StoryView | undefined;
  private storyChoices: StoryChoiceOffer[] = [];
  private choiceWaiter: ((choice: { id: string; playerId: PlayerId }) => void) | undefined;
  private fightWaiter: ((winner: "party" | "enemy") => void) | undefined;
  /** Monsters spawned as bosses (they never flee from a trick). */
  private bossIds = new Set<string>();
  /** The last enemies ran away instead of being beaten (changes the victory text). */
  private victoryNote: string | undefined;
  /** Free-action finds and first aid are limited per map. */
  private findsThisMap = 0;
  private firstAidThisMap = new Set<string>();
  private waiters: { pred: () => boolean; resolve: () => void }[] = [];
  /** Free text from a phone goes to the DM. */
  onFreeText: ((playerId: PlayerId, hero: Creature, text: string) => void) | undefined;
  /** Asks the game master for free-action ideas (set by the Director). */
  onSuggest: ((playerId: PlayerId, hero: Creature) => Promise<string[]>) | undefined;
  private lastSuggest = new Map<PlayerId, number>();
  /** Answers a rules question (set by the Director; without story the glossary answers). */
  onAskRules: ((playerId: PlayerId, hero: Creature, question: string) => Promise<string>) | undefined;
  private lastRules = new Map<PlayerId, number>();
  /** Items used and chests opened (tutorial step "use_item"). */
  itemUses = 0;
  /** Training fight: nobody dies. */
  training = false;
  private narrationLog: Narration[] = [];
  private lanceUsed = new Set<string>();

  constructor(
    readonly session: GameSession,
    private rng: Rng,
    /** Sends an event to one phone. */
    private sendTo: (playerId: PlayerId, event: import("../shared/events").GameEvent) => void,
    private sendAll: (event: import("../shared/events").GameEvent) => void,
    private opts: ControllerOptions = {},
  ) {}

  destroy(): void {
    this.destroyed = true;
    if (this.monsterTimer) clearTimeout(this.monsterTimer);
  }

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

  // ---------------------------------------------------------------- free actions in a fight

  /** Enemies still standing in the current fight (for the game master). */
  enemiesInFight(): { id: string; name: string; hp: number; maxHp: number; boss: boolean }[] {
    if (this.mode !== "combat") return [];
    const involved = new Set(this.battle.combat?.order.map((o) => o.creatureId) ?? []);
    return Object.values(this.battle.creatures)
      .filter((c) => c.side === "enemy" && involved.has(c.id) && isActive(c))
      .map((c) => ({ id: c.id, name: c.name, hp: c.hp, maxHp: c.maxHp, boss: this.bossIds.has(c.id) }));
  }

  /** A trick worked: the next attack against this enemy has advantage. */
  distract(enemyId: string, heroName: string): boolean {
    const enemy = this.battle.creatures[enemyId];
    if (!enemy || this.mode !== "combat" || !isActive(enemy) || enemy.side !== "enemy") return false;
    addEffect(enemy, "distracted", 99, enemyId);
    this.addLog([{ text: `🎭 ${heroName} lenkt ${enemy.name} ab: Der nächste Angriff auf ${enemy.name} hat Vorteil.`, glossarKeys: ["abgelenkt", "vorteil"] }]);
    this.broadcast();
    return true;
  }

  /** A trick worked: all ordinary enemies flee (bosses stay). Ends the fight if nobody is left. */
  enemiesFlee(): string[] {
    const fleeing = this.enemiesInFight().filter((e) => !e.boss);
    if (!fleeing.length || fleeing.length !== this.enemiesInFight().length) return [];
    const lines = this.fleeLines();
    this.addLog(lines.map((text) => ({ text, glossarKeys: [] })));
    // End the fight first, then redraw (the order still lists the creatures that just left).
    this.checkWinner();
    this.emit("changed");
    this.broadcast();
    return fleeing.map((e) => e.name);
  }

  /** All ordinary enemies run away (only if no boss is in the fight). */
  private fleeLines(): string[] {
    const fleeing = this.enemiesInFight().filter((e) => !e.boss);
    if (!fleeing.length || fleeing.length !== this.enemiesInFight().length) return [];
    for (const e of fleeing) delete this.battle.creatures[e.id];
    this.victoryNote = "Die Gegner sind geflohen.";
    return [`🏃 ${fleeing.map((e) => e.name).join(", ")} ${fleeing.length > 1 ? "fliehen" : "flieht"}!`];
  }

  /** Gold of the whole group. */
  partyGold(): number {
    return this.heroes().reduce((sum, h) => sum + (h.pc?.inventory.find((i) => i.itemId === "gold")?.qty ?? 0), 0);
  }

  private spendGold(amount: number): boolean {
    if (this.partyGold() < amount) return false;
    let owed = amount;
    for (const h of this.heroes()) {
      const gold = h.pc?.inventory.find((i) => i.itemId === "gold");
      if (!gold || owed <= 0) continue;
      const pay = Math.min(gold.qty, owed);
      gold.qty -= pay;
      owed -= pay;
    }
    return true;
  }

  private heroByRef(ref: string): Creature | undefined {
    return this.heroes().find((h) => h.playerId === ref || h.id === ref);
  }

  /** Objects near a hero, in words (for the game master's ideas). */
  surroundings(hero: Creature): { name: string; objects: string[] } | undefined {
    if (!hero.pos) return undefined;
    const map = this.map;
    const roomIndex = map.roomOf[cellIndex(map, hero.pos.x, hero.pos.y)] ?? -1;
    const room = roomIndex >= 0 ? map.rooms[roomIndex] : undefined;
    const NAMES: Record<string, string> = {
      chest: "Truhe", door: "Tür", fountain: "Brunnen", statue: "Statue", altar: "Altar", column: "Säule", throne: "Thron",
      boulder: "Felsbrocken", box: "Kisten und Fässer", tree: "Bäume", trap: "", gold: "Goldmünzen am Boden", potion: "ein Fläschchen am Boden",
      item: "etwas Glänzendes am Boden", "stairs-down": "Treppe nach unten", "stairs-up": "Treppe nach oben",
      barrel: "Fässer", lever: "ein Hebel an der Wand", chandelier: "ein Kronleuchter an der Decke", campfire: "ein Lagerfeuer", cauldron: "ein brodelnder Kessel", secret: "",
    };
    const near = map.objects.filter((o) => Math.max(Math.abs(o.x - hero.pos!.x), Math.abs(o.y - hero.pos!.y)) <= 8 && (o.kind !== "trap" || o.state === "found") && o.state !== "used");
    const objects = [...new Set(near.map((o) => NAMES[o.kind] ?? o.kind).filter(Boolean))];
    const around = [...Array(9).keys()].map((k) => ({ x: hero.pos!.x + (k % 3) - 1, y: hero.pos!.y + Math.floor(k / 3) - 1 }));
    if (around.some((p) => ["water", "deep"].includes(map.cells[cellIndex(map, p.x, p.y)] ?? ""))) objects.push("Wasser");
    if (Object.keys(map.overlays).some((k) => map.overlays[Number(k)]?.startsWith("torch"))) objects.push("Fackeln an den Wänden");
    return { name: room?.name ?? "ein Gang", objects };
  }

  /**
   * Carries out the effects of a free action (already checked by src/dm/effects.ts).
   * Returns the log lines; ends the fight if no enemy is left standing.
   */
  applyEffects(effects: DmEffect[], actor: Creature): string[] {
    const lines: string[] = [];
    const enemy = (id: string) => {
      const c = this.battle.creatures[id];
      return c && c.side === "enemy" && isActive(c) ? c : undefined;
    };
    for (const e of effects) {
      switch (e.kind) {
        case "distract": {
          const t = enemy(e.target);
          if (!t) break;
          addEffect(t, "distracted", 99, actor.id);
          lines.push(`🎭 ${t.name} ist abgelenkt: Der nächste Angriff auf ${t.name} hat Vorteil.`);
          break;
        }
        case "prone": {
          const t = enemy(e.target);
          if (!t || this.bossIds.has(t.id) || !["tiny", "small", "medium"].includes(t.size)) break;
          if (addCondition(t, { id: "prone" })) lines.push(`🤸 ${t.name} liegt am Boden: Nahkampfangriffe auf ${t.name} haben Vorteil.`);
          break;
        }
        case "hamper": {
          const t = enemy(e.target);
          if (!t || this.bossIds.has(t.id)) break;
          addEffect(t, "hampered", 2, actor.id);
          lines.push(`🫣 ${t.name} ist behindert: Seine Angriffe haben bis nach seinem nächsten Zug Nachteil.`);
          break;
        }
        case "help": {
          const h = this.heroByRef(e.target);
          if (!h || h.id === actor.id) break;
          addEffect(h, "helped", 99, actor.id);
          lines.push(`🤝 ${actor.name} hilft ${h.name}: Vorteil auf den nächsten Wurf.`);
          break;
        }
        case "cover":
          addEffect(actor, "cover", 1, actor.id);
          lines.push(`🛡️ ${actor.name} geht in Deckung: +2 Rüstungsklasse bis zum nächsten Zug.`);
          break;
        case "hazard": {
          const t = enemy(e.target);
          if (!t) break;
          const dice = e.severity === "schwer" ? "3d6" : e.severity === "mittel" ? "2d6" : "1d6";
          const roll = rollDice(this.rng, parseDice(dice));
          applyDamage(this.rng, t, roll.total);
          lines.push(`💥 ${t.name} wird getroffen: 🎲 ${roll.dice.join(" + ")} = ${roll.total} Schaden${t.dead ? ` – ${t.name} ist besiegt!` : "."}`);
          break;
        }
        case "flee":
          lines.push(...this.fleeLines());
          break;
        case "pacify": {
          const targets = e.target === "all" ? this.enemiesInFight().filter((x) => !x.boss).map((x) => x.id) : [e.target];
          const cs = targets.map(enemy).filter((c): c is Creature => !!c && !this.bossIds.has(c.id));
          if (!cs.length) break;
          if (e.how === "bestechen" && !this.spendGold(cs.length * BRIBE_PER_ENEMY)) break;
          for (const c of cs) {
            c.side = "neutral";
            c.effects = [];
          }
          const names = cs.map((c) => c.name).join(", ");
          const many = cs.length > 1;
          if (e.how === "bestechen") lines.push(`💰 ${names} ${many ? "nehmen" : "nimmt"} ${cs.length * BRIBE_PER_ENEMY} Gold und ${many ? "kämpfen" : "kämpft"} nicht mehr.`);
          else if (e.how === "betoeren") lines.push(`💘 ${names} ${many ? "sind" : "ist"} ganz betört und ${many ? "legen" : "legt"} die Waffen nieder.`);
          else lines.push(`🏳️ ${names} ${many ? "geben" : "gibt"} auf.`);
          this.victoryNote = e.how === "bestechen" ? "Die Gegner haben sich kaufen lassen." : e.how === "betoeren" ? "Die Gegner sind betört." : "Die Gegner haben aufgegeben.";
          break;
        }
        case "find": {
          if (this.findsThisMap >= 2) break;
          this.findsThisMap++;
          if (e.item === "gold") {
            const amount = rollDice(this.rng, parseDice("2d6")).total;
            this.addItem(actor, "gold", amount);
            lines.push(`🪙 ${actor.name} findet ${amount} Goldmünzen.`);
          } else if (e.item === "trank") {
            this.addItem(actor, "potion-of-healing", 1);
            lines.push(`🧪 ${actor.name} findet einen Heiltrank.`);
          } else {
            this.addItem(actor, "torch", 1);
            lines.push(`🔥 ${actor.name} findet eine Fackel.`);
          }
          break;
        }
        case "first_aid": {
          const h = this.heroByRef(e.target);
          if (!h || this.firstAidThisMap.has(h.id) || h.dead) break;
          this.firstAidThisMap.add(h.id);
          const roll = rollDice(this.rng, parseDice("1d4+1"));
          heal(h, roll.total);
          lines.push(`🩹 ${h.name} wird verarztet: +${roll.total} Trefferpunkte.`);
          break;
        }
        case "open_door": {
          const door = this.map.objects
            .filter((o) => o.kind === "door" && o.state === "closed" && actor.pos && Math.max(Math.abs(o.x - actor.pos.x), Math.abs(o.y - actor.pos.y)) <= 3)
            .sort((a, b) => Math.abs(a.x - actor.pos!.x) + Math.abs(a.y - actor.pos!.y) - (Math.abs(b.x - actor.pos!.x) + Math.abs(b.y - actor.pos!.y)))[0];
          if (!door) break;
          door.state = "open";
          door.frame = "door.open";
          door.blocking = false;
          lines.push(`🚪 Die Tür springt auf.`);
          break;
        }
        case "reveal":
          if (actor.pos) {
            revealAround(this.map, actor.pos, 8);
            this.emit("mapChanged");
            lines.push(`👁️ ${actor.name} entdeckt einen verborgenen Teil der Umgebung.`);
          }
          break;
        case "exposed":
          addEffect(actor, "distracted", 99, actor.id);
          lines.push(`😬 Rückschlag: ${actor.name} gibt sich eine Blöße – der nächste Angriff auf ${actor.name} hat Vorteil.`);
          break;
        case "fall":
          if (this.mode === "combat" && addCondition(actor, { id: "prone" })) lines.push(`🤕 Rückschlag: ${actor.name} stolpert und liegt am Boden.`);
          break;
        case "fumble":
          addEffect(actor, "hampered", 2, actor.id);
          lines.push(`🤦 Rückschlag: ${actor.name} behindert sich selbst – eigene Angriffe haben Nachteil bis nach dem nächsten Zug.`);
          break;
        case "hurt": {
          const roll = rollDice(this.rng, parseDice(e.severity === "mittel" ? "1d6" : "1d4"));
          const dmg = Math.min(roll.total, Math.max(0, actor.hp - 1));
          if (dmg > 0) applyDamage(this.rng, actor, dmg);
          lines.push(`🩸 Rückschlag: ${actor.name} verletzt sich und verliert ${dmg} Trefferpunkte.`);
          break;
        }
        case "lose_gold": {
          const amount = Math.min(this.partyGold(), rollDice(this.rng, parseDice("1d6")).total);
          if (amount > 0 && this.spendGold(amount)) lines.push(`💸 Rückschlag: Die Gruppe verliert ${amount} Gold.`);
          break;
        }
        case "enrage": {
          const t = enemy(e.target);
          if (!t) break;
          addEffect(t, "enraged", 99, actor.id);
          lines.push(`😡 Rückschlag: ${t.name} wird wütend – Vorteil auf den nächsten Angriff.`);
          break;
        }
        case "cost": {
          const roll = rollDice(this.rng, parseDice("1d4"));
          const dmg = Math.min(roll.total, Math.max(0, actor.hp - 1));
          if (dmg > 0) applyDamage(this.rng, actor, dmg);
          lines.push(`⚠️ Ja, aber: ${actor.name} bezahlt einen Preis und verliert ${dmg} Trefferpunkte.`);
          break;
        }
      }
    }
    if (lines.length) this.addLog(lines.map((text) => ({ text, glossarKeys: [] })));
    this.checkWinner();
    this.emit("changed");
    this.broadcast();
    return lines;
  }

  /** Another phone took over this player's hero (the old phone lost its ID). */
  reassignPlayer(oldId: PlayerId, newId: PlayerId): void {
    for (const hero of this.heroes()) if (hero.playerId === oldId) hero.playerId = newId;
    const beginner = this.beginner.get(oldId);
    if (beginner !== undefined) this.beginner.set(newId, beginner);
    this.beginner.delete(oldId);
    if (this.pending?.playerId === oldId) this.pending.playerId = newId;
    this.sendView(newId);
  }

  heroOf(playerId: PlayerId): Creature | undefined {
    return this.heroes().find((c) => c.playerId === playerId);
  }

  active(): Creature | undefined {
    const c = this.battle.combat;
    return c ? this.battle.creatures[c.order[c.turnIndex]!.creatureId] : undefined;
  }

  // ---------------------------------------------------------------- free exploration

  /** Outside fights everyone may act at the same time; the TV handles actions in arrival order. */
  get freeExplore(): boolean {
    return this.mode === "explore" && !this.opts.turnBasedExplore;
  }

  /** May this hero act right now? */
  private isMine(c: Creature): boolean {
    if (this.freeExplore) return isActive(c);
    return this.active()?.id === c.id;
  }

  /** The turn budget of this hero right now (in free exploration everyone has a fresh one). */
  private turnFor(c: Creature): TurnState | undefined {
    const combat = this.battle.combat;
    if (!combat) return undefined;
    if (combat.turn.creatureId === c.id) return combat.turn;
    return this.freeExplore ? newTurn(c) : combat.turn;
  }

  /** Free exploration: this hero acts now, with fresh movement for this action. */
  private takeExploreTurn(hero: Creature): void {
    const combat = this.battle.combat;
    if (!combat) return;
    const idx = combat.order.findIndex((o) => o.creatureId === hero.id);
    if (idx < 0) return;
    combat.turnIndex = idx;
    combat.turn = newTurn(hero);
  }

  /** Actions that arrived while someone else was rolling: handled right after, in order. */
  private deferred: { playerId: PlayerId; action: PlayerAction }[] = [];

  private flushDeferred(): void {
    while (this.deferred.length && !this.pending) {
      const next = this.deferred.shift()!;
      this.handle(next.playerId, next.action);
    }
  }

  // ---------------------------------------------------------------- turns

  /** Exploration: the heroes take turns in party order. */
  start(): void {
    this.mode = "explore";
    const order = this.heroes().map((c) => ({
      creatureId: c.id,
      total: 0,
      parts: [],
      roll: { rolls: [], natural: 0, mode: "normal" as const, reasons: [] },
    }));
    const first = this.heroes().find(isActive) ?? this.heroes()[0]!;
    this.battle.combat = { round: 1, order, turnIndex: Math.max(0, order.findIndex((o) => o.creatureId === first.id)), turn: newTurn(first), reactionUsed: {} };
    this.announceTurn();
    this.broadcast();
  }

  announceTurn(): void {
    if (this.freeExplore) {
      this.emit("turn", "Freies Erkunden – alle gleichzeitig", undefined, true);
      return;
    }
    const c = this.active();
    if (!c) return;
    this.emit("turn", c.name, c.appearance?.color ?? (c.side === "enemy" ? "#b03030" : undefined));
  }

  endTurn(): void {
    if (this.destroyed) return;
    this.pending = undefined;
    for (let guard = 0; guard < 40; guard++) {
      const start = nextTurn(this.rng, this.battle);
      if (start.deathSave) {
        const lines = explainDeathSave(this.battle, start.deathSave);
        this.addLog(lines);
        this.publishRoll({
          id: `o${++this.rollCounter}`,
          creatureId: start.creatureId,
          title: "Todesrettungswurf",
          sides: 20,
          dice: start.deathSave.roll.rolls,
          kept: start.deathSave.roll.natural,
          lines,
          success: start.deathSave.success,
        });
      }
      if (this.checkWinner()) return;
      if (!start.skip) break;
    }
    this.announceTurn();
    this.broadcast();
    this.maybeRunMonster();
  }

  // ---------------------------------------------------------------- combat

  /** Demo: puts a group of monsters right next to the heroes. */
  spawnNearParty(monsterIds: string[]): void {
    const lead = this.heroes().find((h) => h.pos)!;
    const free: GridPos[] = [];
    for (let r = 3; r < 8 && free.length < monsterIds.length; r++) {
      for (let dy = -r; dy <= r && free.length < monsterIds.length; dy++) {
        for (let dx = -r; dx <= r && free.length < monsterIds.length; dx++) {
          const p = { x: lead.pos!.x + dx, y: lead.pos!.y + dy };
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !isWalkable(this.map, p) || !this.map.explored[cellIndex(this.map, p.x, p.y)]) continue;
          if (Object.values(this.battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y)) continue;
          free.push(p);
        }
      }
    }
    monsterIds.forEach((id, i) => {
      if (!free[i]) return;
      const m = createMonster(id, `spawn-${++this.rollCounter}`, { name: `${nameOf("monsters", id)} ${i + 1}` });
      m.pos = free[i];
      this.battle.creatures[m.id] = m;
    });
    this.emit("changed");
    this.checkCombatStart();
  }

  /** Enemies that notice the heroes: visible and not too far away. */
  private awakeEnemies(): Creature[] {
    return this.enemiesVisible().filter((e) => isActive(e) && this.heroes().some((h) => isActive(h) && distanceFt(h, e) <= (unaware(e) ? 10 : 60)));
  }

  private checkCombatStart(): boolean {
    if (this.mode !== "explore") return false;
    const enemies = this.awakeEnemies();
    if (!enemies.length) return false;
    // Someone walked right up to a sleeping or watching enemy: everybody wakes up.
    if (this.staged) {
      this.engage(false, "Ihr seid zu nah herangekommen – sie haben euch bemerkt!");
      return true;
    }
    this.pending = undefined;
    this.mode = "combat";
    this.lanceUsed.clear();
    const ids = [...this.heroes().filter((h) => !h.dead).map((h) => h.id), ...enemies.map((e) => e.id)];
    const combat = startCombat(this.rng, this.battle, ids);
    const lines: ExplainedLine[] = [
      { text: "⚔️ Kampf! Alle würfeln Initiative. Wer am höchsten würfelt, ist zuerst dran.", glossarKeys: ["initiative"] },
      ...combat.order.map((e) => explainInitiative(this.battle, e)),
    ];
    this.addLog(lines);
    this.publishRoll({ id: `o${++this.rollCounter}`, creatureId: combat.order[0]!.creatureId, title: "Kampf!", sides: 20, dice: [], kept: 0, lines });
    this.emit("combat", true);
    // Nobody can act while down or asleep: skip ahead like a normal turn change.
    const first = this.active();
    if (first && !isActive(first)) {
      this.endTurn();
      return true;
    }
    this.announceTurn();
    this.broadcast();
    this.maybeRunMonster();
    return true;
  }

  /** Ends the fight if one side is down. Returns true if it ended. */
  private checkWinner(): boolean {
    if (this.mode !== "combat") return false;
    const winner = combatWinner(this.battle);
    if (!winner) return false;
    if (this.monsterTimer) clearTimeout(this.monsterTimer);
    endCombat(this.battle);
    const lines: ExplainedLine[] = [];
    if (winner === "party") {
      lines.push({ text: `🏆 Sieg! ${this.victoryNote ?? "Alle Gegner sind besiegt."}`, glossarKeys: [] });
      this.victoryNote = undefined;
    } else {
      lines.push({ text: "💀 Die Helden sind gefallen … doch das Schicksal gibt ihnen eine zweite Chance.", glossarKeys: [] });
    }
    // Fallen heroes come round after the fight with 1 hit point.
    for (const h of this.heroes()) {
      if (!h.dead && h.hp === 0) {
        heal(h, 1);
        h.conditions = h.conditions.filter((c) => c.id !== "prone");
        lines.push({ text: `${h.name} rappelt sich mit 1 Trefferpunkt wieder auf.`, glossarKeys: ["stabil"] });
      }
    }
    this.addLog(lines);
    this.publishRoll({ id: `o${++this.rollCounter}`, creatureId: this.heroes()[0]!.id, title: winner === "party" ? "Sieg!" : "Niederlage", sides: 20, dice: [], kept: 0, lines, success: winner === "party" });
    this.emit("combat", false);
    this.training = false;
    this.start();
    const waiter = this.fightWaiter;
    this.fightWaiter = undefined;
    waiter?.(winner === "party" ? "party" : "enemy");
    return true;
  }

  private maybeRunMonster(): void {
    const c = this.active();
    if (this.mode !== "combat" || !c || this.destroyed) return;
    if (c.kind !== "monster" && !this.opts.autoHeroes) return;
    const delay = this.opts.monsterDelayMs ?? 1200;
    const run = () => this.runMonster(c.id);
    if (delay <= 0) run();
    else this.monsterTimer = setTimeout(run, delay);
  }

  private runMonster(id: string): void {
    if (this.destroyed || this.active()?.id !== id) return;
    const monster = this.battle.creatures[id]!;
    // Charmed, bribed or surrendered: stays out of the fight.
    if (monster.side === "neutral") {
      this.endTurn();
      return;
    }
    // Taken by surprise: this turn is lost.
    if (hasEffect(monster, "surprised")) {
      monster.effects = monster.effects.filter((e) => e.id !== "surprised");
      this.publishRoll({ id: `o${++this.rollCounter}`, creatureId: id, title: `${monster.name} ist überrascht`, sides: 20, dice: [], kept: 0, lines: [{ text: `😲 ${monster.name} ist überrascht und verliert den ersten Zug.`, glossarKeys: ["ueberrascht"] }] });
      this.emit("changed");
      const delay = this.opts.monsterDelayMs ?? 1200;
      if (delay <= 0) this.endTurn();
      else this.monsterTimer = setTimeout(() => this.endTurn(), delay);
      return;
    }
    const outcomes = runAutoTurn(this.rng, this.battle, id, { walkable: (p) => isWalkable(this.map, p) });
    for (const o of outcomes) {
      if (!o.ok) continue;
      const title = o.kind === "attack" ? `${monster.name} greift an` : o.kind === "move" ? `${monster.name} bewegt sich` : monster.name;
      const roll = this.outcomeToRoll(monster, title, 20, o);
      if (o.kind === "move" && !o.opportunityAttacks.length) {
        this.addLog(roll.lines);
        this.emit("changed");
      } else this.publishRoll(roll);
    }
    this.emit("changed");
    if (this.checkWinner()) return;
    const delay = this.opts.monsterDelayMs ?? 1200;
    if (delay <= 0) this.endTurn();
    else this.monsterTimer = setTimeout(() => this.endTurn(), delay);
  }

  // ---------------------------------------------------------------- actions

  /** When a phone last did something (the game master speaks up when it is quiet for long). */
  lastActionAt = Date.now();

  handle(playerId: PlayerId, action: PlayerAction): void {
    this.lastActionAt = Date.now();
    if (action.kind === "set_beginner_mode") {
      this.beginner.set(playerId, action.on);
      this.sendView(playerId);
      return;
    }
    const hero = this.heroOf(playerId);
    if (!hero) return;
    if (action.kind === "story_choice") {
      const offer = this.storyChoices.find((c) => c.id === action.choiceId);
      if (!offer || !this.choiceWaiter) {
        this.sendTo(playerId, { type: "action_error", reason: "Diese Entscheidung ist nicht mehr offen." });
        return;
      }
      const resolve = this.choiceWaiter;
      this.choiceWaiter = undefined;
      this.storyChoices = [];
      this.addLog([{ text: `${hero.name} entscheidet: ${offer.label}`, glossarKeys: ["entscheidung"] }]);
      resolve({ id: offer.id, playerId });
      this.broadcast();
      return;
    }
    if (action.kind === "ask_rules") {
      const now = Date.now();
      const question = action.question.trim().slice(0, 300);
      if (!question || now - (this.lastRules.get(playerId) ?? 0) < 6000) return;
      this.lastRules.set(playerId, now);
      const ask = this.onAskRules ?? (async (_p: PlayerId, _h: Creature, q: string) => glossaryAnswer(q));
      void ask(playerId, hero, question)
        .catch(() => glossaryAnswer(question))
        .then((answer) => this.sendTo(playerId, { type: "rules_answer", question, answer }));
      return;
    }
    if (action.kind === "suggest") {
      // Anyone may ask for ideas, at most every 15 seconds (AI calls are limited).
      const now = Date.now();
      if (now - (this.lastSuggest.get(playerId) ?? 0) < 15000) return;
      this.lastSuggest.set(playerId, now);
      void (this.onSuggest?.(playerId, hero) ?? Promise.resolve([])).then((ideas) => this.sendTo(playerId, { type: "suggestions", ideas }));
      return;
    }
    if (action.kind === "roll") {
      if (!this.pending || this.pending.playerId !== playerId || this.pending.prompt.id !== action.rollId) return;
      const pending = this.pending;
      this.pending = undefined;
      const result = pending.run();
      queueMicrotask(() => this.flushDeferred());
      if ("error" in result) this.sendTo(playerId, { type: "action_error", reason: result.error });
      else this.publishRoll(result);
      this.afterAction();
      return;
    }
    if (this.freeExplore && isActive(hero) && this.active()?.id !== hero.id) {
      // Someone else is rolling: this action waits and then runs (nothing is lost or cut off).
      if (this.pending) {
        if (this.deferred.length < 12) this.deferred.push({ playerId, action });
        return;
      }
      this.takeExploreTurn(hero);
    }
    if (this.active()?.id !== hero.id) {
      this.sendTo(playerId, { type: "action_error", reason: `${this.active()?.name ?? "Jemand anderes"} ist gerade dran.` });
      return;
    }
    if (this.pending) {
      this.sendTo(playerId, { type: "action_error", reason: "Erst würfeln!" });
      return;
    }
    if (action.kind === "use_item" && action.itemId === "torch") {
      this.toggleTorch(hero);
      return;
    }
    switch (action.kind) {
      case "end_turn":
        this.endTurn();
        return;
      case "move":
        this.move(playerId, hero, action.to);
        return;
      case "free_text": {
        // In a fight a free action is a real action (tricks would be too strong otherwise).
        const turn = this.mode === "combat" ? this.battle.combat?.turn : undefined;
        if (turn) {
          if (turn.actions < 1) {
            this.sendTo(playerId, { type: "action_error", reason: "Deine Aktion ist schon verbraucht. Im Kampf kostet eine freie Aktion deine Aktion." });
            return;
          }
          turn.actions -= 1;
        }
        this.addLog([{ text: `${hero.name} versucht: „${action.text.slice(0, 140)}“`, glossarKeys: ["freie_aktion"] }]);
        this.onFreeText?.(playerId, hero, action.text.slice(0, 300));
        this.broadcast();
        return;
      }
      case "interact":
        this.interact(playerId, hero, action.objectId, action.targetId);
        return;
      case "check":
        this.ask(playerId, hero, { title: `Umsehen (${nameOf("skills", action.skill)})`, sides: 20, glossarKey: "umsehen" }, () => this.lookAround(hero));
        return;
      default: {
        const engineAction = this.toEngineAction(action);
        if (!engineAction) return;
        // Drachenlanze: once per fight, double damage against a dragon.
        if (engineAction.type === "attack") {
          const target = this.battle.creatures[engineAction.targetId];
          const hasLance = hero.pc?.inventory.some((i) => i.itemId === "drachenlanze" && i.qty > 0);
          if (hasLance && target?.creatureType === "dragon" && !this.lanceUsed.has(hero.id)) {
            engineAction.dragonSlayer = true;
            this.lanceUsed.add(hero.id);
          }
          // Silberstaub (Walpurgisnacht): the whole group's weapons count as silvered.
          if (this.heroes().some((h) => h.pc?.inventory.some((i) => i.itemId === "silberstaub" && i.qty > 0))) engineAction.silvered = true;
        }
        const prompt = this.promptFor(hero, action);
        const run = () => {
          const outcome = perform(this.rng, this.battle, hero.id, engineAction);
          if (!outcome.ok) return { error: outcome.reason };
          if (engineAction.type === "use-item") this.itemUses++;
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
    if (this.checkWinner()) return;
    if (this.checkCombatStart()) return;
    // Revealed rooms from spells like fire bolt don't exist, but death and moves change the board.
    // Free exploration has no turns to pass on – just show everyone the new state.
    if (this.freeExplore) {
      this.broadcast();
      return;
    }
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
      hits: hitsOf(o),
      fx: fxOf(this.battle, hero, o),
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

  private interact(playerId: PlayerId, hero: Creature, objectId: string, targetId?: string): void {
    const o = this.map.objects.find((x) => x.id === objectId);
    if (o && ["barrel", "lever", "chandelier", "secret", "campfire", "cauldron"].includes(o.kind)) {
      this.useObject(playerId, hero, o, targetId);
      return;
    }
    if (!o || !hero.pos || Math.max(Math.abs(o.x - hero.pos.x), Math.abs(o.y - hero.pos.y)) > 1) {
      this.sendTo(playerId, { type: "action_error", reason: "Dafür musst du direkt daneben stehen." });
      return;
    }
    const lines: ExplainedLine[] = [];
    if (o.kind === "chest" && o.state !== "open") {
      this.itemUses++;
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

  // ---------------------------------------------------------------- things to play with

  /** Heroes who already tasted from the cauldron / searched a secret in vain (once each). */
  private triedObject = new Set<string>();
  private restedAtFire = new Set<string>();

  private objectRange(o: MapObject): number {
    return o.kind === "chandelier" ? 5 : 1;
  }

  /** Uses up the hero's action in a fight (object tricks cost an action there). */
  private spendAction(hero: Creature): string | undefined {
    if (this.mode !== "combat") return undefined;
    const turn = this.battle.combat?.turn;
    if (!turn || turn.creatureId !== hero.id) return "Du bist nicht dran.";
    if (turn.actions <= 0) return "Du hast deine Aktion schon benutzt.";
    turn.actions--;
    return undefined;
  }

  private objectRoll(hero: Creature, title: string, check: { roll: { rolls: number[]; natural: number }; success: boolean } | undefined, lines: ExplainedLine[]): RollOutcome {
    return {
      id: `o${++this.rollCounter}`,
      creatureId: hero.id,
      ...(hero.playerId ? { playerId: hero.playerId } : {}),
      title,
      sides: 20,
      dice: check?.roll.rolls ?? [],
      kept: check?.roll.natural ?? 0,
      lines,
      ...(check ? { success: check.success } : {}),
    };
  }

  private hurtNoKnockout(c: Creature, dice: string): number {
    const d = Math.max(0, Math.min(rollDice(this.rng, parseDice(dice)).total, c.hp - 1));
    applyDamage(this.rng, c, d);
    return d;
  }

  private useObject(playerId: PlayerId, hero: Creature, o: MapObject, targetId?: string): void {
    const far = !hero.pos || Math.max(Math.abs(o.x - hero.pos.x), Math.abs(o.y - hero.pos.y)) > this.objectRange(o);
    if (far) {
      this.sendTo(playerId, { type: "action_error", reason: o.kind === "chandelier" ? "Dafür musst du näher heran (5 Felder)." : "Dafür musst du direkt daneben stehen." });
      return;
    }
    const at = { x: o.x, y: o.y };
    const done = (r: RollOutcome, fx?: "puff" | "shake" | "sparkle" | "splash") => {
      if (fx) this.emit("fx", fx, at);
      this.emit("changed");
      return r;
    };
    const rollThen = (title: string, skill: SkillId, dc: number, glossarKey: string, then: (success: boolean, lines: ExplainedLine[], check: ReturnType<typeof skillCheck>) => RollOutcome) => {
      this.ask(playerId, hero, { title: `${title} (${nameOf("skills", skill)}, SG ${dc})`, sides: 20, glossarKey }, () => {
        const err = this.spendAction(hero);
        if (err) return { error: err };
        const check = skillCheck(this.rng, hero, skill, dc);
        return then(check.success, explainCheck(this.battle, hero.id, check), check);
      });
    };
    const quick = (r: RollOutcome | { error: string }) => {
      if ("error" in r) this.sendTo(playerId, { type: "action_error", reason: r.error });
      else this.publishRoll(r);
      this.afterAction();
    };

    switch (o.kind) {
      case "barrel": {
        if (o.state === "used") return;
        if (this.mode !== "combat") {
          if (o.state === "found") return;
          o.state = "found";
          const r = this.rng.next();
          const lines: ExplainedLine[] = [];
          if (r < 0.4) {
            const gold = rollDice(this.rng, parseDice("1d6")).total;
            this.addItem(hero, "gold", gold);
            lines.push({ text: `🛢️ ${hero.name} kramt im Fass und findet ${gold} Goldmünzen!`, glossarKeys: ["gegenstand:gold"] });
          } else if (r < 0.65) {
            this.addItem(hero, "torch", 1);
            lines.push({ text: `🛢️ Im Fass liegt eine Fackel. ${hero.name} nimmt sie mit.`, glossarKeys: ["gegenstand:torch"] });
          } else lines.push({ text: `🛢️ Nur saurer Wein und alte Äpfel. ${hero.name} verzieht das Gesicht.`, glossarKeys: [] });
          quick(done(this.objectRoll(hero, "Fass durchsuchen", undefined, lines)));
          return;
        }
        const target = targetId ? this.battle.creatures[targetId] : undefined;
        if (!target || !isActive(target) || !target.pos || Math.max(Math.abs(target.pos.x - o.x), Math.abs(target.pos.y - o.y)) > 4) {
          this.sendTo(playerId, { type: "action_error", reason: "Kein Gegner in Rollweite (4 Felder vom Fass)." });
          return;
        }
        rollThen("Fass rollen", "athletics", 10, "fass", (ok, lines, check) => {
          o.state = "used";
          o.blocking = false;
          o.frame = "";
          let dmgDone = 0;
          if (ok) {
            const dmg = rollDice(this.rng, parseDice("1d6")).total;
            dmgDone = dmg;
            applyDamage(this.rng, target, dmg);
            lines.push({ text: `🛢️ Das Fass donnert gegen ${target.name}: ${dmg} Schaden!`, glossarKeys: [] });
            if (["tiny", "small", "medium"].includes(target.size) && !this.bossIds.has(target.id) && isActive(target) && addCondition(target, { id: "prone" })) {
              lines.push({ text: `${target.name} fällt um.`, glossarKeys: ["zustand:prone"] });
            }
          } else lines.push({ text: `🛢️ Das Fass rollt knapp an ${target.name} vorbei und zerschellt an der Wand.`, glossarKeys: [] });
          return done({ ...this.objectRoll(hero, "Fass rollen", check, lines), ...(ok ? { hits: [{ targetId: target.id, amount: dmgDone }] } : { hits: [{ targetId: target.id, amount: 0, miss: true }] }) }, "puff");
        });
        return;
      }
      case "chandelier": {
        if (o.state === "used" || this.mode !== "combat") return;
        rollThen("Kronleuchter abstürzen lassen", "acrobatics", 12, "kronleuchter", (ok, lines, check) => {
          const hits: { targetId: string; amount: number }[] = [];
          if (ok) {
            o.state = "used";
            o.frame = "chandelier.down";
            lines.push({ text: "💥 Das Seil reißt – der Kronleuchter kracht herunter!", glossarKeys: [] });
            for (const c of Object.values(this.battle.creatures)) {
              if (!c.pos || !isActive(c) || c.side !== "enemy" || Math.max(Math.abs(c.pos.x - o.x), Math.abs(c.pos.y - o.y)) > 1) continue;
              const dmg = rollDice(this.rng, parseDice("2d6")).total;
              applyDamage(this.rng, c, dmg);
              hits.push({ targetId: c.id, amount: dmg });
              lines.push({ text: `${c.name} wird getroffen: ${dmg} Schaden!`, glossarKeys: [] });
            }
            if (!hits.length) lines.push({ text: "Leider stand niemand darunter.", glossarKeys: [] });
          } else lines.push({ text: "Das Seil hält. Der Kronleuchter schaukelt nur bedrohlich.", glossarKeys: [] });
          return done({ ...this.objectRoll(hero, "Kronleuchter", check, lines), ...(hits.length ? { hits } : {}) }, ok ? "shake" : undefined);
        });
        return;
      }
      case "lever": {
        if (o.state === "used") return;
        const err = this.spendAction(hero);
        if (err) {
          this.sendTo(playerId, { type: "action_error", reason: err });
          return;
        }
        o.state = "used";
        o.frame = "lever.on";
        const lines: ExplainedLine[] = [{ text: `🕹️ ${hero.name} zieht den Hebel. Es klackt irgendwo in der Wand …`, glossarKeys: [] }];
        let fx: "sparkle" | "puff" | undefined = "puff";
        const door = this.map.objects.filter((d) => d.kind === "door" && d.state === "closed").sort((a, b) => Math.hypot(a.x - o.x, a.y - o.y) - Math.hypot(b.x - o.x, b.y - o.y))[0];
        if (o.variant === "trap") {
          const d = this.hurtNoKnockout(hero, "1d4");
          lines.push({ text: `🏹 Ein Pfeil schnellt aus der Wand und trifft ${hero.name}: ${d} Schaden. Eine Falle!`, glossarKeys: ["falle"] });
        } else if (o.variant === "door" && door) {
          door.state = "open";
          door.frame = "door.open";
          door.blocking = false;
          lines.push({ text: "🚪 Rumpelnd schwingt eine Tür auf.", glossarKeys: [] });
        } else {
          const gold = rollDice(this.rng, parseDice("2d8")).total;
          this.addItem(hero, "gold", gold);
          lines.push({ text: `🗝️ Eine Klappe springt auf! Dahinter: ${gold} Goldmünzen.`, glossarKeys: ["gegenstand:gold"] });
          fx = "sparkle";
        }
        quick(done(this.objectRoll(hero, "Hebel", undefined, lines), fx));
        return;
      }
      case "secret": {
        if (o.state === "found") return;
        const key = `${o.id}:${hero.id}`;
        if (this.triedObject.has(key)) {
          this.sendTo(playerId, { type: "action_error", reason: "Du hast hier schon gesucht. Vielleicht findet jemand anderes mehr?" });
          return;
        }
        const runes = o.variant === "runes";
        rollThen(runes ? "Zeichen untersuchen" : "Bodenplatte untersuchen", runes ? "arcana" : "investigation", 12, "geheimnis", (ok, lines, check) => {
          this.triedObject.add(key);
          if (ok) {
            o.state = "found";
            if (!runes) o.frame = "secret.found";
            const gold = rollDice(this.rng, parseDice("2d10")).total;
            this.addItem(hero, "gold", gold);
            lines.push({ text: runes ? `✨ Die Zeichen leuchten auf – ein Stein gleitet zur Seite. Dahinter: ${gold} Goldmünzen!` : `✨ Die Platte lässt sich anheben. Darunter: ${gold} Goldmünzen!`, glossarKeys: ["gegenstand:gold"] });
            if (this.rng.next() < 0.4) {
              this.addItem(hero, "potion-of-healing", 1);
              lines.push({ text: "…und ein Heiltrank!", glossarKeys: ["gegenstand:potion-of-healing"] });
            }
          } else lines.push({ text: runes ? "Die Zeichen bleiben stumm." : "Die Platte wackelt, aber rührt sich nicht.", glossarKeys: [] });
          return done(this.objectRoll(hero, "Geheimnis", check, lines), ok ? "sparkle" : undefined);
        });
        return;
      }
      case "campfire": {
        if (this.mode === "combat" || this.restedAtFire.size) return;
        this.restedAtFire.add(hero.id);
        const lines: ExplainedLine[] = [{ text: "🔥 Ihr wärmt euch kurz am Feuer und verbindet eure Kratzer.", glossarKeys: [] }];
        for (const h of this.heroes().filter((x) => !x.dead)) {
          const amount = rollDice(this.rng, parseDice("1d6")).total;
          const before = h.hp;
          heal(h, amount);
          if (h.hp > before) lines.push({ text: `${h.name}: +${h.hp - before} Trefferpunkte`, glossarKeys: [] });
        }
        quick(done(this.objectRoll(hero, "Am Feuer", undefined, lines)));
        return;
      }
      case "cauldron": {
        const key = `${o.id}:${hero.id}`;
        if (this.triedObject.has(key) || this.mode === "combat") return;
        rollThen("Aus dem Kessel kosten", "nature", 13, "kessel", (ok, lines, check) => {
          this.triedObject.add(key);
          if (ok) {
            const amount = rollDice(this.rng, parseDice("2d4")).total;
            heal(hero, amount);
            lines.push({ text: `🧪 Bitter, aber heilsam: ${hero.name} erhält ${amount} Trefferpunkte.`, glossarKeys: [] });
          } else {
            const d = this.hurtNoKnockout(hero, "1d4");
            lines.push({ text: `🤢 Igitt! Das war nichts für Menschenmägen. ${d} Schaden.`, glossarKeys: [] });
          }
          return done(this.objectRoll(hero, "Hexenkessel", check, lines), ok ? "sparkle" : "puff");
        });
        return;
      }
    }
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
    const secrets = this.map.objects.filter((o) => o.kind === "secret" && o.state === "hidden" && (roomIndex < 0 || o.roomId === this.map.rooms[roomIndex]?.id));
    if (check.success) {
      traps.forEach((t) => (t.state = "found"));
      // Secrets become easy to spot (and can be examined up close).
      secrets.forEach((s) => (s.state = "closed"));
      if (secrets.length) lines.push({ text: `🔍 ${hero.name} bemerkt etwas Merkwürdiges ${secrets[0]!.variant === "runes" ? "an der Wand" : "am Boden"}. Schaut es euch aus der Nähe an!`, glossarKeys: ["geheimnis"] });
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

  /** Lighting or putting out a torch is a free object interaction. */
  private toggleTorch(hero: Creature): void {
    if (!hero.pc?.inventory.some((i) => i.itemId === "torch" && i.qty > 0)) return;
    if (hasEffect(hero, "torch")) {
      hero.effects = hero.effects.filter((e) => e.id !== "torch");
      this.addLog([{ text: `${hero.name} löscht die Fackel.`, glossarKeys: ["gegenstand:torch"] }]);
    } else {
      addEffect(hero, "torch", 600, hero.id);
      this.addLog([{ text: `🔥 ${hero.name} zündet eine Fackel an. Jetzt seht ihr 6 m weit.`, glossarKeys: ["gegenstand:torch", "dunkelheit"] }]);
    }
    this.emit("changed");
    this.broadcast();
  }

  private addLog(lines: ExplainedLine[]): void {
    this.log.push(...lines);
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
  }

  broadcast(): void {
    if (this.training) for (const h of this.heroes()) if (h.hp === 0 && !h.dead) h.stable = true;
    for (const hero of this.heroes()) if (hero.playerId) this.sendView(hero.playerId);
    this.emit("changed");
    const ready = this.waiters.filter((w) => w.pred());
    this.waiters = this.waiters.filter((w) => !ready.includes(w));
    ready.forEach((w) => w.resolve());
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
    const turn = this.turnFor(me);
    const mine = this.isMine(me);
    const free = this.freeExplore;
    const roomIndex = me.pos ? (this.map.roomOf[cellIndex(this.map, me.pos.x, me.pos.y)] ?? -1) : -1;
    const order = this.orderEntries();
    const view: PlayerView = {
      me,
      mode: this.mode,
      round: this.battle.combat?.round ?? 1,
      turn: {
        activeId: free ? me.id : (active?.id ?? ""),
        activeName: free ? "Alle" : (active?.name ?? ""),
        ...(!free && active?.appearance ? { activeColor: active.appearance.color } : {}),
        mine,
        ...(free ? { free: true } : {}),
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
    if (this.storyView) view.story = { ...this.storyView, narration: this.narrationLog.slice(-4), choices: this.storyChoiceView() };
    return view;
  }

  /** Turn order for the initiative bar (TV) and the phones. */
  orderEntries(): OrderEntry[] {
    const active = this.active();
    // Creatures that left the fight (fled) are skipped.
    return (this.battle.combat?.order ?? []).filter((o) => this.battle.creatures[o.creatureId]).map((o) => {
      const c = this.battle.creatures[o.creatureId]!;
      return {
        id: c.id,
        name: c.name,
        ...(this.mode === "combat" ? { initiative: o.total } : {}),
        ...(c.appearance ? { color: c.appearance.color, look: c.appearance.look } : {}),
        ...(c.monsterId ? { monsterId: c.monsterId } : {}),
        enemy: c.side === "enemy",
        health: c.maxHp ? c.hp / c.maxHp : 0,
        active: c.id === active?.id,
      };
    });
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
    // Night: each hero only sees what is lit or within their own darkvision.
    let light: string | undefined;
    if (map.dark) {
      light = "";
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const p = { x, y };
          const far = Math.max(Math.abs(x - pos.x), Math.abs(y - pos.y)) * 5;
          light += isLit(this.battle, p) ? "0" : me.darkvisionFt > 0 && far <= me.darkvisionFt ? "1" : "2";
        }
      }
    }
    const seen = (p: GridPos) => !light || light[(p.y - y0) * w + (p.x - x0)] !== "2";
    const objects = map.objects
      .filter((o) => !!o.frame && o.state !== "hidden" && inWindow(o) && map.explored[cellIndex(map, o.x, o.y)])
      .map((o) => ({ x: o.x, y: o.y, frame: o.frame }));
    const creatures = Object.values(this.battle.creatures)
      .filter((c) => !c.dead && c.pos && inWindow(c.pos) && map.explored[cellIndex(map, c.pos.x, c.pos.y)])
      // Enemies in the dark stay hidden; the own group is always known.
      .filter((c) => c.side === "party" || seen(c.pos!))
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
    return { x0, y0, w, h, frames, overlays, objects, creatures, reachable: mine && !this.pending ? this.reachable(me).filter(inWindow) : [], ...(light ? { light } : {}) };
  }

  /** Squares reachable with the movement left (8 directions, around creatures and obstacles). */
  reachable(me: Creature): GridPos[] {
    const turn = this.turnFor(me);
    const steps = Math.floor((turn?.movementLeftFt ?? 0) / 5) - (hasCondition(me, "prone") ? Math.ceil(me.speedFt / 10) : 0);
    if (!me.pos || steps <= 0) return [];
    // Large creatures cover several squares.
    const cover = (list: Creature[]) => new Set(list.flatMap((c) => squaresOf(c).map((p) => `${p.x},${p.y}`)));
    const others = Object.values(this.battle.creatures).filter((c) => c.id !== me.id && c.pos && !c.dead);
    const occupied = cover(others);
    const enemies = cover(others.filter((c) => c.side !== me.side));
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

  // ---------------------------------------------------------------- story primitives (A6)

  /** Narrator lines: log, phones, TV text box. */
  narrate(lines: Narration[]): void {
    if (!lines.length) return;
    this.narrationLog.push(...lines);
    if (this.narrationLog.length > 30) this.narrationLog.splice(0, this.narrationLog.length - 30);
    this.addLog(lines.map((l) => ({ text: l.npc ? `${l.npc}: ${l.text}` : `📖 ${l.text}`, glossarKeys: l.tip ? [l.tip.key] : [] })));
    this.sendAll({ type: "narration", lines });
    this.emit("narration", lines);
    this.broadcast();
  }

  setStoryView(view: StoryView | undefined): void {
    this.storyView = view;
    this.broadcast();
  }

  private storyChoiceView(): ActionChoice[] {
    return this.storyChoices.map((c) => ({
      id: `story:${c.id}`,
      group: "story" as const,
      label: c.label,
      detail: c.detail,
      glossarKey: "entscheidung",
      cost: "free" as const,
      enabled: !this.pending && this.mode === "explore",
      ...(this.pending ? { reason: "Erst würfeln!" } : this.mode !== "explore" ? { reason: "Erst den Kampf beenden." } : {}),
      recommended: !!c.recommended,
      action: { kind: "story_choice" as const, choiceId: c.id },
    }));
  }

  /** Offers story choices to all phones; resolves with the first pick and who made it. */
  choose(offers: StoryChoiceOffer[]): Promise<{ id: string; playerId: PlayerId }> {
    this.storyChoices = offers;
    return new Promise((resolve) => {
      this.choiceWaiter = resolve;
      this.broadcast();
    });
  }

  /** Resolves once `pred` is true after some state change. */
  waitFor(pred: () => boolean): Promise<void> {
    if (pred()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ pred, resolve }));
  }

  /** A skill check for one hero; resolves when the phone has rolled. */
  check(hero: Creature, skill: SkillId, dc: number, title: string): Promise<CheckResult> {
    return new Promise((resolve) => {
      const playerId = hero.playerId!;
      const run = (): RollOutcome => {
        // A friend's help: advantage on this check (used up).
        const helped = hasEffect(hero, "helped");
        if (helped) hero.effects = hero.effects.filter((e) => e.id !== "helped");
        const result = skillCheck(this.rng, hero, skill, dc, helped ? { reasons: [advantage("Ein Freund hilft dir", "helfen")] } : {});
        const lines = explainCheck(this.battle, hero.id, result);
        queueMicrotask(() => resolve(result));
        return { id: `o${++this.rollCounter}`, creatureId: hero.id, playerId, title, sides: 20, dice: result.roll.rolls, kept: result.roll.natural, lines, success: result.success };
      };
      const tryAsk = () => {
        if (this.pending) {
          // Another roll is open: wait until it is done.
          this.waiters.push({ pred: () => !this.pending, resolve: tryAsk });
          return;
        }
        this.ask(playerId, hero, { title: `${title} (${nameOf("skills", skill)}, SG ${dc})`, sides: 20, glossarKey: `fertigkeit:${skill}` }, run);
      };
      tryAsk();
    });
  }

  /** Spawns monsters in the heroes' current room and starts a fight. Resolves with the winner. */
  fight(groups: MonsterGroup[], opts: { training?: boolean; allies?: { monster: string; name: string }[] } = {}): Promise<{ winner: "party" | "enemy"; spawned: Creature[] }> {
    const spawned = this.spawnGroups(groups, opts.allies ?? []);
    this.training = !!opts.training;
    return new Promise((resolve) => {
      if (!spawned.length) {
        resolve({ winner: "party", spawned });
        return;
      }
      this.fightWaiter = (winner) => resolve({ winner, spawned });
      this.emit("changed");
      const boss = spawned.find((m) => this.bossIds.has(m.id));
      if (boss) this.emit("spotlight", boss.id);
      if (this.mode === "combat") return;
      // Start the fight even if the monsters stand a bit further away.
      this.forceCombat([...spawned.map((m) => m.id), ...this.alliesInPlay()]);
    });
  }

  private alliesInPlay(): string[] {
    return Object.values(this.battle.creatures).filter((c) => c.side === "party" && c.kind === "monster" && !c.dead).map((c) => c.id);
  }

  /** Monsters placed but not fighting yet (sleeping or keeping watch), waiting for the heroes' decision. */
  private staged: { spawned: Creature[]; resolve: (r: { winner: "party" | "enemy"; spawned: Creature[] }) => void } | undefined;
  /** Patrol direction of watching monsters. */
  private patrolDir = new Map<string, GridPos>();

  /**
   * Like fight(), but the monsters have not noticed the heroes yet: they sleep or keep watch.
   * The fight starts with engage() (optionally with a surprise), or not at all with pacifyStaged().
   * Walking right up to them starts it, too.
   */
  stageFight(groups: MonsterGroup[], state: "asleep" | "on-guard", opts: { allies?: { monster: string; name: string }[] } = {}): { spawned: Creature[]; done: Promise<{ winner: "party" | "enemy"; spawned: Creature[] }> } {
    const spawned = this.spawnGroups(groups, opts.allies ?? []);
    this.training = false;
    for (const m of spawned) addEffect(m, state, 999, m.id);
    const done = new Promise<{ winner: "party" | "enemy"; spawned: Creature[] }>((resolve) => {
      if (!spawned.length) {
        resolve({ winner: "party", spawned });
        return;
      }
      this.staged = { spawned, resolve };
      this.fightWaiter = (winner) => resolve({ winner, spawned });
    });
    this.emit("changed");
    this.broadcast();
    return { spawned, done };
  }

  get hasStagedFight(): boolean {
    return !!this.staged;
  }

  /** The staged fight begins. With surprise, the monsters lose their first turn. */
  engage(surprise: boolean, line?: string): void {
    const staged = this.staged;
    if (!staged) return;
    this.staged = undefined;
    this.cancelChoice();
    for (const m of staged.spawned) {
      m.effects = m.effects.filter((e) => e.id !== "asleep" && e.id !== "on-guard");
      if (surprise && isActive(m)) addEffect(m, "surprised", 1, m.id);
    }
    if (line) this.addLog([{ text: line, glossarKeys: surprise ? ["ueberrascht"] : [] }]);
    const alive = staged.spawned.filter((m) => this.battle.creatures[m.id] && isActive(m));
    if (!alive.length) {
      const waiter = this.fightWaiter;
      this.fightWaiter = undefined;
      waiter?.("party");
      return;
    }
    this.forceCombat([...alive.map((m) => m.id), ...this.alliesInPlay()]);
  }

  /** The heroes talked their way past: the staged monsters leave, the fight counts as won. */
  pacifyStaged(): void {
    const staged = this.staged;
    if (!staged) return;
    this.staged = undefined;
    for (const m of staged.spawned) delete this.battle.creatures[m.id];
    const waiter = this.fightWaiter;
    this.fightWaiter = undefined;
    this.emit("changed");
    this.broadcast();
    waiter?.("party");
  }

  /** Takes back the open story choice (an event ran out of time, or a fight began). */
  cancelChoice(): void {
    if (!this.choiceWaiter) return;
    const waiter = this.choiceWaiter;
    this.choiceWaiter = undefined;
    this.storyChoices = [];
    this.broadcast();
    waiter({ id: "", playerId: "" });
  }

  /** Nothing is open: no roll, no choice, no fight. */
  get idle(): boolean {
    return this.mode === "explore" && !this.pending && !this.choiceWaiter && !this.staged;
  }

  fx(kind: "puff" | "shake" | "sparkle" | "splash", pos?: GridPos): void {
    this.emit("fx", kind, pos);
  }

  /** Someone walks up to the heroes for an event (a figure next to them). */
  spawnVisitor(monster: string, name: string, near?: Creature): string | undefined {
    const lead = near ?? this.heroes().find((h) => isActive(h) && h.pos);
    if (!lead?.pos) return undefined;
    const taken = (p: GridPos) => Object.values(this.battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y);
    const spots: GridPos[] = [];
    for (let r = 2; r <= 3 && !spots.length; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const p = { x: lead.pos.x + dx, y: lead.pos.y + dy };
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && isWalkable(this.map, p) && !taken(p)) spots.push(p);
      }
    }
    const pos = spots[this.rng.int(0, Math.max(0, spots.length - 1))];
    if (!pos) return undefined;
    const c = createMonster(monster, `visitor${++this.rollCounter}`, { name, side: "neutral" });
    c.pos = pos;
    this.battle.creatures[c.id] = c;
    this.map.explored[cellIndex(this.map, pos.x, pos.y)] = true;
    this.emit("changed");
    this.broadcast();
    return c.id;
  }

  removeCreature(id: string): void {
    if (!this.battle.creatures[id]) return;
    delete this.battle.creatures[id];
    this.emit("changed");
    this.broadcast();
  }

  private npcHomes = new Map<string, GridPos>();

  /**
   * The world moves a little on its own (called every few seconds by the board, not in tests):
   * story characters stroll around their spot, watching monsters walk up and down.
   */
  tickWorld(): void {
    if (this.destroyed || this.mode !== "explore") return;
    let moved = false;
    const creatures = Object.values(this.battle.creatures);
    const free = (p: GridPos) => isWalkable(this.map, p) && !creatures.some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y);
    const heroes = this.heroes().filter((h) => h.pos && !h.dead);
    const heroNear = (p: GridPos, d: number) => heroes.some((h) => Math.max(Math.abs(h.pos!.x - p.x), Math.abs(h.pos!.y - p.y)) <= d);
    for (const c of creatures) {
      if (!c.pos || c.dead) continue;
      if (c.id.startsWith("npc-") && c.side === "neutral") {
        if (!this.npcHomes.has(c.id)) this.npcHomes.set(c.id, { ...c.pos });
        // Stays put while someone talks to them; otherwise strolls now and then.
        if (heroNear(c.pos, 2) || this.rng.next() > 0.25) continue;
        const home = this.npcHomes.get(c.id)!;
        const options = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
          .map((d) => ({ x: c.pos!.x + d.x, y: c.pos!.y + d.y }))
          .filter((p) => free(p) && Math.max(Math.abs(p.x - home.x), Math.abs(p.y - home.y)) <= 2);
        if (!options.length) continue;
        c.pos = options[this.rng.int(0, options.length - 1)]!;
        moved = true;
      } else if (hasEffect(c, "on-guard")) {
        let dir = this.patrolDir.get(c.id) ?? (this.rng.next() < 0.5 ? { x: 1, y: 0 } : { x: 0, y: 1 });
        let next = { x: c.pos.x + dir.x, y: c.pos.y + dir.y };
        if (!free(next)) {
          dir = { x: -dir.x, y: -dir.y };
          next = { x: c.pos.x + dir.x, y: c.pos.y + dir.y };
        }
        this.patrolDir.set(c.id, dir);
        if (free(next)) {
          c.pos = next;
          moved = true;
        }
      }
    }
    if (!moved) return;
    this.emit("changed");
    this.broadcast();
    // A patrol may walk right into the heroes.
    this.checkCombatStart();
  }

  private spawnGroups(groups: MonsterGroup[], allies: { monster: string; name: string }[]): Creature[] {
    const players = this.heroes().length;
    const spawned: Creature[] = [];
    const lead = this.heroes().find((h) => isActive(h) && h.pos) ?? this.heroes()[0]!;
    const roomIndex = lead.pos ? (this.map.roomOf[cellIndex(this.map, lead.pos.x, lead.pos.y)] ?? -1) : -1;
    const room = this.map.rooms[roomIndex >= 0 ? roomIndex : this.map.rooms.length - 1]!;
    const taken = (p: GridPos) => Object.values(this.battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y);
    const freeSpots = (preferred: GridPos[]): GridPos[] => {
      const out = preferred.filter((p) => isWalkable(this.map, p) && !taken(p));
      for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
        for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
          const p = { x, y };
          if (isWalkable(this.map, p) && !taken(p) && !out.some((q) => q.x === x && q.y === y) && distanceFt(lead, lead, p) >= 15) out.push(p);
        }
      }
      return out;
    };
    for (const g of groups) {
      const count = scaleGroup(g, players);
      const spots = freeSpots(g.boss ? [...room.spots.boss, ...room.spots.monster] : room.spots.monster);
      for (let i = 0; i < count && spots.length; i++) {
        const pos = spots.shift()!;
        const m = createMonster(g.monster, `m${++this.rollCounter}`, { name: count > 1 ? `${g.name ?? nameOf("monsters", g.monster)} ${i + 1}` : (g.name ?? nameOf("monsters", g.monster)) });
        m.pos = pos;
        this.battle.creatures[m.id] = m;
        spawned.push(m);
        if (g.boss) this.bossIds.add(m.id);
      }
    }
    for (const a of allies) {
      const pos = freeSpots(room.spots.party)[0];
      if (!pos) continue;
      const ally = createMonster(a.monster, `ally${++this.rollCounter}`, { name: a.name, side: "party" });
      ally.pos = pos;
      this.battle.creatures[ally.id] = ally;
    }
    // Everyone involved sees the monsters.
    for (const m of spawned) this.map.explored[cellIndex(this.map, m.pos!.x, m.pos!.y)] = true;
    return spawned;
  }

  private forceCombat(extraIds: string[]): void {
    this.pending = undefined;
    this.mode = "combat";
    this.lanceUsed.clear();
    const ids = [...this.heroes().filter((h) => !h.dead).map((h) => h.id), ...extraIds];
    const combat = startCombat(this.rng, this.battle, [...new Set(ids)]);
    const lines: ExplainedLine[] = [
      { text: "⚔️ Kampf! Alle würfeln Initiative. Wer am höchsten würfelt, ist zuerst dran.", glossarKeys: ["initiative"] },
      ...combat.order.map((e) => explainInitiative(this.battle, e)),
    ];
    this.addLog(lines);
    this.publishRoll({ id: `o${++this.rollCounter}`, creatureId: combat.order[0]!.creatureId, title: "Kampf!", sides: 20, dice: [], kept: 0, lines });
    this.emit("combat", true);
    const first = this.active();
    if (first && !isActive(first)) {
      this.endTurn();
      return;
    }
    this.announceTurn();
    this.broadcast();
    this.maybeRunMonster();
  }

  /** Loads the map of the next scene: heroes on the start spots, NPCs placed, fog reset. */
  loadMap(map: DungeonMap, npcs: { name: string; monster: string; room: number; id: string }[]): void {
    if (this.monsterTimer) clearTimeout(this.monsterTimer);
    this.pending = undefined;
    this.session.map = map;
    this.findsThisMap = 0;
    this.firstAidThisMap.clear();
    this.npcHomes.clear();
    this.triedObject.clear();
    this.restedAtFire.clear();
    this.patrolDir.clear();
    this.staged = undefined;
    for (const c of Object.values(this.battle.creatures)) if (c.kind === "monster") delete this.battle.creatures[c.id];
    const start = map.rooms[0]!;
    const exit = moduleExits(getModule(start.moduleId))[0]?.cells[0] ?? { x: 1, y: 1 };
    const heroSpots = partyStartSpots(map, this.heroes().length, { x: start.x + exit.x, y: start.y + exit.y });
    this.heroes().forEach((h, i) => {
      h.pos = heroSpots[i] ?? heroSpots[0];
      h.effects = [];
      h.conditions = h.conditions.filter((c) => c.id !== "prone" && c.id !== "unconscious");
    });
    for (const npc of npcs) {
      const room = map.rooms[Math.min(npc.room, map.rooms.length - 1)]!;
      const pos = [...room.spots.npc, ...room.spots.boss, ...room.spots.monster].find((p) => !Object.values(this.battle.creatures).some((c) => c.pos?.x === p.x && c.pos?.y === p.y));
      if (!pos) continue;
      const c = createMonster(npc.monster, `npc-${npc.id}`, { name: npc.name, side: "neutral" });
      c.pos = pos;
      this.battle.creatures[c.id] = c;
    }
    for (const h of this.heroes()) if (h.pos) revealAround(this.map, h.pos);
    // Night: the torches on the walls are the only fixed light.
    if (map.dark) {
      const lights = Object.entries(map.overlays).flatMap(([k, o]) => {
        const i = Number(k);
        return o.startsWith("torch") ? [{ x: i % map.width, y: Math.floor(i / map.width), radiusFt: 15 }] : [];
      });
      // Camp fires and the witch's fire light up the night, too.
      for (const o of map.objects) if (o.kind === "campfire" || o.kind === "cauldron") lights.push({ x: o.x, y: o.y, radiusFt: 20 });
      this.battle.darkness = { lights };
    } else delete this.battle.darkness;
    this.mode = "explore";
    delete this.battle.combat;
    this.emit("mapChanged");
    this.start();
  }

  /** Milestone levelling: rebuild the heroes on a higher level, keeping their things. */
  levelUp(level: number): boolean {
    let changed = false;
    for (const h of this.heroes()) {
      if (!h.pc || h.pc.level >= level) continue;
      const next = createCharacter({ id: h.id, name: h.name, classId: h.pc.classId, raceId: h.pc.raceId, level });
      next.playerId = h.playerId;
      next.appearance = h.appearance;
      next.pos = h.pos;
      // Keep found items (potions, gold, the lance).
      for (const item of h.pc.inventory) {
        const own = next.pc!.inventory.find((i) => i.itemId === item.itemId);
        if (own) own.qty = Math.max(own.qty, item.qty);
        else next.pc!.inventory.push({ ...item });
      }
      this.battle.creatures[h.id] = next;
      changed = true;
    }
    if (changed) this.broadcast();
    return changed;
  }

  /** Gives an item to one hero (or all). */
  giveItem(itemId: string, qty: number, to?: Creature): void {
    for (const h of to ? [to] : this.heroes()) this.addItem(h, itemId, qty);
  }

  // ---------------------------------------------------------------- choices

  private choicesFor(me: Creature, mine: boolean, beginnerMode: boolean): ActionChoice[] {
    const pc = me.pc!;
    const turn = this.turnFor(me);
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

    // Night: light a torch (free) – otherwise enemies in the dark are hard to hit.
    if (this.map.dark && pc.inventory.some((i) => i.itemId === "torch" && i.qty > 0)) {
      const lit = hasEffect(me, "torch");
      choices.push({
        id: "item:torch",
        group: "item",
        label: lit ? "🔥 Fackel löschen" : "🔥 Fackel anzünden",
        detail: lit ? "Deine Fackel leuchtet 6 m weit" : "Licht im Umkreis von 6 m – im Dunkeln trefft ihr sonst schlechter",
        glossarKey: "dunkelheit",
        cost: "free",
        enabled: mine,
        ...(notMine ? { reason: notMine } : {}),
        ...(!lit && me.darkvisionFt === 0 ? { recommended: true } : {}),
        action: { kind: "use_item", itemId: "torch" },
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
      // The chandelier hangs over the room: it can be brought down from a few squares away.
      if (o.kind === "chandelier" && o.state !== "used" && this.mode === "combat" && me.pos && Math.max(Math.abs(o.x - me.pos.x), Math.abs(o.y - me.pos.y)) <= 5) {
        const under = enemies.filter((e) => e.pos && Math.max(Math.abs(e.pos.x - o.x), Math.abs(e.pos.y - o.y)) <= 1);
        const reason = costReason("action");
        choices.push({ id: `chandelier:${o.id}`, group: "look", label: "💥 Kronleuchter abstürzen lassen", detail: `Akrobatik SG 12 · 2W6 Schaden für alle Gegner darunter${under.length ? ` (${under.map((u) => u.name).join(", ")})` : " (gerade niemand)"}`, glossarKey: "kronleuchter", cost: "action", enabled: !reason, ...(reason ? { reason } : {}), recommended: under.length >= 2, action: { kind: "interact", objectId: o.id } });
      }
      if (!me.pos || Math.max(Math.abs(o.x - me.pos.x), Math.abs(o.y - me.pos.y)) > 1) continue;
      if (o.kind === "chest" && o.state !== "open") {
        choices.push({ id: `open:${o.id}`, group: "look", label: "Truhe öffnen", detail: "Direkt neben dir · kostet nichts", glossarKey: "truhe", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
      }
      if (o.kind === "barrel" && o.state !== "used" && !(this.mode !== "combat" && o.state === "found")) {
        if (this.mode === "combat") {
          const targets = enemies.filter((e) => e.pos && Math.max(Math.abs(e.pos.x - o.x), Math.abs(e.pos.y - o.y)) <= 4);
          const reason = costReason("action") ?? (targets.length ? undefined : "Kein Gegner in Rollweite (4 Felder vom Fass).");
          choices.push({ id: `barrel:${o.id}`, group: "look", label: "🛢️ Fass auf Gegner rollen", detail: "Athletik SG 10 · 1W6 Schaden, kleine Gegner fallen um", glossarKey: "fass", cost: "action", enabled: !reason, ...(reason ? { reason } : {}), action: { kind: "interact", objectId: o.id }, targets: targets.map((t) => ({ id: t.id, name: t.name, detail: `TP ${t.hp}/${t.maxHp}` })), pick: { min: 1, max: 1, repeat: false } });
        } else choices.push({ id: `search:${o.id}`, group: "look", label: "🛢️ Fass durchsuchen", detail: "Direkt neben dir · kostet nichts", glossarKey: "fass", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
      }
      if (o.kind === "lever" && o.state !== "used") {
        const reason = this.mode === "combat" ? costReason("action") : notMine;
        choices.push({ id: `lever:${o.id}`, group: "look", label: "🕹️ Hebel ziehen", detail: this.mode === "combat" ? "Kostet deine Aktion · was passiert wohl?" : "Direkt neben dir · was passiert wohl?", glossarKey: "hebel", cost: this.mode === "combat" ? "action" : "free", enabled: !reason && (mine || this.mode !== "combat"), ...(reason ? { reason } : {}), action: { kind: "interact", objectId: o.id } });
      }
      if (o.kind === "secret" && o.state !== "found") {
        const reason = this.mode === "combat" ? costReason("action") : notMine;
        const runes = o.variant === "runes";
        choices.push({ id: `secret:${o.id}`, group: "look", label: runes ? "🔍 Zeichen an der Wand untersuchen" : "🔍 Bodenplatte untersuchen", detail: runes ? "Arkane Kunde SG 12" : "Nachforschungen SG 12", glossarKey: "geheimnis", cost: this.mode === "combat" ? "action" : "free", enabled: !reason, ...(reason ? { reason } : {}), recommended: o.state === "closed", action: { kind: "interact", objectId: o.id } });
      }
      if (o.kind === "campfire" && this.mode !== "combat" && !this.restedAtFire.size) {
        choices.push({ id: `fire:${o.id}`, group: "look", label: "🔥 Am Feuer rasten", detail: "Alle heilen ein wenig (einmal pro Ort)", glossarKey: "lagerfeuer", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
      }
      if (o.kind === "cauldron" && this.mode !== "combat" && !this.triedObject.has(`${o.id}:${me.id}`)) {
        choices.push({ id: `cauldron:${o.id}`, group: "look", label: "🧪 Aus dem Kessel kosten", detail: "Naturkunde SG 13: Heiltrank oder Hexengebräu?", glossarKey: "kessel", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
      }
      if (o.kind === "door") {
        choices.push({ id: `door:${o.id}`, group: "look", label: o.state === "open" ? "Tür schließen" : "Tür öffnen", detail: "Direkt neben dir · kostet nichts", glossarKey: "aktion", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
      }
    }
    if (this.mode === "combat") {
      const reason = costReason("action");
      choices.push({ id: "free", group: "free", label: "Freie Aktion", detail: "Ein Trick: ablenken, umstoßen, bestechen, betören … · kostet deine Aktion", glossarKey: "freie_aktion", cost: "action", enabled: !reason, ...(reason ? { reason } : {}), action: { kind: "free_text", text: "" } });
    } else {
      choices.push({ id: "free", group: "free", label: "Freie Aktion", detail: "Beschreibe, was du tun willst", glossarKey: "freie_aktion", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "free_text", text: "" } });
    }
    if (!this.freeExplore) choices.push({ id: "end", group: "end", label: "Zug beenden", detail: "Der Nächste ist dran", glossarKey: "zug_beenden", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "end_turn" } });

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

/** Hit point changes of an action, for floating numbers on the board. */
const SPELL_FX: Record<string, Pick<ActionFx, "kind" | "element">> = {
  "fire-bolt": { kind: "spell", element: "fire" },
  "ray-of-frost": { kind: "spell", element: "cold" },
  "sacred-flame": { kind: "spell", element: "radiant" },
  "magic-missile": { kind: "spell", element: "force" },
  "burning-hands": { kind: "breath", element: "fire" },
  "guiding-bolt": { kind: "spell", element: "radiant" },
  "scorching-ray": { kind: "spell", element: "fire" },
  "divine-favor": { kind: "buff", element: "radiant" },
  bless: { kind: "buff", element: "radiant" },
  "shield-of-faith": { kind: "buff", element: "radiant" },
  "cure-wounds": { kind: "heal" },
  "healing-word": { kind: "heal" },
  sleep: { kind: "sleep" },
};

/** What the board shows for an action: weapon swings, arrows, spells. */
function fxOf(battle: import("../shared/game").Battle, actor: Creature, o: ActionOutcome): ActionFx[] {
  if (!o.ok) return [];
  const fromAttack = (a: import("../shared/game").AttackResult): ActionFx => {
    const attacker = battle.creatures[a.attackerId];
    const opt = attacker?.attacks.find((x) => x.id === a.optionId);
    const src = opt?.sourceId ?? "";
    const ranged = opt?.kind === "ranged";
    const kind: ActionFx["kind"] = !ranged
      ? /bite|claw|bites|slam|touch|drain/.test(src)
        ? "claw"
        : "melee"
      : /crossbow/.test(src)
        ? "bolt"
        : /bow/.test(src)
          ? "arrow"
          : /sling/.test(src)
            ? "stone"
            : /fire-bolt|ray|missile|flame|guiding/.test(src)
              ? "spell"
              : "thrown";
    const element = /drain|withering/.test(src) ? "necrotic" : undefined;
    return { from: a.attackerId, to: [a.targetId], kind, ...(element ? { element } : {}), ...(a.crit ? { crit: true } : {}), ...(!a.hit ? { miss: true } : {}) };
  };
  switch (o.kind) {
    case "attack":
      return [fromAttack(o.attack)];
    case "move":
      return o.opportunityAttacks.map(fromAttack);
    case "spell": {
      const look = SPELL_FX[o.spell.spellId] ?? { kind: "spell" as const, element: "force" as const };
      const targets = o.spell.targets.map((t) => t.targetId);
      const miss = o.spell.targets.length > 0 && o.spell.targets.every((t) => t.attack && !t.attack.hit);
      return [{ from: o.spell.casterId, to: targets, ...look, spellId: o.spell.spellId, ...(miss ? { miss: true } : {}) }];
    }
    case "save-action":
      return [{ from: actor.id, to: o.results.map((r) => r.targetId), kind: "breath", element: /fire/.test(o.actionId) ? "fire" : /poison/.test(o.actionId) ? "poison" : /cold/.test(o.actionId) ? "cold" : "fire" }];
    case "heal":
      return [{ from: actor.id, to: [o.targetId], kind: "heal" }];
    case "turn-undead":
      return [{ from: actor.id, to: o.results.map((r) => r.targetId), kind: "turn", element: "radiant" }];
    default:
      return [];
  }
}

function hitsOf(o: ActionOutcome): NonNullable<RollOutcome["hits"]> {
  if (!o.ok) return [];
  const hits: NonNullable<RollOutcome["hits"]> = [];
  const fromAttack = (a: import("../shared/game").AttackResult) => {
    if (!a.hit) hits.push({ targetId: a.targetId, amount: 0, miss: true });
    else if (a.damage) hits.push({ targetId: a.targetId, amount: a.damage.total, crit: a.crit });
  };
  switch (o.kind) {
    case "attack":
      fromAttack(o.attack);
      break;
    case "move":
      o.opportunityAttacks.forEach(fromAttack);
      break;
    case "spell":
      for (const t of o.spell.targets) {
        if (t.attack) fromAttack(t.attack);
        else if (t.heal) hits.push({ targetId: t.targetId, amount: t.heal.total, heal: true });
        else if (t.damage) hits.push({ targetId: t.targetId, amount: t.damage.total });
      }
      break;
    case "save-action":
      o.results.forEach((r) => hits.push({ targetId: r.targetId, amount: r.damage }));
      break;
    case "heal":
      hits.push({ targetId: o.targetId, amount: o.total, heal: true });
      break;
  }
  return hits;
}
