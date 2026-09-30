/**
 * The running game on the host: turns, validation of player actions, rolls and the view each phone gets.
 * The TV is authoritative – phones only send wishes (PlayerAction).
 */
import { levelForXp, monsterXp, shareXp } from "../shared/progression";
import { pointsDue, pointsSpent } from "../shared/improvements";
import { longRest, perform, type ActionOutcome, type CombatAction } from "../engine/actions";
import { attackReasons, inRange, rangeBonuses, resolveAttack, RUN_UP_FT } from "../engine/attack";
import { addCondition, addEffect, applyDamage, armorClass, combatWinner, distanceFt, endCombat, hasCondition, hasEffect, heal, isActive, nextTurn, newTurn, rollInitiative, sizeInSquares, squaresOf, startCombat } from "../engine/combat";
import { abilityMod, advantage, modPart, profPart, savingThrow, skillCheck, skillParts, sumParts } from "../engine/core";
import { spellAttackParts } from "../engine/spells";
import { getSpell } from "../engine/data";
import { averageOf, parseDice, rollDice } from "../engine/dice";
import { explainCheck, explainDamage, explainDeathSave, explainHp, explainInitiative, explainOutcome, type ExplainedLine } from "../engine/explain";
import { runAutoTurn } from "../engine/ai";
import { createMonster, hardenMonster, MAX_LEVEL } from "../engine/creatures";
import { applyElement, effectiveness, ELEMENT_CHANCE, TYPE_ICON, TYPE_NAME, typeKey, VARIANTS } from "../engine/types";
import { afterHit, soak, turnStart } from "./elements";
import { DIFFICULTY, type Difficulty } from "../shared/difficulty";
import { itemIcon, itemTitle, levelGains, type Reward } from "../shared/reward";
import { GOAL_GOLD, goalById, goalReached } from "../shared/goals";
import { craft, recipeById } from "../shared/crafting";
import { COMPANIONS, newCompanion, traitOf } from "../shared/companions";
import { RECIPES } from "../shared/crafting";
import { makeCompanion, placeStray } from "./companions";
import { canTalk, tauntFor } from "../dm/taunts";

/** What people walking with the group say after a won fight. */
const FOLLOWER_LINES = ["Puh! Das war knapp.", "Habt ihr gesehen, wie ich den erwischt hab?", "Ich will nach Hause …", "Mit euch geh ich überall hin!", "Nächstes Mal warn mich vorher!", "Ich hab mir fast in die Hose gemacht."];

/** Foes who may be young (and talk like it). */
const YOUNG_FOES = new Set(["goblin", "kobold", "bandit", "thug", "cultist", "scout", "spy", "commoner"]);
import { arenaFor, arenaRound, type ArenaState } from "./arena";
import { besideFree } from "./session";
import { addTotals, newBadges } from "../shared/achievements";
import { findPath } from "../engine/grid";
import { isHazard, pathCost, stepCost } from "../engine/terrain";
import { propDef, propLight, terrainOf } from "../map/props";
import { nameOf } from "../engine/names";
import { randomRng, seededRng, type Rng } from "../engine/rng";
import { burnCreature, coldHits, creaturesOn, fireHits, ICE_DC, leaveTrace, setAlight, slipOnIce, spillCoals, surfaceKind, tickWorldSurface, weatherTick, type WorldResult } from "./environment";
import { maxTargets, validateCast } from "../engine/spells";
import { isWalkable, partyStartSpots, revealAround } from "../map/walk";
import { isLit } from "../engine/vision";
import { EMOTES, type PlayerAction } from "../shared/events";
import { GEAR, getGear } from "../data/gear";
import { emptyStats, type HeroStats, type Recap, type RecapHero } from "../shared/recap";
import type { DmEffect } from "../shared/dm";
import { BRIBE_PER_ENEMY } from "../dm/effects";
import { glossaryAnswer } from "../dm/rules-help";
import { isTrick } from "../dm/free-actions";
import { matchFreeText, matchUtility, type IntentMatch } from "../shared/intent-match";
import { nameFits, walkIntent } from "../shared/walk-text";
import { BULLET_ICON, bulletsFor } from "../shared/bullets";
import type { AttackOption, Creature, GridPos, TurnState } from "../shared/game";
import type { BreakdownPart } from "../shared/types";
import { cellIndex } from "../shared/map";
import type { PlayerId } from "../shared/types";
import { rollNeed, type ActionChoice, type ActionFx, type CampView, type FamilyView, type MiniMap, type OrderEntry, type PlayerView, type RollOutcome, type RollPrompt, type StoryView } from "../shared/view";
import type { MonsterGroup, Narration } from "../shared/story";
import type { CheckResult, DamageResult } from "../shared/game";
import type { DamageType, SkillId } from "../shared/rules";
import type { DungeonMap, MapObject } from "../shared/map";
import { applyGear, createCharacter, gearProblem, refreshAttacks } from "../engine/creatures";
import { scaleGroup } from "../dm/planner";
import { getModule, moduleExits, THEMES } from "../map/modules";
import type { GameSession } from "./session";

export interface StoryChoiceOffer {
  id: string;
  label: string;
  detail: string;
  recommended?: boolean;
}

/** A vivid description of an attack ("Ich springe vom Tisch und ramme ihm das Schwert in die Schulter"). */
const VIVID = /\b(kopf|schulter|bauch|bein|arm|brust|rücken|herz|auge|nacken|knie|hals|flanke|seite)|spring|wirbel|dreh|duck|roll|anlauf|voller wucht|mit aller kraft|brüll|täusch|ausholen|holt? aus/;
/** Talking to someone ("Ich frage den Wirt …"). */
const TALK = /\b(frag|sag|sprech|sprich|red|erzähl|bitt|ruf|grüß|begrüß|unterhalt|plauder|flüster)\w*/;
/** Dice sums and rule details: on the phones, not in the TV's log column. */
const MATH_LINE = /= -?\d+ gegen (RK|SG)|^🎲|^💥|gewürfelt|Bei einem kritischen Treffer|Rettungswurf-SG|hat jetzt \d+ Trefferpunkte|^[^:]+: 🎲/;
/** Exploring in turns: a player who does nothing this long is skipped (ms). */
/** Attribute names for the log. */
const ABILITY_NAMES = { STR: "Stärke", DEX: "Geschicklichkeit", CON: "Konstitution", INT: "Intelligenz", WIS: "Weisheit", CHA: "Charisma" } as const;

/** No visible clock: only someone who has been gone this long (left the room, phone off) is skipped. */
const SILENT_TURN_MS = 300_000;
const LOG_SIZE = 40;
const MINIMAP_W = 13;
const MINIMAP_H = 11;
const LOOK_DC = 12;
/** A vote ends this long after the first vote, even if not everyone voted (seconds). */
const VOTE_S = 40;
const TRAP_DC = 12;
/** Hidden floor traps: some hurt, some are just embarrassing – one even pays. */
const TRAPS: { id: string; save: "DEX" | "CON" | "WIS"; intro: string; dodge: string; hit: string; dice?: string; type?: "piercing" | "bludgeoning" | "poison"; prone?: boolean; gold?: string; fx?: "puff" | "shake" | "sparkle" | "splash" }[] = [
  { id: "pfeile", save: "DEX", intro: "💥 Klick! {hero} tritt auf eine versteckte Platte. Pfeile schießen aus der Wand!", dodge: "{hero} springt rechtzeitig zur Seite.", hit: "Ein Pfeil trifft {hero}.", dice: "1d6" },
  { id: "grube", save: "DEX", intro: "🕳️ Der Boden unter {hero} gibt nach – eine Fallgrube!", dodge: "{hero} hält sich mit einer Hand am Rand fest und zieht sich hoch.", hit: "{hero} plumpst hinein und krabbelt fluchend wieder heraus.", dice: "1d6", type: "bludgeoning", prone: true, fx: "shake" },
  { id: "mehl", save: "DEX", intro: "🌫️ Ein Seil spannt sich, oben kippt ein Sack …", dodge: "{hero} macht einen Satz nach vorn. Hinter {hero} staubt es gewaltig.", hit: "Mehl! {hero} ist von Kopf bis Fuß weiß und sieht aus wie ein Gespenst. Hatschi!" },
  { id: "eimer", save: "DEX", intro: "🪣 Über der Tür wackelt ein Eimer – der älteste Streich der Welt!", dodge: "{hero} fängt den Eimer elegant auf. Applaus!", hit: "Platsch! Eiskaltes Spülwasser über {hero}. Es riecht nach Kohl.", fx: "splash" },
  { id: "netz", save: "DEX", intro: "🕸️ Ein Netz saust von der Decke!", dodge: "{hero} rollt sich unter dem Netz weg.", hit: "{hero} zappelt kopfüber im Netz und braucht eine Weile, um sich herauszuschneiden.", dice: "1d2", type: "bludgeoning", prone: true },
  { id: "kitzel", save: "CON", intro: "🪶 Aus dem Boden schnellen Federn – eine Kitzelfalle!", dodge: "{hero} verzieht keine Miene. Eiserne Selbstbeherrschung.", hit: "{hero} kichert, gackert, prustet und kann sich kaum halten. Irgendwo in der Ferne lacht jemand mit." },
  { id: "honig", save: "DEX", intro: "🍯 Klebrig! {hero} steht in einer Honigpfütze – und es summt verdächtig.", dodge: "{hero} ist schneller weg als die Bienen.", hit: "Bienen! Sie stechen {hero}, bis {hero} den Honig los ist.", dice: "1d4", type: "poison" },
  { id: "muenzen", save: "WIS", intro: "🎰 Ratter, ratter … die Falle ist verrostet und spuckt statt Pfeilen etwas anderes aus.", dodge: "{hero} traut dem Klingeln nicht und tritt zurück. Das Geld verschwindet klimpernd in der Wand.", hit: "Münzen! Die alte Falle war mit Kleingeld gespannt.", gold: "1d6", fx: "sparkle" },
];

interface PendingRoll {
  prompt: RollPrompt;
  playerId: PlayerId;
  creatureId: string;
  run: () => RollOutcome | { error: string };
  /** Free actions: taken back before the throw. */
  cancel?: () => void;
}

export interface GameEvents {
  /** State changed: redraw the board. */
  changed(): void;
  roll(outcome: RollOutcome): void;
  turn(name: string, color: string | undefined, free?: boolean, info?: string): void;
  /** A short big note in the middle of the TV ("✨ Stark beschrieben!"). */
  flash(text: string): void;
  /** A player points at a square on the phone's map (and maybe a planned route). */
  point(heroId: string, at: GridPos, path: GridPos[]): void;
  /** Exploring in turns: seconds left for the active player (undefined = no clock). */
  clock(seconds: number | undefined): void;
  /** Exploring in turns: a round is over. */
  round(ended: number): void;
  /** A new scene: a big title card on the TV for a few seconds. */
  scene(title: string, goal: string): void;
  roomRevealed(name: string): void;
  lines(lines: ExplainedLine[]): void;
  combat(started: boolean): void;
  narration(lines: Narration[]): void;
  /** A new map was loaded (next scene): the board must rebuild. */
  mapChanged(): void;
  /** A boss enters: the board shows it off. */
  spotlight(creatureId: string): void;
  /** A hero has to roll now (the TV shows the waiting die). */
  asked(prompt: RollPrompt, creatureId: string, name: string, color: string | undefined): void;
  /** The waiting roll was taken back. */
  askCancelled(): void;
  /** A big note at the top of the TV (undefined = away). */
  banner(info: { icon: string; title: string; text: string } | undefined): void;
  /** A group vote: the options with who voted for them (undefined = vote over). */
  vote(state: { total: number; cast: number; options: { label: string; voters: { name: string; color: string }[] }[] } | undefined): void;
  /** The campfire rest started, changed (ready count) or ended (undefined). */
  camp(state: { ready: number; total: number } | undefined): void;
  /** A hero gained something: the TV celebrates it. */
  reward(reward: Reward): void;
  /** A player reacted (emoji over their hero). */
  emote(creatureId: string, emoji: string): void;
  /** A little show on the board (dust, sparkle, splash, shaking screen) at a square. */
  fx(kind: "puff" | "shake" | "sparkle" | "splash", pos: GridPos | undefined): void;
  /** Someone says something on the board (speech bubble over the figure). */
  speech(creatureId: string, text: string): void;
  /** The travel map between chapters (undefined = away). */
  travel(state: TravelView | undefined): void;
}

export interface TravelView {
  from: string;
  to: string;
  routes: { icon: string; name: string; text: string; x: number; y: number }[];
  /** Index of the chosen route, once decided. */
  chosen?: number;
}

export interface CampOffer {
  id: string;
  icon: string;
  name: string;
  detail: string;
  price: number;
  itemId?: string;
  gearId?: string;
}

export interface CampTale {
  heroId: string;
  name: string;
  question: string;
  text: string;
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

/** Objects in words (for the game master and the long-press info on the phone). */
const OBJECT_NAMES: Record<string, string> = {
  chest: "Truhe", door: "Tür", fountain: "Brunnen", statue: "Statue", altar: "Altar", column: "Säule", throne: "Thron",
  boulder: "Felsbrocken", box: "Kisten und Fässer", tree: "Bäume", trap: "", gold: "Goldmünzen am Boden", potion: "ein Fläschchen am Boden",
  item: "etwas Glänzendes am Boden", "stairs-down": "Treppe nach unten", "stairs-up": "Treppe nach oben",
  barrel: "Fässer", lever: "ein Hebel an der Wand", chandelier: "ein Kronleuchter an der Decke", campfire: "ein Lagerfeuer", cauldron: "ein brodelnder Kessel", secret: "",
};

/** What a hero finds out when studying a foe. */
function weakSpot(c: Creature): string {
  const byMonster: Record<string, string> = {
    ogre: "ein wackeliges Knie", goblin: "Angst vor lauten Geräuschen – und eine offene Deckung", kobold: "ein kurzer Atem", wolf: "eine empfindliche Schnauze",
    "dire-wolf": "eine alte Narbe an der Flanke", skeleton: "morsche Knochen an der Hüfte", zombie: "ein halb abgefallener Arm", bandit: "eine schlechte Deckung links",
    "bandit-captain": "ein Rückenleiden – dreht sich langsam", thug: "zu viel Bier im Blut", "red-dragon-wyrmling": "eine weiche Stelle am Bauch", "werewolf-hybrid": "Angst vor Silber",
    "giant-spider": "dünne Gelenke an den Beinen", "green-hag": "sie ist geblendet von hellem Licht", ghoul: "wackelige Schritte", cultist: "ein zitterndes Schwert", knight: "eine Lücke in der Rüstung unter dem Arm",
  };
  return byMonster[c.monsterId ?? ""] ?? "eine Lücke in der Deckung";
}

function objectName(o: MapObject): string {
  return (o.kind === "prop" ? propDef(o)?.name : OBJECT_NAMES[o.kind]) || "Gegenstand";
}

/** Pause before and after a foe's move: time to see what happens (one thing after another). */
const MONSTER_PAUSE_MS = 2200;

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
  /** How tough the world is (the dice stay honest). */
  difficulty: Difficulty = "normal";
  onFreeText: ((playerId: PlayerId, hero: Creature, text: string) => void) | undefined;
  /** Flirting and gifts: the director decides with the character's memory (src/dm/npc-world.ts). */
  onFlirt: ((playerId: PlayerId, hero: Creature, npcName: string) => void) | undefined;
  onGift: ((playerId: PlayerId, hero: Creature, npcName: string, itemId: string, itemName: string) => void) | undefined;
  /** A proposal with a ring: true if she said yes (then the ring is given away). */
  onPropose: ((playerId: PlayerId, hero: Creature, npcName: string) => boolean) | undefined;
  /** Whom a hero is married to / engaged with (the phone shows it). */
  familyOf: ((hero: string) => FamilyView | undefined) | undefined;
  /** A hero did something people remember ("Feuer gelegt"): the characters of the scene keep it in mind. */
  onDeed: ((hero: string, deed: string) => void) | undefined;
  /** Family wishes from the phone: returns an error text, or undefined when it worked. */
  onFamily: ((hero: Creature, act: Extract<PlayerAction, { kind: "family" }>) => string | undefined) | undefined;
  /** What a character feels about a hero and remembers last (the phone shows it on her card). */
  npcNote: ((name: string, hero: string) => { bond: number; mood: string; memory?: string; love?: number; loveLabel?: string; tie?: "spouse" | "engaged" } | undefined) | undefined;

  /** Brilliant ideas this map (EP for at most two). */
  private ideasRewarded = 0;

  /** A free action worked brilliantly: it counts for the look back, and the first two per map give EP. */
  creativeIdea(hero: Creature): void {
    const stats = this.statsOf(hero.id);
    stats.greatIdeas = (stats.greatIdeas ?? 0) + 1;
    if (this.ideasRewarded >= 2) return;
    this.ideasRewarded++;
    this.awardXp(10, `💡 geniale Idee von ${hero.name}`);
  }

  /** A speech bubble over a figure on the board. */
  bubble(creatureId: string, text: string): void {
    this.emit("speech", creatureId, text);
  }

  /** Pays from the group's gold (false if there is not enough). */
  payGold(amount: number): boolean {
    return this.spendGold(amount);
  }

  /** Someone tells the way: the last room and the hidden traps show up on the map. Returns how many traps. */
  revealWay(): number {
    const last = this.map.rooms[this.map.rooms.length - 1]!;
    revealAround(this.map, { x: last.x + Math.floor(last.w / 2), y: last.y + Math.floor(last.h / 2) }, 6);
    const traps = this.map.objects.filter((o) => o.kind === "trap" && o.state === "hidden");
    traps.forEach((t) => (t.state = "found"));
    this.emit("mapChanged");
    return traps.length;
  }

  /** Two heroes act together: the one who acts gets advantage on the next roll. */
  teamUp(hero: Creature, friend: Creature): void {
    addEffect(hero, "helped", 99, friend.id);
  }

  /** A free action was taken back before the throw: its action is free again. */
  refundFreeAction(hero: Creature): void {
    const turn = this.mode === "combat" ? this.battle.combat?.turn : undefined;
    if (turn && turn.creatureId === hero.id) turn.actions += 1;
    const stats = this.statsOf(hero.id);
    stats.freeActions = Math.max(0, stats.freeActions - 1);
    this.broadcast();
  }

  /** A short note for one player's phone. */
  tellPlayer(playerId: PlayerId, reason: string): void {
    this.sendTo(playerId, { type: "action_error", reason });
  }
  /** Asks the game master for free-action ideas (set by the Director). */
  onSuggest: ((playerId: PlayerId, hero: Creature) => Promise<string[]>) | undefined;
  private lastSuggest = new Map<PlayerId, number>();
  /** Answers a rules question (set by the Director; without story the glossary answers). */
  onAskRules: ((playerId: PlayerId, hero: Creature, question: string) => Promise<string>) | undefined;
  private lastRules = new Map<PlayerId, number>();
  private lastEmote = new Map<PlayerId, number>();
  /** Items used and chests opened (tutorial step "use_item"). */
  itemUses = 0;
  /** Training fight: nobody dies. */
  training = false;
  private narrationLog: Narration[] = [];
  private lanceUsed = new Set<string>();
  /**
   * Dice for the room itself (fire spreading, slipping, monster tricks), apart from the game's dice.
   * Seeded from the map, so a game with the same map plays out the same (tests), and every new map differs.
   */
  private envRng: Rng = randomRng();

  private seedEnv(map: DungeonMap): void {
    let h = 2166136261;
    const feed = (s: string) => {
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    };
    feed(`${map.width}x${map.height}`);
    for (const f of map.frames) feed(f);
    for (const o of map.objects) feed(`${o.kind}${o.x},${o.y}`);
    this.envRng = seededRng(h >>> 0);
  }

  constructor(
    readonly session: GameSession,
    private rng: Rng,
    /** Sends an event to one phone. */
    private sendTo: (playerId: PlayerId, event: import("../shared/events").GameEvent) => void,
    private sendAll: (event: import("../shared/events").GameEvent) => void,
    private opts: ControllerOptions = {},
  ) {
    for (const c of Object.values(session.battle.creatures)) if (c.pc) this.startLevels.set(c.id, c.pc.level);
    this.seedEnv(session.map);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.monsterTimer) clearTimeout(this.monsterTimer);
    clearTimeout(this.voteTimer);
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

  /** The free text behind the attack now running (to tell the hit in the player's words). */
  private flavor: { heroId: string; text: string; target?: string; targetId?: string; intoFire: boolean } | undefined;
  /** Heroes who already got the bonus for a vivid description in this fight. */
  private styleUsed = new Set<string>();

  /**
   * An attack described in words: a vivid description catches the enemy off guard (once per fight),
   * "hinter dem Tisch" gives cover when there is something to hide behind, and the hit is told in the player's words.
   */
  private flavorFor(hero: Creature, said: string, m: IntentMatch): void {
    const targetId = m.action.kind === "attack" ? m.action.targetId : m.action.kind === "cast" ? m.action.targetIds[0] : undefined;
    const target = targetId ? this.battle.creatures[targetId] : undefined;
    const t = said.toLowerCase();
    if (this.mode === "combat" && m.choice.group === "attack" && target?.side === "enemy" && !this.styleUsed.has(hero.id) && said.split(/\s+/).length >= 7 && VIVID.test(t)) {
      this.styleUsed.add(hero.id);
      addEffect(target, "distracted", 99, target.id);
      this.addLog([{ text: `✨ Stark beschrieben! ${hero.name} erwischt ${target.name} auf dem falschen Fuß: Vorteil.`, glossarKeys: ["vorteil"] }]);
      this.emit("flash", "✨ Stark beschrieben!");
    }
    // "…und bleibe hinter dem Tisch in Deckung": only with real cover right next to the hero.
    if (this.mode === "combat" && hero.pos && /deckung|hinter (dem|der|den|die)\b/.test(t)) {
      const cover = this.map.objects.find((o) => (propDef(o)?.cover ?? 0) > 0 && Math.max(Math.abs(o.x - hero.pos!.x), Math.abs(o.y - hero.pos!.y)) <= 1);
      if (cover) {
        addEffect(hero, "cover", 1, hero.id);
        this.addLog([{ text: `🛡️ ${hero.name} bleibt hinter ${propDef(cover)?.name ?? "der Deckung"}: +2 Rüstungsklasse bis zum nächsten Zug.`, glossarKeys: ["deckung"] }]);
      }
    }
    const intoFire = /\b(ins|in das|in die) (feuer|flammen|glut)/.test(t);
    this.flavor = { heroId: hero.id, text: said, ...(target ? { target: target.name, targetId: target.id } : {}), intoFire };
  }

  /** After the attack: tell it in the player's words; "ins Feuer" pushes the enemy into flames next to it. */
  private tellFlavor(r: RollOutcome): void {
    const f = this.flavor;
    if (!f || r.creatureId !== f.heroId || r.success === undefined) return;
    this.flavor = undefined;
    const hero = this.battle.creatures[f.heroId];
    if (!hero) return;
    const quote = f.text.length > 90 ? `${f.text.slice(0, 88)}…` : f.text;
    this.narrate([{ text: r.success ? `Genau so macht es ${hero.name}: „${quote}“ – Treffer!` : `${hero.name} versucht es genau so – doch ${f.target ?? "der Gegner"} weicht aus!` }]);
    const target = f.targetId ? this.battle.creatures[f.targetId] : undefined;
    if (r.success && f.intoFire && target?.pos && isActive(target)) {
      const taken = (p: GridPos) => Object.values(this.battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y);
      const fire = [...Array(9).keys()].map((k) => ({ x: target.pos!.x + (k % 3) - 1, y: target.pos!.y + Math.floor(k / 3) - 1 })).find((p) => surfaceKind(this.map, p) === "fire" && !taken(p));
      if (fire) {
        target.pos = fire;
        this.publishWorld(target, "Ins Feuer gestoßen", burnCreature(this.envRng, target));
      }
    }
  }

  /** "Bello, fass!" / "Rabe, hack ihm die Augen aus": points the companion at an enemy. Returns true when it was a command. */
  private commandCompanion(hero: Creature, said: string): boolean {
    const pet = this.companionOf(hero);
    if (!pet?.companion) return false;
    const t = said.toLowerCase();
    const kind = COMPANIONS[pet.companion.kind].name.toLowerCase();
    const called = t.includes(pet.name.toLowerCase().split(" ")[0]!) || new RegExp(`\\b${kind}`).test(t);
    if (!called || !/\b(fass|greif|hol|beiß|beiss|hack|los|kratz|jag|attack|pack|stürz)/.test(t)) return false;
    const enemies = Object.values(this.battle.creatures).filter((c) => c.side === "enemy" && isActive(c) && c.pos);
    const named = enemies.filter((e) => t.includes(e.name.toLowerCase())).concat(enemies.filter((e) => nameFits(t, e.name)));
    const d = (c: Creature) => (pet.pos && c.pos ? Math.max(Math.abs(c.pos.x - pet.pos.x), Math.abs(c.pos.y - pet.pos.y)) : 99);
    const target = named[0] ?? [...enemies].sort((a, b) => d(a) - d(b))[0];
    this.emit("speech", hero.id, said);
    if (!target) {
      this.addLog([{ text: `${COMPANIONS[pet.companion.kind].icon} ${pet.name} spitzt die Ohren – aber hier ist kein Gegner.`, glossarKeys: ["begleiter"] }]);
      this.broadcast();
      return true;
    }
    pet.focusId = target.id;
    this.addLog([{ text: `${COMPANIONS[pet.companion.kind].icon} ${hero.name}: „${said.slice(0, 60)}“ → ${pet.name} nimmt sich ${target.name} vor.`, glossarKeys: ["begleiter"] }]);
    this.broadcast();
    return true;
  }

  /** "Ich braue einen Heiltrank": undefined = not about brewing, "" = brewed, else why not. */
  private craftByText(hero: Creature, said: string): string | undefined {
    const t = said.toLowerCase();
    if (!/\b(brau|misch|mix|bastel|koch|stell\w* \w+ her|knüpf|füll\w* \w+ ab)/.test(t)) return undefined;
    const recipe = RECIPES.find((r) => nameFits(t, r.name) || t.includes(r.id));
    if (!recipe) return undefined;
    return this.craftFor(hero, recipe.id) ?? "";
  }

  /** When the wanted button is not possible: up to three things that are (other attacks, walking closer). */
  private alternativesFor(hero: Creature, wanted: ActionChoice, choices: ActionChoice[]): { label: string; detail: string; action: PlayerAction }[] {
    const out: { label: string; detail: string; action: PlayerAction }[] = [];
    const fighting = wanted.group === "attack" || wanted.group === "spell";
    if (fighting) {
      const usable = choices.filter((c) => c.enabled && (c.group === "attack" || c.group === "spell") && c.targets?.length && c.avgKind !== "heal").sort((a, b) => (b.avg ?? 0) * (b.chance ?? 0.5) - (a.avg ?? 0) * (a.chance ?? 0.5));
      for (const c of usable.slice(0, 2)) {
        const t = [...c.targets!].sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0))[0]!;
        const a = c.action;
        out.push({ label: `${c.label} → ${t.name}`, detail: `${c.chance !== undefined ? `${Math.round(c.chance * 100)} % · ` : ""}${c.avg ? `≈ ${Math.round(c.avg)} Schaden` : c.detail}`, action: a.kind === "attack" ? { ...a, targetId: t.id } : a.kind === "cast" ? { ...a, targetIds: [t.id] } : a });
      }
      // Too far: walk towards the nearest enemy (and strike next turn).
      const enemies = this.enemiesVisible().filter(isActive);
      const turn = this.turnFor(hero);
      if (/Reichweite|näher/.test(wanted.reason ?? "") && enemies.length && (turn?.movementLeftFt ?? 0) > 0 && hero.pos) {
        const near = [...enemies].sort((a, b) => distanceFt(hero, a) - distanceFt(hero, b))[0]!;
        out.push({ label: `🦶 Zu ${near.name} laufen`, detail: "So weit die Bewegung reicht – zuschlagen dann im nächsten Zug", action: { kind: "free_text", text: `Ich gehe zu ${near.name}` } });
      }
    }
    return out.slice(0, 3);
  }

  /** Where "Ich gehe zu …" leads: the nearest creature or thing whose name fits (only what the heroes have seen). */
  private walkGoal(hero: Creature, target: string): { pos: GridPos; name: string } | undefined {
    if (!hero.pos) return undefined;
    const map = this.map;
    const seen = (p: GridPos) => !!map.explored[cellIndex(map, p.x, p.y)];
    const found: { pos: GridPos; name: string }[] = [];
    for (const c of Object.values(this.battle.creatures)) {
      if (c.id === hero.id || c.dead || !c.pos || !seen(c.pos)) continue;
      if (nameFits(target, c.name) || (c.monsterId && nameFits(target, nameOf("monsters", c.monsterId)))) found.push({ pos: c.pos, name: c.name });
    }
    const KIND: Record<string, string> = {
      chest: "Truhe", door: "Tür Tor", fountain: "Brunnen", statue: "Statue", altar: "Altar", column: "Säule", throne: "Thron", boulder: "Felsbrocken Felsen",
      tree: "Baum", "stairs-down": "Treppe", "stairs-up": "Treppe", barrel: "Fass Fässer", lever: "Hebel", campfire: "Lagerfeuer Feuer", cauldron: "Kessel", box: "Kisten",
    };
    for (const o of map.objects) {
      if (!seen(o) || (o.kind === "trap" && o.state !== "found")) continue;
      const name = o.kind === "prop" ? `${propDef(o)?.name ?? ""}${o.prop === "counter" ? " Theke Bar" : ""}` : (KIND[o.kind] ?? "");
      if (name && nameFits(target, name)) found.push({ pos: { x: o.x, y: o.y }, name: name.split(" ")[0]! });
    }
    if (/ausgang|weiter|nächsten raum/.test(target)) {
      const last = map.rooms[map.rooms.length - 1]!;
      found.push({ pos: { x: last.x + Math.floor(last.w / 2), y: last.y + Math.floor(last.h / 2) }, name: "Ausgang" });
    }
    const d = (p: GridPos) => Math.max(Math.abs(p.x - hero.pos!.x), Math.abs(p.y - hero.pos!.y));
    return found.sort((a, b) => d(a.pos) - d(b.pos))[0];
  }

  /** Walks as close as this turn allows (right next to it when possible). */
  private walkTowards(playerId: PlayerId, hero: Creature, goal: { pos: GridPos; name: string }): void {
    const d = (p: GridPos) => Math.max(Math.abs(p.x - goal.pos.x), Math.abs(p.y - goal.pos.y));
    const now = d(hero.pos!);
    if (now <= 1) return;
    const taken = (p: GridPos) => Object.values(this.battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y);
    const best = this.reachable(hero).filter((p) => !taken(p)).sort((a, b) => d(a) - d(b) || Math.max(Math.abs(a.x - hero.pos!.x), Math.abs(a.y - hero.pos!.y)) - Math.max(Math.abs(b.x - hero.pos!.x), Math.abs(b.y - hero.pos!.y)))[0];
    if (!best || d(best) >= now) {
      this.sendTo(playerId, { type: "action_error", reason: `Zu ${goal.name} kommst du in diesem Zug nicht näher heran.` });
      return;
    }
    this.addLog([{ text: `🦶 ${hero.name} geht ${d(best) <= 1 ? "zu" : "Richtung"} ${goal.name}.`, glossarKeys: ["bewegung"] }]);
    this.move(playerId, hero, best);
  }

  /** Objects near a hero, in words (for the game master's ideas). */
  surroundings(hero: Creature): { name: string; objects: string[]; things?: { id: string; name: string }[]; people?: { id: string; name: string }[] } | undefined {
    if (!hero.pos) return undefined;
    const map = this.map;
    const roomIndex = map.roomOf[cellIndex(map, hero.pos.x, hero.pos.y)] ?? -1;
    const room = roomIndex >= 0 ? map.rooms[roomIndex] : undefined;
    const near = map.objects.filter((o) => Math.max(Math.abs(o.x - hero.pos!.x), Math.abs(o.y - hero.pos!.y)) <= 8 && (o.kind !== "trap" || o.state === "found") && o.state !== "used");
    const objects = [...new Set(near.map((o) => (o.kind === "prop" ? (propDef(o)?.name ?? "") : (OBJECT_NAMES[o.kind] ?? o.kind))).filter(Boolean))];
    const surfaces = new Set(Object.entries(map.surface ?? {}).filter(([k]) => { const i = Number(k); return Math.max(Math.abs((i % map.width) - hero.pos!.x), Math.abs(Math.floor(i / map.width) - hero.pos!.y)) <= 8; }).map(([, v]) => v.kind));
    for (const k of surfaces) objects.push(({ puddle: "Pfützen", oil: "eine Öllache", ice: "Eis am Boden", fire: "Feuer!", mud: "Schlamm", warn: "bröckelnde Decke" } as Record<string, string>)[k]!);
    const around = [...Array(9).keys()].map((k) => ({ x: hero.pos!.x + (k % 3) - 1, y: hero.pos!.y + Math.floor(k / 3) - 1 }));
    if (around.some((p) => ["water", "deep"].includes(map.cells[cellIndex(map, p.x, p.y)] ?? ""))) objects.push("Wasser");
    if (Object.keys(map.overlays).some((k) => map.overlays[Number(k)]?.startsWith("torch"))) objects.push("Fackeln an den Wänden");
    // Things and people with ids: the game master can point at them (free actions that change the map).
    const dist = (x: number, y: number) => Math.max(Math.abs(x - hero.pos!.x), Math.abs(y - hero.pos!.y));
    const things = near
      .filter((o) => o.kind !== "trap" && o.kind !== "gold" && o.kind !== "potion" && map.explored[cellIndex(map, o.x, o.y)])
      .sort((a, b) => dist(a.x, a.y) - dist(b.x, b.y))
      .slice(0, 12)
      .map((o) => ({ id: o.id, name: objectName(o) }));
    const people = Object.values(this.battle.creatures)
      .filter((c) => c.side === "neutral" && !c.dead && c.pos && !c.wild && dist(c.pos.x, c.pos.y) <= 12)
      .slice(0, 6)
      .map((c) => ({ id: c.id, name: c.name }));
    return { name: room?.name ?? "ein Gang", objects, ...(things.length ? { things } : {}), ...(people.length ? { people } : {}) };
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
          if (actor.kind === "pc") this.bump(actor.id, "helps");
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
            const amount = rollDice(this.rng, parseDice("1d6")).total;
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
        case "bypass":
          break;
        case "move_to":
        case "climb":
        case "hide":
        case "retreat":
        case "posture":
        case "ground":
        case "object":
        case "barricade":
        case "light":
        case "npc":
        case "npc_gift":
        case "turncoat":
        case "rout":
        case "pass_item":
        case "feed_potion":
        case "improvised":
        case "set_trap":
        case "wall_break":
        case "collapse":
        case "leap":
        case "pounce":
        case "noise":
        case "errand":
        case "disguise":
        case "interrogate":
        case "feud":
        case "disarm":
        case "hurl":
        case "animals":
        case "ice_bridge":
        case "shove":
        case "pressure":
        case "captive":
        case "weakness": {
          const line = this.worldEffect(e, actor);
          if (line) {
            lines.push(line);
            // What people will remember (and talk about): fire, smashing, walls and ceilings.
            const deed =
              e.kind === "ground" && e.surface === "fire" ? "Feuer gelegt" :
              e.kind === "object" && e.how === "ignite" ? "etwas in Brand gesteckt" :
              e.kind === "object" && e.how === "smash" ? "etwas kurz und klein geschlagen" :
              e.kind === "wall_break" ? "eine Wand eingerissen" :
              e.kind === "collapse" ? "die Decke einstürzen lassen" : undefined;
            if (deed) {
              this.onDeed?.(actor.name, deed);
              // Too much for the people walking with you.
              for (const f of Object.values(this.battle.creatures)) {
                if (!f.followId || f.captive || f.dead || this.envRng.next() < 0.5) continue;
                delete f.followId;
                this.emit("speech", f.id, "Das geht zu weit – ohne mich!");
                lines.push(`🚶 ${f.name} hat genug und geht eigene Wege.`);
              }
            }
          }
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
    // A foe set up by this hero (knocked down, distracted, soaked in oil …): a friend's hit becomes a combo.
    for (const e of effects) {
      const id = "target" in e && typeof e.target === "string" ? e.target : undefined;
      const t = id ? this.battle.creatures[id] : undefined;
      if (t?.side === "enemy" && !t.dead && e.kind !== "hazard" && e.kind !== "improvised") this.setups.set(t.id, { heroId: actor.id, round: this.round });
    }
    if (lines.length) this.addLog(lines.map((text) => ({ text, glossarKeys: [] })));
    this.checkWinner();
    this.emit("changed");
    this.broadcast();
    return lines;
  }

  // ---------------------------------------------------------------- free actions that change the map

  /** Something the game master pointed at: a creature, a thing or a place (id, name or "x,y"). */
  private resolveRef(ref: string, actor: Creature): { pos: GridPos; name: string; creature?: Creature; object?: MapObject } | undefined {
    const c = this.battle.creatures[ref];
    if (c?.pos && !c.dead) return { pos: c.pos, name: c.name, creature: c };
    const o = this.map.objects.find((x) => x.id === ref);
    if (o) return { pos: { x: o.x, y: o.y }, name: objectName(o), object: o };
    const xy = /^(\d+)\s*,\s*(\d+)$/.exec(ref);
    if (xy) return { pos: { x: Number(xy[1]), y: Number(xy[2]) }, name: "die Stelle" };
    const goal = ref ? this.walkGoal(actor, ref.toLowerCase()) : undefined;
    if (!goal) return undefined;
    const at = (p: { x: number; y: number }) => p.x === goal.pos.x && p.y === goal.pos.y;
    return { ...goal, creature: Object.values(this.battle.creatures).find((x) => x.pos && at(x.pos) && !x.dead), object: this.map.objects.find((x) => at(x)) };
  }

  private cheb(a: GridPos, b: GridPos): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  /** Foes set up by a hero for a friend's combo (knocked down, distracted, shoved …). */
  private setups = new Map<string, { heroId: string; round: number }>();
  private combosRewarded = 0;

  /** A friend hits a foe another hero set up: +1W6 damage, a cheer and (a few times per map) EP. */
  private combo(r: RollOutcome): void {
    const actor = this.battle.creatures[r.creatureId];
    if (!actor || actor.kind !== "pc" || this.mode !== "combat") return;
    for (const hit of r.hits ?? []) {
      if (hit.miss || hit.heal || hit.amount <= 0) continue;
      const setup = this.setups.get(hit.targetId);
      const t = this.battle.creatures[hit.targetId];
      if (!setup || !t || t.dead || setup.heroId === actor.id || setup.round < this.round - 1) continue;
      this.setups.delete(hit.targetId);
      const partner = this.battle.creatures[setup.heroId];
      const bonus = rollDice(this.rng, parseDice("1d6")).total;
      applyDamage(this.rng, t, bonus);
      r.lines.push({ text: `🔗 Kombo! ${partner?.name ?? "Ein Freund"} hat vorgelegt, ${actor.name} vollendet: +${bonus} Schaden${t.dead ? ` – ${t.name} ist besiegt!` : ""}`, glossarKeys: ["kombo"] });
      r.hits!.push({ targetId: t.id, amount: bonus });
      const stats = this.statsOf(actor.id);
      stats.combos = (stats.combos ?? 0) + 1;
      this.emit("flash", "🔗 Kombo!");
      if (this.combosRewarded < 3) {
        this.combosRewarded++;
        this.awardXp(5, `🔗 Kombo von ${partner?.name ?? "?"} und ${actor.name}`);
      }
      return;
    }
  }

  /** Rats answered once on this map. */
  private ratsCalled = false;
  /** A foe already called for help in this fight. */
  private reinforced = false;
  /** Pressure on a character (bribe, blackmail, threat): the director decides what it gets (way through or information). */
  onPressure: ((hero: Creature, npcId: string, how: "bribe" | "blackmail" | "threaten") => string | undefined) | undefined;
  /** A prisoner was let go (it may come back to help one day). */
  onSpared: ((name: string, monster: string) => void) | undefined;

  /** Someone joins a running fight: last in the round. */
  addToInitiative(c: Creature): void {
    const combat = this.battle.combat;
    if (!combat || combat.order.some((o) => o.creatureId === c.id)) return;
    combat.order.push(rollInitiative(this.rng, c));
  }

  /** Pushes a creature up to `steps` squares; fire burns, ice makes it slip, deep water swallows its footing. */
  pushCreature(t: Creature, dir: GridPos, steps: number, by: Creature): string {
    if (!t.pos || (!dir.x && !dir.y)) return "";
    const free = (p: GridPos) => (isWalkable(this.map, p) || this.map.cells[cellIndex(this.map, p.x, p.y)] === "deep") && !Object.values(this.battle.creatures).some((c) => c !== t && !c.dead && c.pos?.x === p.x && c.pos?.y === p.y) && !this.map.objects.some((o) => o.blocking && o.x === p.x && o.y === p.y);
    let at = t.pos;
    for (let n = 0; n < steps; n++) {
      const next = { x: at.x + dir.x, y: at.y + dir.y };
      if (!free(next)) break;
      at = next;
    }
    if (at === t.pos) return `💨 ${t.name} stemmt sich dagegen – nichts rührt sich.`;
    t.pos = at;
    const out = [`💨 ${by.name} stößt ${t.name} zurück!`];
    const ground = surfaceKind(this.map, at);
    if (ground === "fire") {
      const b = burnCreature(this.envRng, t);
      out.push(`🔥 Mitten ins Feuer!`, ...b.lines.map((l) => l.text));
    } else if (ground === "ice" || ground === "oil") {
      if (!this.bossIds.has(t.id) && addCondition(t, { id: "prone" })) out.push(`🧊 ${t.name} rutscht aus und knallt hin!`);
    } else if (this.map.cells[cellIndex(this.map, at.x, at.y)] === "deep" || this.map.cells[cellIndex(this.map, at.x, at.y)] === "water") {
      addEffect(t, "hampered", 2, by.id);
      out.push(`🌊 Platsch! ${t.name} strampelt im Wasser (Nachteil).`);
    }
    this.syncWorld();
    this.emit("fx", "puff", at);
    return out.join(" ");
  }

  /** One barricade per map (it must not wall the game shut); one broken wall and one caved-in ceiling, too. */
  private barricades = 0;
  private wallsBroken = 0;
  private collapses = 0;
  /** Characters who ran an errand, foes who were questioned (once each). */
  private errands = new Set<string>();
  /** Characters who already gave something (once per adventure). */
  private gave = new Set<string>();

  /** The new toolbox of free actions: walking, climbing, ground, things, people, items. Returns a log line. */
  private worldEffect(e: DmEffect, actor: Creature): string | undefined {
    const pos = actor.pos;
    if (!pos) return undefined;
    const fx = (kind: "puff" | "shake" | "sparkle" | "splash", at: GridPos = pos) => this.emit("fx", kind, at);
    const enemy = (id: string) => {
      const c = this.battle.creatures[id];
      return c && c.side === "enemy" && isActive(c) && !this.bossIds.has(c.id) ? c : undefined;
    };
    switch (e.kind) {
      case "move_to": {
        const goal = this.resolveRef(e.target, actor);
        if (!goal || !actor.playerId || this.cheb(pos, goal.pos) <= 1) return undefined;
        this.walkTowards(actor.playerId, actor, { pos: goal.pos, name: goal.name });
        return undefined;
      }
      case "climb": {
        const HIGH = new Set(["table", "table-flipped", "bench", "counter", "crate", "stump", "rock-ledge", "stage", "column-broken", "stalagmite", "coffin", "well"]);
        const spot = this.map.objects.find((o) => this.cheb(pos, o) <= 1 && o.state !== "used" && (o.kind === "prop" ? HIGH.has(o.prop ?? "") : ["box", "barrel", "boulder", "statue", "altar", "throne", "fountain", "chest"].includes(o.kind)));
        if (!spot) return `🧗 ${actor.name} sucht etwas zum Hochklettern – aber hier ist nichts Hohes.`;
        addEffect(actor, "elevated", 3, actor.id);
        this.syncWorld();
        fx("puff");
        this.emit("speech", actor.id, "⬆️");
        return `🧗 ${actor.name} klettert auf ${objectName(spot)}: erhöht (Vorteil bei Fernangriffen nach unten, 3 Runden).`;
      }
      case "hide":
        addCondition(actor, { id: "invisible", rounds: 2, sourceId: actor.id });
        fx("puff");
        return `🫥 ${actor.name} verschwindet im Schatten: unsichtbar für die Gegner bis zum nächsten Angriff.`;
      case "retreat":
        addEffect(actor, "disengage", 1, actor.id);
        return `↩️ ${actor.name} zieht sich geordnet zurück: keine Gelegenheitsangriffe in diesem Zug.`;
      case "posture":
        if (e.how === "up") {
          if (!hasCondition(actor, "prone")) return undefined;
          actor.conditions = actor.conditions.filter((c) => c.id !== "prone");
          return `🧍 ${actor.name} rappelt sich auf.`;
        }
        if (this.mode !== "combat" || !addCondition(actor, { id: "prone" })) return undefined;
        return `🤸 ${actor.name} wirft sich flach auf den Boden: Fernangriffe auf ${actor.name} haben Nachteil.`;
      case "ground": {
        const t = (e.target && this.resolveRef(e.target, actor)?.pos) || pos;
        if (this.cheb(pos, t) > 8) return undefined;
        this.map.surface ??= {};
        const cells: GridPos[] = [];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const p = { x: t.x + dx, y: t.y + dy };
          if (!isWalkable(this.map, p) || (Math.abs(dx) + Math.abs(dy) === 2 && this.envRng.next() < 0.5)) continue;
          cells.push(p);
        }
        const extra: string[] = [];
        let doused = 0;
        for (const p of cells) {
          const i = cellIndex(this.map, p.x, p.y);
          if (e.surface === "fire") {
            if (this.map.surface[i]?.kind === "puddle") continue;
            this.map.surface[i] = { kind: "fire", turns: 2 };
          } else {
            if (this.map.surface[i]?.kind === "fire" && (e.surface === "puddle" || e.surface === "mud" || e.surface === "ice")) doused++;
            // Oil on fire only feeds it.
            if (e.surface === "oil" && this.map.surface[i]?.kind === "fire") continue;
            this.map.surface[i] = { kind: e.surface };
          }
        }
        if (doused) extra.push("💨 Zischend geht das Feuer aus!");
        if (e.surface === "fire") extra.push(...fireHits(this.map, this.envRng, [t]).lines.map((l) => l.text));
        this.syncWorld();
        fx(e.surface === "fire" ? "shake" : e.surface === "puddle" || e.surface === "ice" ? "splash" : "puff", t);
        const what = { fire: "🔥 Flammen schlagen hoch", oil: "🛢️ Öl breitet sich glitschig aus", puddle: "💦 Wasser schwappt über den Boden", ice: "🧊 Der Boden überfriert – spiegelglatt", mud: "🟤 Der Boden wird zu zähem Schlamm" }[e.surface];
        return [`${what} (${actor.name}).`, ...extra].join(" ");
      }
      case "object": {
        const ref = this.resolveRef(e.target, actor);
        const o = ref?.object;
        if (!o || this.cheb(pos, o) > (e.how === "ignite" ? 6 : 2)) return undefined;
        const name = objectName(o);
        switch (e.how) {
          case "topple":
            if (o.prop === "table") {
              o.prop = "table-flipped";
              o.frame = "table.flipped";
            } else if (o.kind === "prop" && !propDef(o)?.blocking) return undefined;
            this.syncWorld();
            fx("puff", o);
            return `💪 ${actor.name} wirft ${name} um – krachend! Dahinter ist jetzt Deckung.`;
          case "smash":
            if (o.kind === "door" || o.kind === "chest" || o.kind === "stairs-down" || o.kind === "stairs-up") return undefined;
            o.state = "used";
            o.blocking = false;
            o.frame = o.prop === "pot" ? "pot.shards" : "debris";
            this.syncWorld();
            fx("shake", o);
            return `💥 ${actor.name} zerschlägt ${name} in tausend Stücke.`;
          case "ignite": {
            if (!propDef(o)?.flammable && o.kind !== "barrel") return `🔥 ${name} brennt nicht.`;
            // Through the room's fire rules: barrels burst, oil catches, neighbours may catch too.
            const lit = setAlight(this.map, o).lines.map((l) => l.text);
            const extra = [...lit.filter((t) => !t.includes("fängt Feuer")), ...fireHits(this.map, this.envRng, [{ x: o.x, y: o.y }]).lines.map((l) => l.text)];
            this.syncWorld();
            fx("shake", o);
            return [`🔥 ${actor.name} setzt ${name} in Brand!`, ...extra].join(" ");
          }
          case "push":
          case "roll": {
            const toward = e.toward ? this.resolveRef(e.toward, actor)?.pos : undefined;
            const dir = toward ? { x: Math.sign(toward.x - o.x), y: Math.sign(toward.y - o.y) } : { x: Math.sign(o.x - pos.x), y: Math.sign(o.y - pos.y) };
            if (!dir.x && !dir.y) return undefined;
            const steps = e.how === "roll" ? 6 : 2;
            let at = { x: o.x, y: o.y };
            let victim: Creature | undefined;
            for (let n = 0; n < steps; n++) {
              const next = { x: at.x + dir.x, y: at.y + dir.y };
              if (!isWalkable(this.map, next) || this.map.objects.some((x) => x !== o && x.blocking && x.x === next.x && x.y === next.y)) break;
              victim = Object.values(this.battle.creatures).find((c) => !c.dead && c.pos?.x === next.x && c.pos?.y === next.y);
              if (victim) break;
              at = next;
            }
            const moved = at.x !== o.x || at.y !== o.y;
            o.x = at.x;
            o.y = at.y;
            this.syncWorld();
            fx("puff", at);
            if (victim && victim.side === "enemy" && e.how === "roll") {
              const d = rollDice(this.rng, parseDice("2d6"));
              applyDamage(this.rng, victim, d.total);
              if (!this.bossIds.has(victim.id) && ["tiny", "small", "medium"].includes(victim.size) && !victim.dead) addCondition(victim, { id: "prone" });
              fx("shake", victim.pos!);
              return `🛢️ ${actor.name} rollt ${name} los – rumms, voll in ${victim.name}: ${d.dice.join(" + ")} = ${d.total} Schaden${victim.dead ? `, ${victim.name} ist besiegt!` : ", und umgehauen!"}`;
            }
            return moved ? `📦 ${actor.name} ${e.how === "roll" ? "rollt" : "schiebt"} ${name} ein Stück weiter.` : `📦 ${name} bewegt sich keinen Zentimeter.`;
          }
        }
        return undefined;
      }
      case "barricade": {
        if (this.barricades >= 1) return `🧱 Für eine zweite Barrikade ist hier nichts mehr übrig.`;
        const toward = (e.toward && this.resolveRef(e.toward, actor)?.pos) || this.enemiesVisible().find((x) => x.pos)?.pos;
        const around = [...Array(9).keys()].map((k) => ({ x: pos.x + (k % 3) - 1, y: pos.y + Math.floor(k / 3) - 1 })).filter((p) => (p.x !== pos.x || p.y !== pos.y) && isWalkable(this.map, p) && !Object.values(this.battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y) && !this.map.objects.some((o) => o.x === p.x && o.y === p.y && (o.blocking || o.kind === "door" || o.kind.startsWith("stairs"))));
        const spot = around.sort((a, b) => (toward ? this.cheb(a, toward) - this.cheb(b, toward) : 0))[0];
        if (!spot) return undefined;
        this.barricades++;
        this.map.objects.push({ id: `barricade${++this.rollCounter}`, kind: "box", x: spot.x, y: spot.y, frame: "box", blocking: true });
        this.syncWorld();
        this.emit("mapChanged");
        fx("puff", spot);
        return `🧱 ${actor.name} stapelt Kisten und Bänke zu einer Barrikade – da kommt keiner mehr durch.`;
      }
      case "light":
        if (e.on) {
          if (hasEffect(actor, "torch")) return undefined;
          const out = this.map.objects.find((o) => propDef(o)?.light && o.variant === "out" && this.cheb(pos, o) <= 2);
          if (out) {
            delete out.variant;
            this.syncWorld();
            fx("sparkle", out);
            return `🕯️ ${actor.name} zündet ${objectName(out)} wieder an.`;
          }
          if (!this.hasFire(actor)) return `🔦 ${actor.name} hat nichts zum Anzünden.`;
          addEffect(actor, "torch", 999, actor.id);
          this.syncWorld();
          fx("sparkle");
          return `🔥 ${actor.name} entzündet eine Fackel – Licht!`;
        } else {
          const lit = this.map.objects.filter((o) => propLight(o) && this.cheb(pos, o) <= 6);
          for (const o of lit) o.variant = "out";
          if (!lit.length) return undefined;
          this.syncWorld();
          fx("puff", lit[0]);
          return `🌑 ${lit.length > 1 ? `${lit.length} Lichter gehen` : `${objectName(lit[0]!)} geht`} aus – es wird dunkel.`;
        }
      case "npc": {
        const c = this.battle.creatures[e.target];
        if (!c?.pos || c.side !== "neutral" || c.dead) return undefined;
        if (e.how === "follow") {
          c.followId = actor.id;
          this.emit("speech", c.id, "Ich komme mit!");
          return `🚶 ${c.name} schließt sich ${actor.name} an und folgt der Gruppe.`;
        }
        if (e.how === "come") {
          c.pos = besideFree(this.map, this.battle, pos);
          this.npcHomes.set(c.id, { ...c.pos });
          this.emit("speech", c.id, "Ja?");
          return `🚶 ${c.name} kommt zu ${actor.name} herüber.`;
        }
        if (e.how === "leave") {
          delete c.followId;
          const away = [...Array(25).keys()].map((k) => ({ x: c.pos!.x + (k % 5) - 2, y: c.pos!.y + Math.floor(k / 5) - 2 })).filter((p) => isWalkable(this.map, p) && !Object.values(this.battle.creatures).some((x) => !x.dead && x.pos?.x === p.x && x.pos?.y === p.y)).sort((a, b) => this.cheb(b, pos) - this.cheb(a, pos))[0];
          if (away) c.pos = away;
          this.npcHomes.set(c.id, { ...c.pos });
          return `🚶 ${c.name} geht ${actor.name} lieber aus dem Weg.`;
        }
        // show_way: leads towards the exit and uncovers the way.
        const last = this.map.rooms[this.map.rooms.length - 1]!;
        const exit = { x: last.x + Math.floor(last.w / 2), y: last.y + Math.floor(last.h / 2) };
        revealAround(this.map, exit, 6);
        const step = { x: c.pos.x + Math.sign(exit.x - c.pos.x) * 2, y: c.pos.y + Math.sign(exit.y - c.pos.y) * 2 };
        if (isWalkable(this.map, step) && !Object.values(this.battle.creatures).some((x) => !x.dead && x.pos?.x === step.x && x.pos?.y === step.y)) c.pos = step;
        this.npcHomes.set(c.id, { ...c.pos });
        this.emit("mapChanged");
        this.emit("speech", c.id, "Da lang!");
        return `🧭 ${c.name} zeigt ${actor.name} den Weg – der Ausgang ist jetzt auf der Karte.`;
      }
      case "npc_gift": {
        const c = this.battle.creatures[e.target];
        if (!c?.pos || c.side !== "neutral" || this.gave.has(c.name)) return c && this.gave.has(c.name) ? `🤷 ${c.name} hat euch schon etwas gegeben.` : undefined;
        this.gave.add(c.name);
        if (e.item === "trank") this.addItem(actor, "potion-of-healing", 1);
        else if (e.item === "fackel") this.addItem(actor, "torch", 1);
        else this.addItem(actor, "gold", rollDice(this.rng, parseDice("1d6")).total);
        fx("sparkle", c.pos);
        this.emit("speech", c.id, "Hier, nimm!");
        return `🎁 ${c.name} gibt ${actor.name} ${e.item === "trank" ? "einen Heiltrank" : e.item === "fackel" ? "eine Fackel" : "ein paar Goldmünzen"}.`;
      }
      case "turncoat": {
        const t = enemy(e.target);
        if (!t) return undefined;
        t.side = "party";
        t.effects = [];
        this.emit("speech", t.id, "Ich bin raus – ab jetzt kämpf ich für euch!");
        fx("sparkle", t.pos);
        return `🔄 ${t.name} wechselt die Seite und kämpft jetzt für die Helden!`;
      }
      case "rout": {
        const t = enemy(e.target);
        if (!t) return undefined;
        this.emit("speech", t.id, "Nix wie weg!");
        delete this.battle.creatures[t.id];
        this.victoryNote = "Die Gegner sind geflohen.";
        return `🏃 ${t.name} rennt schreiend davon und ist weg.`;
      }
      case "pass_item": {
        const friend = this.heroByRef(e.target);
        if (!friend?.pos || friend.id === actor.id || this.cheb(pos, friend.pos) > 8) return undefined;
        const wanted = e.item.toLowerCase();
        const inv = actor.pc?.inventory ?? [];
        const id = /trank|heil/.test(wanted) ? "potion-of-healing" : /fackel/.test(wanted) ? "torch" : /gold|münz/.test(wanted) ? "gold" : inv.find((i) => i.qty > 0 && nameFits(wanted, itemTitle(i.itemId)))?.itemId;
        const have = id ? inv.find((i) => i.itemId === id && i.qty > 0) : undefined;
        if (!id || !have) return `🤷 ${actor.name} hat so etwas nicht dabei.`;
        const qty = id === "gold" ? Math.min(have.qty, 5) : 1;
        have.qty -= qty;
        actor.pc!.inventory = inv.filter((i) => i.qty > 0);
        this.addItem(friend, id, qty);
        fx("sparkle", friend.pos);
        return `🤾 ${actor.name} wirft ${friend.name} ${qty > 1 ? `${qty} × ` : ""}${itemTitle(id)} zu – gefangen!`;
      }
      case "feed_potion": {
        const friend = this.heroByRef(e.target);
        if (!friend?.pos || friend.dead || this.cheb(pos, friend.pos) > 1) return friend ? `🧪 ${friend.name} ist zu weit weg – erst hingehen.` : undefined;
        const potion = actor.pc?.inventory.find((i) => i.itemId === "potion-of-healing" && i.qty > 0);
        if (!potion) return `🧪 ${actor.name} hat keinen Heiltrank.`;
        potion.qty--;
        actor.pc!.inventory = actor.pc!.inventory.filter((i) => i.qty > 0);
        const roll = rollDice(this.rng, parseDice("2d4+2"));
        heal(friend, roll.total);
        fx("sparkle", friend.pos);
        return `🧪 ${actor.name} flößt ${friend.name} einen Heiltrank ein: +${roll.total} Trefferpunkte.`;
      }
      case "improvised": {
        const t = enemy(e.target) ?? (this.battle.creatures[e.target]?.side === "enemy" ? this.battle.creatures[e.target] : undefined);
        if (!t?.pos || t.dead) return undefined;
        const d = rollDice(this.rng, parseDice("1d6"));
        const total = Math.max(1, d.total + abilityMod(actor.abilities.STR));
        applyDamage(this.rng, t, total);
        fx("shake", t.pos);
        return `🍳 ${actor.name} haut ${t.name} mit etwas Improvisiertem eins über: ${d.total}${abilityMod(actor.abilities.STR) ? ` ${abilityMod(actor.abilities.STR) > 0 ? "+" : "−"} ${Math.abs(abilityMod(actor.abilities.STR))}` : ""} = ${total} Schaden${t.dead ? ` – ${t.name} ist besiegt!` : "."}`;
      }
      case "wall_break": {
        if (this.wallsBroken >= 1) return `🧱 Die Wände hier halten – eine zweite gibt nicht nach.`;
        const map = this.map;
        const toward = e.target ? this.resolveRef(e.target, actor)?.pos : undefined;
        const inner = (x: number, y: number) => x > 0 && y > 0 && x < map.width - 1 && y < map.height - 1;
        const walls = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
          .map((d) => ({ d, p: { x: pos.x + d.x, y: pos.y + d.y } }))
          .filter(({ p }) => inner(p.x, p.y) && map.cells[cellIndex(map, p.x, p.y)] === "wall")
          .sort((a, b) => (toward ? this.cheb(a.p, toward) - this.cheb(b.p, toward) : 0));
        const pick = walls.find(({ d, p }) => map.cells[cellIndex(map, p.x + d.x, p.y + d.y)] === "floor") ?? walls[0];
        if (!pick) return `🧱 Hier ist keine Wand zum Einreißen.`;
        this.wallsBroken++;
        const here = cellIndex(map, pos.x, pos.y);
        const open = (p: GridPos) => {
          const i = cellIndex(map, p.x, p.y);
          map.cells[i] = "floor";
          map.frames[i] = map.frames[here]!;
          map.roomOf[i] = map.roomOf[here] ?? -1;
          map.explored[i] = true;
          map.objects.push({ id: `rubble${++this.rollCounter}`, kind: "prop", prop: "rubble", x: p.x, y: p.y, frame: "rubble", blocking: false });
        };
        open(pick.p);
        const beyond = { x: pick.p.x + pick.d.x, y: pick.p.y + pick.d.y };
        if (map.cells[cellIndex(map, beyond.x, beyond.y)] === "wall" && inner(beyond.x, beyond.y) && map.cells[cellIndex(map, beyond.x + pick.d.x, beyond.y + pick.d.y)] === "floor") open(beyond);
        revealAround(map, pick.p, 4);
        this.syncWorld();
        this.emit("mapChanged");
        fx("shake", pick.p);
        return `💥 ${actor.name} rammt die morsche Wand – sie bricht krachend ein! Ein neuer Durchgang.`;
      }
      case "collapse": {
        if (this.collapses >= 1) return `🪨 Die Decke hier hält.`;
        const t = this.resolveRef(e.target, actor)?.pos;
        if (!t || this.cheb(pos, t) > 8) return undefined;
        this.collapses++;
        const out: string[] = [`🪨 Ein Knirschen – dann bricht über ${this.resolveRef(e.target, actor)?.name ?? "der Stelle"} die Decke ein!`];
        for (const c of Object.values(this.battle.creatures)) {
          if (!c.pos || c.dead || this.cheb(c.pos, t) > 1) continue;
          const save = savingThrow(this.rng, c, "DEX", this.sg(13));
          const d = rollDice(this.rng, parseDice("2d6")).total;
          const dmg = save.success ? Math.floor(d / 2) : d;
          applyDamage(this.rng, c, dmg);
          out.push(`${c.name}: ${dmg} Schaden${save.success ? " (ausgewichen, halbiert)" : ""}${c.dead ? " – besiegt!" : ""}.`);
        }
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const p = { x: t.x + dx, y: t.y + dy };
          if (this.map.cells[cellIndex(this.map, p.x, p.y)] !== "floor" || this.map.objects.some((o) => o.x === p.x && o.y === p.y) || this.envRng.next() < 0.4) continue;
          this.map.objects.push({ id: `rubble${++this.rollCounter}`, kind: "prop", prop: "rubble", x: p.x, y: p.y, frame: "rubble", blocking: false });
        }
        this.syncWorld();
        fx("shake", t);
        return out.join(" ");
      }
      case "leap": {
        const goal = this.resolveRef(e.target, actor);
        if (!goal) return undefined;
        const free = (p: GridPos) => isWalkable(this.map, p) && !Object.values(this.battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y) && !this.map.objects.some((o) => o.blocking && o.x === p.x && o.y === p.y);
        const land = goal.creature || goal.object?.blocking || !free(goal.pos) ? besideFree(this.map, this.battle, goal.pos) : goal.pos;
        if (this.cheb(pos, land) > 4) return `🤸 Das ist zu weit für einen Sprung (höchstens 4 Felder).`;
        actor.pos = { ...land };
        actor.effects = actor.effects.filter((x) => x.id !== "elevated");
        revealAround(this.map, land);
        this.syncWorld();
        fx("puff", land);
        return `🤸 ${actor.name} nimmt Anlauf und springt – ${goal.creature || goal.object ? `landet bei ${goal.name}` : "landet sicher auf der anderen Seite"}!`;
      }
      case "pounce": {
        const t = enemy(e.target);
        if (!t?.pos) return undefined;
        const high = hasEffect(actor, "elevated") || (this.battle.terrain?.high ?? []).includes(`${pos.x},${pos.y}`);
        if (!high) return `🦅 ${actor.name} steht nicht erhöht – erst hochklettern, dann springen!`;
        if (this.cheb(pos, t.pos) > 3) return `🦅 ${t.name} ist zu weit weg für einen Sprung.`;
        actor.pos = besideFree(this.map, this.battle, t.pos);
        actor.effects = actor.effects.filter((x) => x.id !== "elevated");
        const d = rollDice(this.rng, parseDice("1d6"));
        const dmg = Math.max(1, d.total + abilityMod(actor.abilities.STR));
        applyDamage(this.rng, t, dmg);
        if (!t.dead && ["tiny", "small", "medium"].includes(t.size)) addCondition(t, { id: "prone" });
        this.syncWorld();
        fx("shake", t.pos);
        return `🦅 ${actor.name} springt von oben auf ${t.name}: ${dmg} Schaden${t.dead ? ` – ${t.name} ist besiegt!` : ` und ${t.name} liegt am Boden!`}`;
      }
      case "noise": {
        const spot = (e.target && this.resolveRef(e.target, actor)?.pos) || pos;
        const staged = this.staged;
        if (!staged) return e.how === "loud" ? `📢 ${actor.name} macht einen Heidenlärm – aber nichts regt sich.` : `🪨 Der Stein klackert über den Boden. Niemand reagiert.`;
        if (e.how === "loud") {
          this.engage(false, `📢 ${actor.name}s Lärm weckt sie auf – zu den Waffen!`);
          return undefined;
        }
        const free = (p: GridPos) => isWalkable(this.map, p) && !Object.values(this.battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y);
        for (const m of staged.spawned) {
          if (!m.pos || m.dead || this.bossIds.has(m.id)) continue;
          let at: GridPos = m.pos;
          for (let n = 0; n < 4; n++) {
            const next: GridPos = { x: at.x + Math.sign(spot.x - at.x), y: at.y + Math.sign(spot.y - at.y) };
            if (!free(next)) break;
            at = next;
          }
          m.pos = at;
          addEffect(m, "distracted", 99, actor.id);
        }
        fx("puff", spot);
        return `🪨 ${actor.name} wirft einen Stein – klack! Die Wachen drehen sich um und schleichen dem Geräusch nach. Abgelenkt!`;
      }
      case "errand": {
        const c = this.battle.creatures[e.target];
        if (!c?.pos || c.side !== "neutral" || c.dead) return undefined;
        if (this.errands.has(`e:${c.name}`)) return `🤷 ${c.name} hat euch schon geholfen.`;
        this.errands.add(`e:${c.name}`);
        const paid = this.spendGold(3);
        const pay = paid ? " (3 Gold)" : " (als Gefallen)";
        this.emit("speech", c.id, "Wird gemacht!");
        fx("sparkle", c.pos);
        if (e.how === "heal") {
          for (const h of this.heroes()) if (!h.dead) heal(h, rollDice(this.rng, parseDice("1d6")).total);
          return `🩹 ${c.name} verbindet alle Wunden${pay}: jeder bekommt 1W6 Trefferpunkte.`;
        }
        if (e.how === "sharpen") {
          addEffect(actor, "helped", 99, c.id);
          return `⚒️ ${c.name} schärft ${actor.name}s Waffe${pay}: Vorteil auf den nächsten Wurf.`;
        }
        if (e.how === "hide") {
          for (const h of this.heroes()) if (!h.dead) addCondition(h, { id: "invisible", rounds: 2, sourceId: c.id });
          return `🫥 ${c.name} versteckt die Gruppe im Hinterzimmer${pay}: 2 Runden unsichtbar.`;
        }
        const last = this.map.rooms[this.map.rooms.length - 1]!;
        revealAround(this.map, { x: last.x + Math.floor(last.w / 2), y: last.y + Math.floor(last.h / 2) }, 6);
        const traps = this.map.objects.filter((o) => o.kind === "trap" && o.state === "hidden");
        traps.forEach((t) => (t.state = "found"));
        this.emit("mapChanged");
        return `🗺️ ${c.name} erzählt alles, was sie weiß${pay}: der Weg voraus${traps.length ? ` und ${traps.length} Falle${traps.length > 1 ? "n" : ""}` : ""} sind jetzt auf der Karte.`;
      }
      case "disguise":
        addEffect(actor, "disguised", 999, actor.id);
        fx("puff");
        return `🥸 ${actor.name} verkleidet sich – wartende Gegner halten ${actor.name} für einen von ihnen (bis zum ersten Angriff).`;
      case "interrogate": {
        const c = this.battle.creatures[e.target];
        if (!c?.pos || c.side !== "neutral" || c.dead || c.id.startsWith("npc-")) return undefined;
        if (this.errands.has(`i:${c.id}`)) return `🤐 ${c.name} hat schon alles gesagt.`;
        this.errands.add(`i:${c.id}`);
        const traps = this.map.objects.filter((o) => o.kind === "trap" && o.state === "hidden");
        traps.forEach((t) => (t.state = "found"));
        const last = this.map.rooms[this.map.rooms.length - 1]!;
        revealAround(this.map, { x: last.x + Math.floor(last.w / 2), y: last.y + Math.floor(last.h / 2) }, 6);
        this.emit("mapChanged");
        this.emit("speech", c.id, "Schon gut, schon gut! Ich sag ja alles!");
        return `🗣️ ${c.name} packt aus: der Weg voraus${traps.length ? ` und ${traps.length} versteckte Falle${traps.length > 1 ? "n" : ""}` : ""} – alles auf der Karte.`;
      }
      case "feud": {
        const t = enemy(e.target);
        const other = this.battle.creatures[e.other];
        if (!t || !other || other.dead || other.side !== "enemy") return undefined;
        addEffect(t, "feud", 1, other.id);
        this.emit("speech", t.id, `${other.name}, du Verräter!`);
        return `😤 ${actor.name} sät Zwietracht: ${t.name} geht im nächsten Zug auf ${other.name} los!`;
      }
      case "disarm": {
        const t = this.battle.creatures[e.target];
        if (!t || t.side !== "enemy" || t.dead) return undefined;
        if (e.what === "shield") {
          if (t.baseAc.some((p) => p.label === "Schild zerbrochen")) return `🛡️ Der Schild von ${t.name} ist schon kaputt.`;
          t.baseAc.push({ label: "Schild zerbrochen", value: -2, glossarKey: "ruestungsklasse" });
          fx("shake", t.pos);
          return `🛡️ ${actor.name} zertrümmert den Schild von ${t.name}: −2 Rüstungsklasse!`;
        }
        if (this.bossIds.has(t.id)) return undefined;
        addEffect(t, "hampered", 99, actor.id);
        fx("puff", t.pos);
        return `⚔️ ${actor.name} schlägt ${t.name} die Waffe aus der Hand: Nachteil auf alle Angriffe bis Kampfende!`;
      }
      case "hurl": {
        const t = enemy(e.target);
        if (!t?.pos) return undefined;
        if (!["tiny", "small"].includes(t.size)) return `💪 ${t.name} ist zu groß zum Werfen.`;
        if (abilityMod(actor.abilities.STR) < 1) return `💪 ${actor.name} ist nicht stark genug, um ${t.name} hochzuheben.`;
        if (this.cheb(pos, t.pos) > 1) return `💪 ${t.name} ist zu weit weg – erst hingehen.`;
        const toward = e.toward ? this.battle.creatures[e.toward] : undefined;
        const other = (toward?.side === "enemy" && !toward.dead ? toward : undefined) ?? this.enemiesVisible().filter((x) => x.id !== t.id && isActive(x) && x.pos && this.cheb(x.pos, pos) <= 6)[0];
        const d1 = rollDice(this.rng, parseDice("1d6")).total;
        applyDamage(this.rng, t, d1);
        if (other?.pos) {
          t.pos = besideFree(this.map, this.battle, other.pos);
          const d2 = rollDice(this.rng, parseDice("1d6")).total;
          applyDamage(this.rng, other, d2);
          if (!other.dead && !this.bossIds.has(other.id) && ["tiny", "small", "medium"].includes(other.size)) addCondition(other, { id: "prone" });
          if (!t.dead) addCondition(t, { id: "prone" });
          fx("shake", other.pos);
          return `💪 ${actor.name} packt ${t.name} und schleudert ${t.name} auf ${other.name}: ${d1} und ${d2} Schaden – beide gehen zu Boden!`;
        }
        if (!t.dead) addCondition(t, { id: "prone" });
        fx("shake", t.pos);
        return `💪 ${actor.name} packt ${t.name} und wirft ${t.name} zu Boden: ${d1} Schaden!`;
      }
      case "animals": {
        const t = this.battle.creatures[e.target];
        if (!t?.pos || t.dead || t.side !== "enemy") return undefined;
        if (e.how === "bees") {
          const out: string[] = [`🐝 ${actor.name} schleudert einen Bienenstock – ein wütender Schwarm stürzt sich auf ${t.name}!`];
          for (const c of Object.values(this.battle.creatures)) {
            if (!c.pos || c.dead || c.side !== "enemy" || this.cheb(c.pos, t.pos) > 1) continue;
            const d = rollDice(this.rng, parseDice("1d4")).total;
            applyDamage(this.rng, c, d);
            addEffect(c, "hampered", 1, actor.id);
            out.push(`${c.name}: ${d} Stiche${c.dead ? " – besiegt!" : ", fuchtelt wild herum (Nachteil)."}`);
          }
          fx("puff", t.pos);
          return out.join(" ");
        }
        if (e.how === "scare") {
          const beasts = Object.values(this.battle.creatures).filter((c) => c.pos && !c.dead && c.side === "enemy" && c.creatureType === "beast" && !this.bossIds.has(c.id) && this.cheb(c.pos, t.pos!) <= 3);
          if (!beasts.length) return `🐾 Hier gibt es keine Tiere zum Verscheuchen.`;
          for (const c of beasts) delete this.battle.creatures[c.id];
          this.victoryNote = "Die Tiere sind davongerannt.";
          return `🐾 ${actor.name} macht die Tiere scheu: ${beasts.map((c) => c.name).join(", ")} ${beasts.length > 1 ? "jaulen und rennen" : "jault und rennt"} davon!`;
        }
        if (this.ratsCalled || !this.battle.combat) return this.ratsCalled ? `🐀 Die Ratten sind schon satt.` : undefined;
        this.ratsCalled = true;
        const rats = createMonster("swarm-of-rats", `rats${++this.rollCounter}`, { name: "Rattenschwarm (für euch)", side: "party" });
        rats.pos = besideFree(this.map, this.battle, t.pos);
        this.battle.creatures[rats.id] = rats;
        this.addToInitiative(rats);
        fx("puff", rats.pos);
        return `🐀 ${actor.name} lockt mit Essensresten einen Rattenschwarm an – und der fällt über ${t.name} her!`;
      }
      case "ice_bridge": {
        const cold = actor.pc?.spells.some((s) => ["ray-of-frost"].includes(s)) || actor.attacks.some((a) => a.damage.some((d) => d.type === "cold"));
        if (!cold) return `❄️ Dafür braucht es Frostmagie – die hat ${actor.name} nicht.`;
        const t = (e.target && this.resolveRef(e.target, actor)?.pos) || pos;
        let frozen = 0;
        this.map.surface ??= {};
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const p = { x: t.x + dx, y: t.y + dy };
          const i = cellIndex(this.map, p.x, p.y);
          if (this.map.cells[i] !== "water" && this.map.cells[i] !== "deep" && this.map.surface[i]?.kind !== "puddle") continue;
          if (this.map.cells[i] === "deep") this.map.cells[i] = "water";
          this.map.surface[i] = { kind: "ice", turns: 12 };
          frozen++;
        }
        if (!frozen) return `❄️ Hier ist kein Wasser zum Einfrieren.`;
        this.syncWorld();
        this.emit("mapChanged");
        fx("sparkle", t);
        return `❄️ ${actor.name} lässt Frost über das Wasser kriechen – eine glitzernde Eisbrücke entsteht (Vorsicht, rutschig)!`;
      }
      case "shove": {
        const t = enemy(e.target);
        if (!t?.pos) return undefined;
        if (this.cheb(pos, t.pos) > 2 && !actor.pc?.spells.includes("thunderwave")) return `💨 ${t.name} ist zu weit weg zum Stoßen.`;
        const toward = e.toward ? this.resolveRef(e.toward, actor)?.pos : undefined;
        const dir = toward ? { x: Math.sign(toward.x - t.pos.x), y: Math.sign(toward.y - t.pos.y) } : { x: Math.sign(t.pos.x - pos.x), y: Math.sign(t.pos.y - pos.y) };
        return this.pushCreature(t, dir, 2, actor);
      }
      case "pressure":
        return this.onPressure?.(actor, e.target, e.how);
      case "captive": {
        const c = this.battle.creatures[e.target];
        if (!c?.pos || c.dead || c.side !== "neutral" || c.id.startsWith("npc-")) return undefined;
        if (e.how === "take") {
          c.followId = actor.id;
          c.captive = true;
          this.emit("speech", c.id, "Schon gut, ich komm ja mit …");
          return `⛓️ ${actor.name} nimmt ${c.name} als Gefangenen mit.`;
        }
        delete this.battle.creatures[c.id];
        if (e.how === "hand_over") {
          this.addItem(actor, "gold", 8);
          return `⚖️ ${actor.name} übergibt ${c.name} den Wachen – 8 Gold Kopfgeld!`;
        }
        this.onSpared?.(c.name, c.monsterId ?? "bandit");
        return `🕊️ ${actor.name} lässt ${c.name} laufen. „Das vergesse ich euch nicht!“`;
      }
      case "weakness": {
        const t = this.battle.creatures[e.target];
        if (!t?.pos || t.dead || t.side !== "enemy") return undefined;
        if (hasEffect(t, "weakspot")) return `🔎 Die Schwachstelle von ${t.name} kennt ihr schon.`;
        addEffect(t, "weakspot", 99, actor.id);
        this.learnAll(t);
        fx("sparkle", t.pos);
        return `🔎 ${actor.name} studiert ${t.name} und entdeckt: ${weakSpot(t)}. Alle Angriffe auf ${t.name} haben jetzt Vorteil! (${this.typeSummary(t)})`;
      }
      case "set_trap": {
        if (this.map.objects.some((o) => o.x === pos.x && o.y === pos.y && (o.kind === "trap" || o.blocking))) return undefined;
        this.map.objects.push({ id: `wire${++this.rollCounter}`, kind: "trap", variant: "wire", x: pos.x, y: pos.y, frame: "trap.net", blocking: false, state: "found" });
        this.syncWorld();
        fx("puff");
        return `🪤 ${actor.name} spannt eine Stolperfalle – wer hier drauftritt, fällt hin.`;
      }
      default:
        return undefined;
    }
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

  /** The current round (exploring and fighting). */
  get round(): number {
    return this.battle.combat?.round ?? 0;
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
  private lastPoint = new Map<PlayerId, number>();
  /** The last move, while it can still be taken back (nothing revealed, rolled or hit). */
  private undo: { heroId: string; from: GridPos; costFt: number; companions: [string, GridPos][] } | undefined;

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
    this.turnStartedAt = Date.now();
    this.turnActivityAt = this.turnStartedAt;
    this.emit("turn", c.name, c.appearance?.color ?? (c.side === "enemy" ? "#b03030" : undefined), false, this.turnInfo());
  }

  /** "Runde 3 · danach: Brunhild, Ole" for the TV. */
  private turnInfo(): string | undefined {
    const combat = this.battle.combat;
    if (!combat) return undefined;
    const next: string[] = [];
    for (let k = 1; k < combat.order.length && next.length < 3; k++) {
      const o = combat.order[(combat.turnIndex + k) % combat.order.length]!;
      const c = this.battle.creatures[o.creatureId];
      if (c && isActive(c) && !next.includes(c.name)) next.push(c.name);
    }
    return `Runde ${combat.round}${next.length ? ` · danach: ${next.join(", ")}` : ""}`;
  }

  /** When the current turn began / the active player last did something (a silent player is skipped). */
  private turnStartedAt = Date.now();
  private turnActivityAt = Date.now();

  /** Exploring in turns: seconds until the active player is skipped (undefined in fights and free exploring). */
  secondsLeft(): number | undefined {
    if (this.freeExplore || this.mode !== "explore" || !this.active()?.playerId) return undefined;
    const since = Date.now() - Math.max(this.turnStartedAt, this.turnActivityAt);
    return Math.max(0, Math.ceil((SILENT_TURN_MS - since) / 1000));
  }

  /** The hero whose turn comes after the active one. */
  private nextUp(): Creature | undefined {
    const combat = this.battle.combat;
    if (!combat) return undefined;
    for (let k = 1; k < combat.order.length; k++) {
      const c = this.battle.creatures[combat.order[(combat.turnIndex + k) % combat.order.length]!.creatureId];
      if (c && isActive(c)) return c;
    }
    return undefined;
  }

  /** Turn-based exploring: called at the end of every round (the world may do something then). */
  onRoundEnd: ((round: number) => void) | undefined;

  endTurn(): void {
    if (this.destroyed) return;
    this.pending = undefined;
    this.undo = undefined;
    for (let guard = 0; guard < 40; guard++) {
      const round = this.battle.combat?.round;
      const start = nextTurn(this.rng, this.battle);
      // A new round: fire spreads and burns down, ice melts.
      if (this.battle.combat && round !== undefined && this.battle.combat.round !== round) {
        this.tickSurfaces();
        this.arenaTick();
        if (this.checkWinner()) return;
        // Exploring in turns: people in the scene move now, and now and then something happens.
        if (this.mode === "explore") {
          this.emit("round", round);
          this.tickWorld(true);
          if (this.mode !== "explore") return;
          this.onRoundEnd?.(this.battle.combat.round);
        }
      }
      // Starting the turn in flames hurts.
      const now = this.battle.creatures[start.creatureId];
      if (now && isActive(now) && surfaceKind(this.map, now.pos) === "fire") {
        this.publishWorld(now, "Feuer", burnCreature(this.envRng, now));
        if (this.checkWinner()) return;
      }
      if (now) {
        this.elementsAtTurnStart(now);
        if (this.checkWinner()) return;
      }
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
      hardenMonster(m, DIFFICULTY[this.difficulty]);
      m.pos = free[i];
      this.battle.creatures[m.id] = m;
    });
    this.emit("changed");
    this.checkCombatStart();
  }

  /** Enemies that notice the heroes: visible and not too far away. */
  private awakeEnemies(): Creature[] {
    return this.enemiesVisible().filter((e) => isActive(e) && this.heroes().some((h) => isActive(h) && !(unaware(e) && hasEffect(h, "disguised")) && distanceFt(h, e) <= (unaware(e) ? 10 : 60)));
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
    this.reinforced = false;
    // Characters walking with the group fight at its side.
    for (const f of Object.values(this.battle.creatures)) if (f.followId && !f.captive && f.side === "neutral" && !f.dead) f.side = "party";
    const ids = [...this.heroes().filter((h) => !h.dead).map((h) => h.id), ...enemies.map((e) => e.id), ...this.alliesInPlay()];
    this.styleUsed.clear();
    const combat = startCombat(this.rng, this.battle, ids);
    const lines: ExplainedLine[] = [
      { text: "⚔️ Kampf! Alle würfeln Initiative. Wer am höchsten würfelt, ist zuerst dran.", glossarKeys: ["initiative"] },
      ...combat.order.map((e) => explainInitiative(this.battle, e)),
    ];
    this.addLog(lines);
    this.publishRoll({ id: `o${++this.rollCounter}`, creatureId: combat.order[0]!.creatureId, title: "Kampf!", sides: 20, dice: [], kept: 0, lines });
    this.emit("combat", true);
    this.tricksUsed.clear();
    this.startArena();
    this.wizardLore();
    this.grantBoons();
    this.companionsAtFightStart();
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
    // Companions from the village go back to being themselves – and have something to say.
    for (const f of Object.values(this.battle.creatures)) {
      if (!f.followId || f.captive || f.dead) continue;
      f.side = "neutral";
      if (winner === "party") this.emit("speech", f.id, FOLLOWER_LINES[this.envRng.int(0, FOLLOWER_LINES.length - 1)]!);
    }
    this.addLog(lines);
    this.publishRoll({ id: `o${++this.rollCounter}`, creatureId: this.heroes()[0]!.id, title: winner === "party" ? "Sieg!" : "Niederlage", sides: 20, dice: [], kept: 0, lines, success: winner === "party" });
    this.emit("combat", false);
    this.sweepXp();
    this.training = false;
    this.start();
    this.applyLevels();
    const waiter = this.fightWaiter;
    this.fightWaiter = undefined;
    waiter?.(winner === "party" ? "party" : "enemy");
    return true;
  }

  private maybeRunMonster(): void {
    const c = this.active();
    if (this.mode !== "combat" || !c || this.destroyed) return;
    if (c.kind !== "monster" && !this.opts.autoHeroes) return;
    const delay = this.opts.monsterDelayMs ?? MONSTER_PAUSE_MS;
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
      const delay = this.opts.monsterDelayMs ?? MONSTER_PAUSE_MS;
      if (delay <= 0) this.endTurn();
      else this.monsterTimer = setTimeout(() => this.endTurn(), delay);
      return;
    }
    // Losing and outnumbered: ordinary talking foes may give up and become prisoners.
    const foes = Object.values(this.battle.creatures).filter((c) => c.side === "enemy" && isActive(c));
    const friends = Object.values(this.battle.creatures).filter((c) => c.side === "party" && isActive(c));
    if (canTalk(monster.monsterId ?? "") && !this.bossIds.has(monster.id) && monster.hp / monster.maxHp < 0.3 && foes.length <= friends.length && this.envRng.next() < 0.35) {
      monster.side = "neutral";
      monster.captive = true;
      monster.effects = [];
      this.emit("speech", monster.id, "Gnade! Ich ergebe mich!");
      const lines: ExplainedLine[] = [{ text: `🏳️ ${monster.name} wirft die Waffe weg und ergibt sich – ein Gefangener. (Laufen lassen, mitnehmen oder übergeben?)`, glossarKeys: ["gefangene"] }];
      this.addLog(lines);
      this.emit("lines", lines);
      this.victoryNote = "Die letzten Gegner haben sich ergeben.";
      this.emit("changed");
      if (this.checkWinner()) return;
      this.endTurn();
      return;
    }
    // Calls for help: once per fight, when things go badly for their side.
    const fallen = Object.values(this.battle.creatures).filter((c) => c.side === "enemy" && c.dead).length;
    if (!this.reinforced && canTalk(monster.monsterId ?? "") && !this.bossIds.has(monster.id) && fallen >= 1 && this.envRng.next() < 0.15 && monster.pos) {
      this.reinforced = true;
      const help = createMonster(monster.monsterId!, `m${++this.rollCounter}`, { name: `${nameOf("monsters", monster.monsterId!)} (Verstärkung)` });
      const far = this.map.rooms[this.map.roomOf[cellIndex(this.map, monster.pos.x, monster.pos.y)] ?? 0];
      help.pos = besideFree(this.map, this.battle, far ? { x: far.x + 1, y: far.y + 1 } : monster.pos);
      this.battle.creatures[help.id] = help;
      this.addToInitiative(help);
      this.emit("speech", monster.id, "HILFE! Hierher!");
      const lines: ExplainedLine[] = [{ text: `📯 ${monster.name} brüllt um Hilfe – ${help.name} stürmt herein!`, glossarKeys: [] }];
      this.addLog(lines);
      this.emit("lines", lines);
      this.emit("changed");
    }
    // Talked into a quarrel: this turn it goes for another foe.
    const feud = monster.effects.find((x) => x.id === "feud");
    if (feud) {
      monster.effects = monster.effects.filter((x) => x.id !== "feud");
      const other = this.battle.creatures[feud.sourceId];
      const option = monster.attacks[0];
      if (other?.pos && !other.dead && option && monster.pos) {
        if (this.cheb(monster.pos, other.pos) > 1) monster.pos = besideFree(this.map, this.battle, other.pos);
        const attack = resolveAttack(this.rng, this.battle, monster, other, option);
        const roll = this.outcomeToRoll(monster, `${monster.name} greift ${other.name} an!`, 20, { ok: true, actorId: monster.id, cost: "action", kind: "attack", attack });
        roll.lines.unshift({ text: `😤 ${monster.name} geht auf ${other.name} los: „Verräter!“`, glossarKeys: [] });
        this.publishRoll(roll);
        this.emit("changed");
        if (this.checkWinner()) return;
        const delay = this.opts.monsterDelayMs ?? MONSTER_PAUSE_MS;
        if (delay <= 0) this.endTurn();
        else this.monsterTimer = setTimeout(() => this.endTurn(), delay);
        return;
      }
    }
    // Monsters use the room too: flip tables, tip braziers, throw torches, hurl crates.
    if (this.monsterTrick(monster)) {
      const turn = this.battle.combat?.turn;
      if (turn) {
        turn.actions = 0;
        turn.attacksLeft = 0;
      }
      this.emit("changed");
      if (this.checkWinner()) return;
    }
    const outcomes = runAutoTurn(this.rng, this.battle, id, { walkable: (p) => isWalkable(this.map, p) && !isHazard(this.battle, p) });
    for (const o of outcomes) {
      if (!o.ok) continue;
      const title = o.kind === "attack" ? `${monster.name} greift an` : o.kind === "move" ? `${monster.name} bewegt sich` : monster.name;
      const roll = this.outcomeToRoll(monster, title, 20, o);
      if (o.kind === "move" && !o.opportunityAttacks.length) {
        this.addLog(roll.lines);
        this.emit("changed");
      } else this.publishRoll(roll);
      if (o.kind === "move" && monster.pos) this.walkedThrough(monster, [monster.pos]);
    }
    this.emit("changed");
    if (this.checkWinner()) return;
    const delay = this.opts.monsterDelayMs ?? MONSTER_PAUSE_MS;
    if (delay <= 0) this.endTurn();
    else this.monsterTimer = setTimeout(() => this.endTurn(), delay);
  }

  // ---------------------------------------------------------------- actions

  /** When a phone last did something (the game master speaks up when it is quiet for long). */
  lastActionAt = Date.now();

  // ---------------------------------------------------------------- campfire (rest + trader between chapters)

  private camp: {
    questions: Map<string, string>;
    tales: Map<string, string>;
    done: Set<string>;
    shop: CampOffer[];
    resolve: (tales: CampTale[]) => void;
  } | undefined;

  /** The heroes rest at the fire: each is asked a question and may shop. Resolves when all are ready (or endCamp()). */
  startCamp(questions: Record<string, string>, shop: CampOffer[]): Promise<CampTale[]> {
    this.endCamp();
    return new Promise((resolve) => {
      this.camp = { questions: new Map(Object.entries(questions)), tales: new Map(), done: new Set(), shop: [...shop], resolve };
      this.emitCamp();
      this.broadcast();
    });
  }

  /** A long rest for everyone: hit points, spells and features come back (fallen heroes stay fallen). */
  restAll(): void {
    for (const h of this.heroes()) {
      if (h.dead) continue;
      // A burning torch stays lit (nobody wants to find it again in the dark).
      const torch = h.effects.find((e) => e.id === "torch");
      longRest(h);
      if (torch) h.effects.push(torch);
    }
    this.broadcast();
  }

  /** Ends the rest (everyone ready, or the time is up). */
  endCamp(): void {
    const camp = this.camp;
    if (!camp) return;
    this.camp = undefined;
    this.emit("camp", undefined);
    const tales = [...camp.tales].map(([heroId, text]) => ({ heroId, name: this.battle.creatures[heroId]?.name ?? "?", question: camp.questions.get(heroId) ?? "", text }));
    camp.resolve(tales);
    this.broadcast();
  }

  get inCamp(): boolean {
    return !!this.camp;
  }

  private campHeroes(): Creature[] {
    return this.heroes().filter((h) => !h.dead && h.playerId);
  }

  private emitCamp(): void {
    const camp = this.camp;
    if (!camp) return;
    this.emit("camp", { ready: camp.done.size, total: this.campHeroes().length });
  }

  private goldOf(hero: Creature): number {
    return hero.pc?.inventory.find((i) => i.itemId === "gold")?.qty ?? 0;
  }

  private campAction(hero: Creature, action: Extract<PlayerAction, { kind: "camp_tell" | "camp_buy" | "camp_done" }>): string | undefined {
    const camp = this.camp;
    if (!camp) return "Die Rast ist schon vorbei.";
    if (action.kind === "camp_tell") {
      const text = action.text.replace(/\s+/g, " ").trim().slice(0, 220);
      if (!text) return "Erzähl etwas – ein Satz reicht.";
      if (camp.tales.has(hero.id)) return "Du hast schon erzählt.";
      camp.tales.set(hero.id, text);
      this.narrate([{ npc: hero.name, text }]);
      this.emit("emote", hero.id, "🔥");
    } else if (action.kind === "camp_buy") {
      const offer = camp.shop.find((o) => o.id === action.offerId);
      if (!offer) return "Das hat die Händlerin nicht mehr.";
      if (this.goldOf(hero) < offer.price) return `Dafür fehlen dir ${offer.price - this.goldOf(hero)} Gold.`;
      this.addItem(hero, "gold", -offer.price);
      if (offer.gearId) {
        camp.shop = camp.shop.filter((o) => o !== offer);
        this.grantGear(hero, offer.gearId, "Gekauft bei der Händlerin");
      } else if (offer.itemId) {
        this.addItem(hero, offer.itemId, 1);
        this.addLog([{ text: `🛒 ${hero.name} kauft ${offer.icon} ${offer.name} für ${offer.price} Gold.`, glossarKeys: [] }]);
      }
    } else {
      camp.done.add(hero.id);
      this.emitCamp();
      if (this.campHeroes().every((h) => camp.done.has(h.id))) {
        this.endCamp();
        return undefined;
      }
    }
    this.broadcast();
    return undefined;
  }

  private campView(hero: Creature): CampView | undefined {
    const camp = this.camp;
    if (!camp) return undefined;
    const gold = this.goldOf(hero);
    return {
      question: camp.questions.get(hero.id) ?? "Was möchtest du den anderen erzählen?",
      told: camp.tales.has(hero.id),
      done: camp.done.has(hero.id),
      gold,
      shop: camp.shop.map((o) => {
        const problem = o.gearId ? gearProblem(hero, o.gearId) : undefined;
        const owned = o.gearId && hero.pc?.gear?.owned.includes(o.gearId);
        const blocked = owned ? "Hast du schon" : gold < o.price ? `Noch ${o.price - gold} Gold` : undefined;
        return { id: o.id, icon: o.icon, name: o.name, detail: o.detail, price: o.price, ...(blocked ? { blocked } : {}), ...(problem ? { warning: problem } : {}) };
      }),
      tales: [...camp.tales].map(([id, text]) => {
        const h = this.battle.creatures[id];
        return { name: h?.name ?? "?", ...(h?.appearance ? { color: h.appearance.color } : {}), text };
      }),
      ready: camp.done.size,
      total: this.campHeroes().length,
    };
  }

  /** A check's target number on this difficulty (never below 5). */
  sg(dc: number): number {
    return Math.max(5, dc + DIFFICULTY[this.difficulty].dc);
  }

  handle(playerId: PlayerId, action: PlayerAction): void {
    this.lastActionAt = Date.now();
    if (this.active()?.playerId === playerId) this.turnActivityAt = this.lastActionAt;
    if (action.kind === "set_beginner_mode") {
      this.beginner.set(playerId, action.on);
      this.sendView(playerId);
      return;
    }
    const hero = this.heroOf(playerId);
    if (!hero) return;
    if (action.kind === "final_blow") {
      const ask = this.blowAsk;
      if (!ask || ask.heroId !== hero.id) return;
      this.blowAsk = undefined;
      ask.resolve(action.text.replace(/\s+/g, " ").trim().slice(0, 200));
      this.broadcast();
      return;
    }
    if (action.kind === "camp_tell" || action.kind === "camp_buy" || action.kind === "camp_done") {
      const err = this.campAction(hero, action);
      if (err) this.sendTo(playerId, { type: "action_error", reason: err });
      return;
    }
    if (action.kind === "point") {
      // A finger on the phone's map shows on the TV (and a planned route), for everyone to see.
      const now = Date.now();
      if (now - (this.lastPoint.get(playerId) ?? 0) < 300) return;
      this.lastPoint.set(playerId, now);
      const path = (action.path ?? []).slice(0, 30).filter((p) => Number.isInteger(p.x) && Number.isInteger(p.y));
      if (Number.isInteger(action.x) && Number.isInteger(action.y)) this.emit("point", hero.id, { x: action.x, y: action.y }, path);
      return;
    }
    if (action.kind === "emote") {
      // Only the known reactions, and not more than one per second and a half.
      const now = Date.now();
      if (!(EMOTES as readonly string[]).includes(action.emoji) || now - (this.lastEmote.get(playerId) ?? 0) < 1500) return;
      this.lastEmote.set(playerId, now);
      this.statsOf(hero.id).emotes++;
      this.emit("emote", hero.id, action.emoji);
      return;
    }
    if (action.kind === "craft") {
      const err = this.craftFor(hero, action.recipe);
      if (err) this.sendTo(playerId, { type: "action_error", reason: err });
      return;
    }
    if (action.kind === "equip" || action.kind === "unequip" || action.kind === "give_gear") {
      const err = action.kind === "equip" ? this.equip(hero, action.gearId) : action.kind === "unequip" ? this.unequip(hero, action.slot) : this.giveGear(hero, action.gearId, action.toId);
      if (err) this.sendTo(playerId, { type: "action_error", reason: err });
      else this.broadcast();
      return;
    }
    if (action.kind === "story_choice") {
      const offer = this.storyChoices.find((c) => c.id === action.choiceId);
      if (!offer || !this.choiceWaiter) {
        this.sendTo(playerId, { type: "action_error", reason: "Diese Entscheidung ist nicht mehr offen." });
        return;
      }
      if (this.votes) {
        this.castVote(playerId, offer.id);
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
    if (action.kind === "family") {
      const reason = this.onFamily ? this.onFamily(hero, action) : "Hier gibt es keine Familie.";
      if (reason) this.sendTo(playerId, { type: "action_error", reason });
      this.broadcast();
      return;
    }
    if (action.kind === "spend_point") {
      // One point per level: +1 on an attribute (never above 20). Any time outside a fight.
      const pc = hero.pc;
      if (!pc) return;
      const left = pointsDue(pc.level, pc.chapters ?? 0) - pointsSpent(pc.improvements);
      const reason = left <= 0 ? "Du hast keinen Attributspunkt übrig." : this.mode === "combat" ? "Das geht nach dem Kampf." : hero.abilities[action.ability] >= 20 ? "Höher als 20 geht es nicht." : undefined;
      if (reason) {
        this.sendTo(playerId, { type: "action_error", reason });
        return;
      }
      pc.improvements = [...(pc.improvements ?? []), `pt:${action.ability}`];
      const next = this.levelHero(hero, pc.level, true, false);
      next.hp = Math.min(next.maxHp, hero.hp + Math.max(0, next.maxHp - hero.maxHp));
      this.addLog([{ text: `💪 ${hero.name}: ${ABILITY_NAMES[action.ability]} +1`, glossarKeys: ["attribute"] }]);
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
    if (action.kind === "cancel_roll") {
      const p = this.pending;
      if (!p || p.playerId !== playerId || p.prompt.id !== action.rollId || !p.cancel) return;
      this.pending = undefined;
      p.cancel();
      this.emit("askCancelled");
      this.broadcast();
      return;
    }
    if (action.kind === "roll") {
      if (!this.pending || this.pending.playerId !== playerId || this.pending.prompt.id !== action.rollId) return;
      const pending = this.pending;
      this.pending = undefined;
      this.undo = undefined;
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
    if (action.kind === "undo_move") {
      this.undoMove(playerId, hero);
      return;
    }
    this.undo = undefined;
    if (action.kind === "use_item" && action.itemId === "torch") {
      this.toggleTorch(hero);
      return;
    }
    if (action.kind === "use_item" && CUSTOM_ITEMS.includes(action.itemId)) {
      this.useCustomItem(playerId, hero, action.itemId, action.targetId);
      return;
    }
    if (action.kind === "tame") {
      this.tame(playerId, hero, action.creatureId);
      return;
    }
    if (action.kind === "ground") {
      this.pickUpGround(playerId, hero, action.use, { x: action.x, y: action.y });
      return;
    }
    switch (action.kind) {
      case "end_turn":
        this.endTurn();
        return;
      case "approach": {
        // Walk next to the enemy, then strike (one button on the phone).
        const target = this.battle.creatures[action.targetId];
        if (!target?.pos || !isActive(target)) {
          this.sendTo(playerId, { type: "action_error", reason: "Dieses Ziel gibt es nicht mehr." });
          return;
        }
        this.walkTowards(playerId, hero, { pos: target.pos, name: target.name });
        if (this.active()?.id !== hero.id || this.mode !== "combat") return;
        this.handle(playerId, { kind: "attack", targetId: target.id, optionId: action.optionId });
        return;
      }
      case "move":
        this.move(playerId, hero, action.to);
        return;
      case "flirt":
      case "propose":
      case "gift": {
        // Only with people, only outside a fight; a step closer first if needed.
        const npc = this.battle.creatures[action.npcId];
        if (!npc || npc.side !== "neutral" || npc.dead || !npc.pos || !hero.pos || npc.appearance) {
          this.sendTo(playerId, { type: "action_error", reason: "Diese Person ist nicht hier." });
          return;
        }
        if (this.mode === "combat") {
          this.sendTo(playerId, { type: "action_error", reason: "Mitten im Kampf? Das hat Zeit bis später!" });
          return;
        }
        if (Math.max(Math.abs(npc.pos.x - hero.pos.x), Math.abs(npc.pos.y - hero.pos.y)) > 1) {
          this.walkTowards(playerId, hero, { pos: npc.pos, name: npc.name });
          if (!hero.pos || Math.max(Math.abs(npc.pos.x - hero.pos.x), Math.abs(npc.pos.y - hero.pos.y)) > 1 || this.active()?.id !== hero.id) return;
        }
        if (action.kind === "gift") {
          const inv = hero.pc?.inventory ?? [];
          const entry = inv.find((i) => i.itemId === action.itemId);
          const amount = action.itemId === "gold" ? 10 : 1;
          if (!entry || entry.qty < amount) {
            this.sendTo(playerId, { type: "action_error", reason: "Das hast du nicht dabei." });
            return;
          }
          entry.qty -= amount;
          if (entry.qty <= 0) inv.splice(inv.indexOf(entry), 1);
          const name = action.itemId === "gold" ? "10 Goldmünzen" : itemTitle(action.itemId);
          this.emit("speech", hero.id, `🎁 ${name}`);
          this.onGift?.(playerId, hero, npc.name, action.itemId, name);
          this.broadcast();
          return;
        }
        if (action.kind === "propose") {
          const inv = hero.pc?.inventory ?? [];
          const ring = inv.find((i) => i.itemId === "verlobungsring" && i.qty > 0);
          if (!ring) {
            this.sendTo(playerId, { type: "action_error", reason: "Ohne Ring? Die Händlerin am Lagerfeuer hat welche." });
            return;
          }
          this.emit("speech", hero.id, "💍");
          if (this.onPropose?.(playerId, hero, npc.name)) {
            ring.qty -= 1;
            if (ring.qty <= 0) inv.splice(inv.indexOf(ring), 1);
          }
          this.broadcast();
          return;
        }
        this.emit("speech", hero.id, "🌹");
        this.onFlirt?.(playerId, hero, npc.name);
        return;
      }
      case "go_use": {
        // Walk to the object, then use it right away if it is within reach.
        const o = this.map.objects.find((x) => x.id === action.objectId);
        if (!o || !hero.pos) {
          this.sendTo(playerId, { type: "action_error", reason: "Das gibt es hier nicht mehr." });
          return;
        }
        this.walkTowards(playerId, hero, { pos: { x: o.x, y: o.y }, name: objectName(o) });
        if (this.active()?.id !== hero.id || this.pending) return;
        const use = this.choicesFor(hero, true, false).find((c) => c.enabled && c.action.kind === "interact" && c.action.objectId === o.id && !c.targets?.length);
        if (use) this.handle(playerId, use.action);
        else if (Math.max(Math.abs(o.x - hero.pos.x), Math.abs(o.y - hero.pos.y)) <= 1) this.sendTo(playerId, { type: "action_error", reason: `Mit ${objectName(o)} kannst du gerade nichts machen.` });
        return;
      }
      case "free_text": {
        const said = action.text.trim();
        // "Ich gehe zur Theke (und frage nach dem Weg)": walk there first, as far as the movement goes.
        const walk = said ? walkIntent(said) : undefined;
        let spoke = false;
        if (walk) {
          const goal = this.walkGoal(hero, walk.target);
          if (goal) {
            this.emit("speech", hero.id, said);
            spoke = true;
            this.walkTowards(playerId, hero, goal);
            // Nothing else to do, or the walk started a fight / ended the turn.
            if (!walk.rest || this.active()?.id !== hero.id) return;
          }
        }
        // "Ich frage den Wirt nach dem Weg": step up to the person first (the answer comes as a speech bubble).
        if (!walk && TALK.test(said.toLowerCase())) {
          const npc = Object.values(this.battle.creatures).find((c) => c.side === "neutral" && !c.dead && c.pos && nameFits(said.toLowerCase(), c.name));
          if (npc?.pos && hero.pos && Math.max(Math.abs(npc.pos.x - hero.pos.x), Math.abs(npc.pos.y - hero.pos.y)) > 2) {
            this.emit("speech", hero.id, said);
            spoke = true;
            this.walkTowards(playerId, hero, { pos: npc.pos, name: npc.name });
            if (this.active()?.id !== hero.id) return;
          }
        }
        // "Bello, fass den Goblin!": the companion goes for that enemy (a shout costs nothing).
        if (said && this.commandCompanion(hero, said)) return;
        // "Ich braue einen Heiltrank": brewing works as always (anytime, no action).
        const brew = said ? this.craftByText(hero, said) : undefined;
        if (brew !== undefined) {
          if (brew) this.sendTo(playerId, { type: "action_error", reason: brew });
          else this.broadcast();
          return;
        }
        const choices = said ? this.choicesFor(hero, true, false) : [];
        // Things, furniture and abilities: "Ich trinke einen Heiltrank", "Ich kippe den Tisch um", "Ich verstecke mich".
        const thing = said ? matchUtility(said, choices, hero.id) : undefined;
        // "Ich schieße mit dem Bogen auf den Goblin": that is simply the bow attack (or the fitting spell).
        const found = thing ?? (said ? matchFreeText(said, choices, hero.id, isTrick(said)) : undefined);
        if (found && "blocked" in found) {
          // Not possible – but maybe something else is: offer it right away.
          const alternatives = this.alternativesFor(hero, found.choice, choices);
          if (alternatives.length) {
            this.sendTo(playerId, { type: "free_text_options", text: said, note: `${found.choice.label}: ${found.blocked} Stattdessen:`, options: alternatives });
            return;
          }
          this.sendTo(playerId, { type: "action_error", reason: `${found.choice.label}: ${found.blocked}` });
          return;
        }
        if (found && "ask" in found) {
          // Not clear: „Meinst du …?“ on the phone.
          this.sendTo(playerId, {
            type: "free_text_options",
            text: said,
            options: found.ask.map((m) => ({ label: `${m.choice.label}${m.targetNames.length ? ` → ${m.targetNames.join(", ")}` : ""}`, detail: m.choice.detail, action: m.action })),
          });
          return;
        }
        if (found) {
          const { choice, targetNames } = found.match;
          if (choice.group === "attack" || choice.group === "spell") this.flavorFor(hero, said, found.match);
          this.addLog([{ text: `${hero.name}: „${said.slice(0, 100)}“ → ${choice.label}${targetNames.length ? ` auf ${targetNames.join(", ")}` : ""}`, glossarKeys: [choice.glossarKey] }]);
          if (!spoke) this.emit("speech", hero.id, said);
          this.handle(playerId, found.match.action);
          return;
        }
        // In a fight a free action is a real action (tricks would be too strong otherwise).
        const turn = this.mode === "combat" ? this.battle.combat?.turn : undefined;
        if (turn) {
          if (turn.actions < 1) {
            this.sendTo(playerId, { type: "action_error", reason: "Deine Aktion ist schon verbraucht. Im Kampf kostet eine freie Aktion deine Aktion." });
            return;
          }
          turn.actions -= 1;
        }
        this.statsOf(hero.id).freeActions++;
        this.addLog([{ text: `${hero.name} versucht: „${action.text.slice(0, 140)}“`, glossarKeys: ["freie_aktion"] }]);
        if (action.text.trim() && !spoke) this.emit("speech", hero.id, action.text.trim());
        this.onFreeText?.(playerId, hero, action.text.slice(0, 300));
        this.broadcast();
        return;
      }
      case "interact":
        this.interact(playerId, hero, action.objectId, action.targetId, action.use);
        return;
      case "check":
        this.ask(playerId, hero, { title: `Umsehen (${nameOf("skills", action.skill)})`, sides: 20, glossarKey: "umsehen", need: rollNeed("SG", this.sg(LOOK_DC), sumParts(skillParts(hero, "perception"))) }, () => this.lookAround(hero));
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
        return { type: "attack", targetId: a.targetId, optionId: a.optionId, ...(a.smiteSlot ? { smiteSlot: a.smiteSlot } : {}), ...(a.stun ? { stun: true } : {}) };
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
          case "bardic-inspiration":
          case "martial-arts":
          case "flurry-of-blows":
            return { type: a.feature, targetId: a.targetId ?? "" };
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
      const option = hero.attacks.find((o) => o.id === a.optionId);
      const need = target && option ? rollNeed("RK", armorClass(target), sumParts(option.toHit)) : undefined;
      return { title: `Angriff auf ${target?.name ?? "?"}`, sides: 20, glossarKey: "angriffswurf", ...(need ? { need } : {}), targetIds: [a.targetId] };
    }
    if (a.kind === "cast") {
      const spell = getSpell(a.spellId);
      const name = nameOf("spells", spell.id);
      if (spell.attack) {
        const target = a.targetIds[0] ? this.battle.creatures[a.targetIds[0]] : undefined;
        const need = target ? rollNeed("RK", armorClass(target), sumParts(spellAttackParts(hero, spell.id))) : undefined;
        return { title: name, sides: 20, glossarKey: `zauber:${spell.id}`, ...(need ? { need } : {}), targetIds: a.targetIds };
      }
      const dice = spell.damage?.byCharLevel?.["1"] ?? spell.damage?.bySlot?.[String(spell.level)] ?? spell.heal?.[String(spell.level)] ?? spell.hpPool?.["1"];
      if (!dice) return undefined;
      const sides = parseDice(dice, 0).terms[0]?.sides ?? 6;
      return { title: name, sides, glossarKey: `zauber:${spell.id}`, ...(a.targetIds.length ? { targetIds: a.targetIds } : {}) };
    }
    if (a.kind === "use_item") return { title: "Heiltrank", sides: 4, glossarKey: "gegenstand:potion-of-healing" };
    if (a.kind === "feature") {
      if (a.feature === "second-wind") return { title: "Durchatmen", sides: 10, glossarKey: "merkmal:second-wind" };
      if (a.feature === "hide") return { title: "Verstecken", sides: 20, glossarKey: "verstecken" };
      if (a.feature === "martial-arts" || a.feature === "flurry-of-blows") return { title: a.feature === "flurry-of-blows" ? "Schlaghagel" : "Kampfkunst", sides: 20, glossarKey: `merkmal:${a.feature}` };
    }
    void hero;
    return undefined;
  }

  private ask(playerId: PlayerId, hero: Creature, prompt: Omit<RollPrompt, "id">, run: PendingRoll["run"], cancel?: () => void): void {
    const full: RollPrompt = { ...prompt, id: `r${++this.rollCounter}` };
    this.pending = { prompt: full, playerId, creatureId: hero.id, run, ...(cancel ? { cancel } : {}) };
    this.sendTo(playerId, { type: "request_roll", prompt: full });
    // The TV shows the die waiting for this hero.
    this.emit("asked", full, hero.id, hero.name, hero.appearance?.color);
    this.sendView(playerId);
  }

  /** Enemies swear (switched off in the TV settings: then they are only cheeky). */
  crude = true;
  private lastTaunt = 0;

  /** Enemies who can talk mock the heroes – now and then (at most one line every 15 seconds). */
  private trashTalk(r: RollOutcome): void {
    if (this.mode !== "combat" || !r.hits?.length || Date.now() - this.lastTaunt < 15_000) return;
    const actor = this.battle.creatures[r.creatureId];
    if (!actor) return;
    for (const hit of r.hits) {
      const target = this.battle.creatures[hit.targetId];
      if (!target || hit.heal) continue;
      const enemyActs = actor.side === "enemy" && target.side === "party";
      const heroActs = actor.side === "party" && target.side === "enemy";
      if (!enemyActs && !heroActs) continue;
      const enemy = enemyActs ? actor : target;
      const hero = enemyActs ? target : actor;
      const event = enemyActs ? (hit.miss ? "missed_hero" : "hit_hero") : hit.miss ? "hero_missed" : target.dead || target.hp <= 0 ? "dying" : target.hp / target.maxHp < 0.3 ? "low" : "hurt";
      // Some of the rank and file are young (goblin gangs, bandit kids): they talk in youth slang.
      const young = YOUNG_FOES.has(enemy.monsterId ?? "") && [...enemy.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 3 === 0;
      const line = tauntFor(event, enemy.monsterId ?? "", hero.name, this.crude, this.envRng.next(), this.envRng.next(), young);
      if (!line) continue;
      this.lastTaunt = Date.now();
      // A bubble over the foe; read aloud only for its last words (less talking over the game).
      this.emit("speech", enemy.id, line);
      if (event === "dying") this.narrate([{ npc: enemy.name, text: line }]);
      else this.addLog([{ text: `💬 ${enemy.name}: „${line}“`, glossarKeys: [] }]);
      return;
    }
  }

  private publishRoll(r: RollOutcome): void {
    if (!r.bullets) {
      r.bullets = bulletsFor(r, (id) => {
        const c = this.battle.creatures[id];
        return c ? { name: c.name, hp: c.hp, enemy: c.side === "enemy" } : undefined;
      });
    }
    this.tellFlavor(r);
    this.combo(r);
    this.track(r);
    this.trashTalk(r);
    const striker = this.battle.creatures[r.creatureId];
    if (striker && hasEffect(striker, "disguised") && r.hits?.some((x) => this.battle.creatures[x.targetId]?.side === "enemy")) {
      striker.effects = striker.effects.filter((x) => x.id !== "disguised");
      r.lines.push({ text: `🥸 ${striker.name}s Verkleidung fliegt auf!`, glossarKeys: [] });
    }
    // TV: who did what, then the coloured points ("⚔️ −7 Schaden an Goblin 1").
    const actor = this.battle.creatures[r.creatureId]?.name;
    const head = r.lines[0]?.text && !MATH_LINE.test(r.lines[0].text) ? r.lines[0].text : `${actor ? `${actor}: ` : ""}${r.title}`;
    const tv = r.bullets?.length ? [{ text: head, glossarKeys: r.lines[0]?.glossarKeys ?? [] }, ...r.bullets.map((b) => ({ text: `${BULLET_ICON[b.tone]} ${b.text}`, glossarKeys: [] }))] : undefined;
    this.addLog(r.lines, tv);
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
    // (A bonus action counts only when there is something to use it for.)
    const bonusLeft = () => !!c && this.choicesFor(c, true, false).some((x) => x.cost === "bonus" && x.enabled);
    if (c && turn && turn.actions <= 0 && (turn.attacksLeft ?? 0) <= 0 && turn.movementLeftFt <= 0 && (!turn.bonusAction || !bonusLeft())) {
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
    const world = this.worldReacts(o);
    lines.push(...world.lines);
    const typed = this.typeReacts(hero, o);
    lines.push(...typed.lines);
    world.hits.push(...typed.hits);
    // A raven that goes for the eyes leaves its target distracted.
    if (o.ok && o.kind === "attack" && o.attack.hit && hero.companion?.trait === "augenpicker") {
      const t = this.battle.creatures[o.attack.targetId];
      if (t && isActive(t)) {
        addEffect(t, "distracted", 10, hero.id);
        lines.push({ text: `🐦‍⬛ ${hero.name} hackt nach den Augen – ${t.name} ist abgelenkt!`, glossarKeys: ["begleiter", "abgelenkt"] });
      }
    }
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
      } else if (o.kind === "strikes" && o.attacks[0]) {
        dice = o.attacks.map((x) => x.roll.natural);
        kept = o.attacks[0].roll.natural;
        success = o.attacks.some((x) => x.hit);
        crit = o.attacks.some((x) => x.crit);
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
      hits: [...hitsOf(o), ...world.hits],
      fx: fxOf(this.battle, hero, o),
    };
  }

  // ---------------------------------------------------------------- movement & exploring

  private move(playerId: PlayerId, hero: Creature, to: GridPos): void {
    const turn = this.battle.combat?.turn;
    const before = { pos: hero.pos ? { ...hero.pos } : undefined, ft: turn?.movementLeftFt ?? 0, hp: hero.hp, conditions: hero.conditions.length, explored: this.exploredCount(), mode: this.mode, prone: hasCondition(hero, "prone") };
    const companions = this.heroes().filter((c) => c.companion && c.pos).map((c): [string, GridPos] => [c.id, { ...c.pos! }]);
    const steps = Math.floor((turn?.movementLeftFt ?? hero.speedFt) / 5);
    // Walking onto a friend: the two trade places (so nobody gets stuck behind the group in a tunnel).
    const partner = this.swapPartner(hero, to);
    const partnerPos = partner?.pos;
    if (partner) partner.pos = undefined;
    const restore = () => {
      if (partner) partner.pos = partnerPos;
    };
    const path = findPath(this.battle, hero, (p) => p.x === to.x && p.y === to.y, (p) => isWalkable(this.map, p), steps);
    if (!path || path.length === 0 || pathCost(this.battle, path) > steps) {
      restore();
      this.sendTo(playerId, { type: "action_error", reason: "Dorthin kommst du in diesem Zug nicht." });
      return;
    }
    if (partner && this.map.objects.some((o) => o.kind === "trap" && o.state === "hidden" && path.some((p) => p.x === o.x && p.y === o.y) && !(o.x === to.x && o.y === to.y))) {
      // A hidden trap on the way stops the walk before the swap: keep it simple, no swap then.
      restore();
      return this.move(playerId, hero, path.find((p) => this.map.objects.some((o) => o.kind === "trap" && o.state === "hidden" && o.x === p.x && o.y === p.y))!);
    }
    // Stop on the first hidden trap on the way.
    let walk = path;
    const trapIndex = path.findIndex((p) => this.map.objects.some((o) => o.kind === "trap" && o.state === "hidden" && o.x === p.x && o.y === p.y));
    if (trapIndex >= 0) walk = path.slice(0, trapIndex + 1);
    const outcome = perform(this.rng, this.battle, hero.id, { type: "move", path: walk });
    if (!outcome.ok) {
      restore();
      this.sendTo(playerId, { type: "action_error", reason: outcome.reason });
      return;
    }
    const lines = explainOutcome(this.battle, outcome);
    // Climbed down to walk on.
    if (hasEffect(hero, "elevated")) {
      hero.effects = hero.effects.filter((x) => x.id !== "elevated");
      this.syncWorld();
    }
    if (partner) {
      const behind = walk.length > 1 ? walk[walk.length - 2]! : before.pos;
      const free = (p: GridPos | undefined) => p && !Object.values(this.battle.creatures).some((c) => c.id !== partner.id && !c.dead && c.pos?.x === p.x && c.pos?.y === p.y);
      partner.pos = free(behind) ? { ...behind! } : free(before.pos) ? { ...before.pos! } : besideFree(this.map, this.battle, hero.pos!);
      lines.push({ text: `🔄 ${hero.name} und ${partner.name} tauschen die Plätze.`, glossarKeys: ["bewegung"] });
    }
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
    this.walkedThrough(hero, walk);
    if (this.mode !== "combat") this.companionsFollow(hero);
    const quiet = outcome.kind === "move" && !partner && !outcome.opportunityAttacks.length && trapIndex < 0 && !lines.some((l) => /^(🗺️|💰|🧪)/.test(l.text));
    this.undo = undefined;
    this.afterAction();
    // Taking it back is fair as long as the move showed nothing new and nothing happened on the way.
    const turnNow = this.battle.combat?.turn;
    if (quiet && before.pos && !before.prone && this.active()?.id === hero.id && !this.pending && this.mode === before.mode && hero.hp === before.hp && hero.conditions.length === before.conditions && this.exploredCount() === before.explored && turnNow) {
      this.undo = { heroId: hero.id, from: before.pos, costFt: before.ft - turnNow.movementLeftFt, companions };
      this.broadcast();
    }
  }

  private exploredCount(): number {
    let n = 0;
    for (const e of this.map.explored) if (e) n++;
    return n;
  }

  /** "↩️ Zurück": the hero stands where they were, with the movement back. */
  private undoMove(playerId: PlayerId, hero: Creature): void {
    const u = this.undo;
    const turn = this.battle.combat?.turn;
    if (!u || u.heroId !== hero.id || !turn || this.active()?.id !== hero.id || this.pending) {
      this.sendTo(playerId, { type: "action_error", reason: "Das lässt sich nicht mehr zurücknehmen." });
      return;
    }
    const blocked = (p: GridPos) => Object.values(this.battle.creatures).some((c) => c.id !== hero.id && !c.dead && c.pos && c.pos.x === p.x && c.pos.y === p.y && !u.companions.some(([id]) => id === c.id));
    if (blocked(u.from)) {
      this.sendTo(playerId, { type: "action_error", reason: "Dort steht jetzt jemand anderes." });
      return;
    }
    this.undo = undefined;
    hero.pos = { ...u.from };
    turn.movementLeftFt += u.costFt;
    for (const [id, pos] of u.companions) {
      const c = this.battle.creatures[id];
      if (c && !c.dead) c.pos = { ...pos };
    }
    this.addLog([{ text: `↩️ ${hero.name} überlegt es sich anders und geht zurück.`, glossarKeys: ["bewegung"] }]);
    this.emit("changed");
    this.broadcast();
  }

  /** Ice on the way may throw you over; ending the move in fire burns. */
  private walkedThrough(c: Creature, path: GridPos[]): void {
    if (!c.pos) return;
    if (path.some((p) => surfaceKind(this.map, p) === "ice")) this.publishWorld(c, "Glatteis", slipOnIce(this.envRng, c, this.sg(ICE_DC)));
    if (surfaceKind(this.map, c.pos) === "fire") this.publishWorld(c, "Feuer", burnCreature(this.envRng, c));
    const wire = c.side === "enemy" ? this.map.objects.find((o) => o.kind === "trap" && o.variant === "wire" && o.state === "found" && o.x === c.pos!.x && o.y === c.pos!.y) : undefined;
    if (wire) {
      wire.state = "used";
      wire.frame = "";
      const r = slipOnIce(this.envRng, c, this.sg(12));
      r.lines = r.lines.map((l) => ({ text: l.text.replace("🧊", "🪢").replace("schlittert übers Eis", "stolpert über den Draht").replace("rutscht auf dem Eis aus und fällt hin", "verfängt sich im Stolperdraht und schlägt der Länge nach hin"), glossarKeys: ["gegenstand:stolperdraht", ...l.glossarKeys.filter((k) => k !== "eis")] }));
      this.publishWorld(c, "Stolperdraht", r);
    }
  }

  // ---------------------------------------------------------------- types (like Pokémon)

  /** What the heroes learned about each kind of foe: damage types seen, "*" = all. */
  private known = new Map<string, Set<string>>();

  /** Knowledge to keep (bestiary on the TV) and to bring back. */
  knowledge(): Record<string, string[]> {
    return Object.fromEntries([...this.known].map(([k, v]) => [k, [...v]]));
  }

  setKnowledge(k: Record<string, string[]>): void {
    for (const [key, types] of Object.entries(k)) if (Array.isArray(types)) this.known.set(key, new Set([...(this.known.get(key) ?? []), ...types]));
  }

  private knows(c: Creature, type: string): boolean {
    const set = this.known.get(typeKey(c));
    return !!set && (set.has("*") || set.has(type));
  }

  /** Learns every strength and weakness of this kind of foe; true if something was new. */
  private learnAll(c: Creature): boolean {
    const set = this.known.get(typeKey(c)) ?? new Set<string>();
    if (set.has("*")) return false;
    set.add("*");
    this.known.set(typeKey(c), set);
    this.onKnowledge?.();
    return true;
  }

  /** Something new was learned (the board keeps a bestiary). */
  onKnowledge: (() => void) | undefined;

  /** The strengths and weaknesses the heroes know about: "🔥 Feuer ×2", "❄️ Kälte ×½" … */
  knownTypes(c: Creature): string[] {
    if (!c.monsterId) return [];
    const all = [...new Set([...c.vulnerabilities, ...c.resistances, ...c.immunities])];
    return all
      .filter((t) => this.knows(c, t))
      .map((t) => {
        const m = effectiveness(c, t);
        return `${TYPE_ICON[t] ?? ""} ${TYPE_NAME[t]} ${m === 0 ? "✖" : m < 1 ? "×½" : "×2"}`.trim();
      });
  }

  /** For the target list: how this weapon's damage works on the foe – only once learned. */
  private typeHint(c: Creature, types: DamageType[]): string {
    const out: string[] = [];
    for (const t of new Set(types)) {
      const m = effectiveness(c, t);
      if (m === 1 || !this.knows(c, t)) continue;
      out.push(`${m > 1 ? "💥" : m === 0 ? "🚫" : "🛡️"} ${TYPE_NAME[t]} ${m === 0 ? "wirkt nicht" : m < 1 ? "×½" : "×2"}`);
    }
    return out.length ? ` · ${out.join(" · ")}` : "";
  }

  /** What is known about a foe, in one line. */
  private typeSummary(c: Creature): string {
    const k = this.knownTypes(c);
    return k.length ? k.join(" · ") : "keine besonderen Stärken oder Schwächen";
  }

  /**
   * After damage: the heroes learn how their damage type works on this kind of foe ("Sehr
   * effektiv!"), and small elemental states may follow.
   */
  private typeReacts(actor: Creature, o: ActionOutcome): WorldResult {
    const out: WorldResult = { lines: [], hits: [] };
    if (!o.ok) return out;
    const pairs: [string, DamageResult][] = [];
    if (o.kind === "attack" && o.attack.damage) pairs.push([o.attack.targetId, o.attack.damage]);
    if (o.kind === "strikes") for (const a of o.attacks) if (a.damage) pairs.push([a.targetId, a.damage]);
    if (o.kind === "spell") for (const t of o.spell.targets) if (t.damage) pairs.push([t.targetId, t.damage]);
    let flash: string | undefined;
    for (const [id, dmg] of pairs) {
      const t = this.battle.creatures[id];
      if (!t) continue;
      if (actor.side === "party" && t.side === "enemy" && t.monsterId) {
        let learned = false;
        for (const l of dmg.lines) {
          const fresh = !this.knows(t, l.type);
          const set = this.known.get(typeKey(t)) ?? new Set<string>();
          set.add(l.type);
          this.known.set(typeKey(t), set);
          learned ||= fresh;
          if (!l.note) continue;
          const word = l.note === "vulnerability" ? "💥 Sehr effektiv!" : l.note === "immunity" ? "🚫 Wirkt nicht!" : "🛡️ Nicht sehr effektiv …";
          flash ??= word;
          out.lines.push({ text: `${word} ${TYPE_ICON[l.type] ?? ""} ${TYPE_NAME[l.type]} gegen ${t.name}${fresh ? " – das merkt ihr euch!" : ""}`, glossarKeys: ["typen"] });
        }
        // Class roles: a fighter reads how a foe fights, a cleric knows the dead.
        const role = actor.pc?.classId === "fighter" ? "⚔️ Kampferfahrung" : actor.pc?.classId === "cleric" && t.creatureType === "undead" ? "✨ Wissen über Untote" : undefined;
        if (role && dmg.total > 0 && this.learnAll(t)) out.lines.push({ text: `${role}: ${actor.name} durchschaut ${t.name} – ${this.typeSummary(t)}.`, glossarKeys: ["typen"] });
        else if (learned) this.onKnowledge?.();
      }
      const r = afterHit(this.envRng, this.map, this.battle, actor, t, dmg, !this.bossIds.has(t.id) && sizeInSquares(t.size) <= 1);
      out.lines.push(...r.lines);
      out.hits.push(...r.hits);
    }
    if (flash) this.emit("flash", flash);
    return out;
  }

  /** At the start of a fight the wizard remembers what the books say about one of the foes. */
  private wizardLore(): void {
    const wizard = this.heroes().find((h) => h.pc?.classId === "wizard" && isActive(h));
    if (!wizard) return;
    const foe = Object.values(this.battle.creatures).find(
      (c) => c.side === "enemy" && isActive(c) && c.monsterId && (c.vulnerabilities.length || c.resistances.length || c.immunities.length) && !this.known.get(typeKey(c))?.has("*"),
    );
    if (!foe || !this.learnAll(foe)) return;
    this.addLog([{ text: `📚 ${wizard.name} erinnert sich an die Bücher: ${foe.name.replace(/ \d+$/, "")} – ${this.typeSummary(foe)}.`, glossarKeys: ["typen"] }]);
  }

  /** Start of a turn: wet from water or rain, burning, chilled. */
  private elementsAtTurnStart(c: Creature): void {
    if (this.mode !== "combat" || !isActive(c)) return;
    soak(this.map, c);
    const r = turnStart(this.envRng, c);
    const turn = this.battle.combat?.turn;
    if (r.slowFt && turn?.creatureId === c.id) turn.movementLeftFt = Math.max(0, turn.movementLeftFt - r.slowFt);
    if (r.lines.length) this.publishWorld(c, "Brennt", r);
  }

  /** Shows what the room did (fire, ice …) like a roll: log, phones, floating numbers. */
  private publishWorld(c: Creature, title: string, r: WorldResult): void {
    if (!r.lines.length) return;
    this.addLog(r.lines);
    this.publishRoll({ ...this.objectRoll(c, title, undefined, r.lines), ...(r.hits.length ? { hits: r.hits } : {}) });
    this.emit("changed");
  }

  /** The room reacts to an action: fire spells light things up, frost freezes puddles, blows leave traces. */
  private worldReacts(o: ActionOutcome): WorldResult {
    const out: WorldResult = { lines: [], hits: [] };
    if (!o.ok) return out;
    const squaresOf = (ids: string[]) => ids.map((id) => this.battle.creatures[id]?.pos).filter((p): p is GridPos => !!p);
    let element: string | undefined;
    let squares: GridPos[] = [];
    if (o.kind === "spell") {
      element = SPELL_FX[o.spell.spellId]?.element;
      // Spells that miss still fly somewhere: the fire lands next to the target.
      squares = squaresOf(o.spell.targets.map((t) => t.targetId));
    } else if (o.kind === "save-action") {
      element = /fire/.test(o.actionId) ? "fire" : /cold/.test(o.actionId) ? "cold" : undefined;
      squares = squaresOf(o.results.map((r) => r.targetId));
    }
    if (element === "fire" && squares.length && o.kind === "spell" && ["sacred-flame"].includes(o.spell.spellId)) element = undefined;
    const r = element === "fire" ? fireHits(this.map, this.envRng, squares) : element === "cold" ? coldHits(this.map, squares) : undefined;
    if (r) {
      out.lines.push(...r.lines);
      // Whoever stands in the new flames burns right away.
      if (r.lines.some((l) => l.text.startsWith("🔥"))) {
        for (const c of creaturesOn(this.battle, squares.flatMap((p) => [p]))) {
          if (surfaceKind(this.map, c.pos) !== "fire" || !isActive(c)) continue;
          const b = burnCreature(this.envRng, c);
          out.lines.push(...b.lines);
          out.hits.push(...b.hits);
        }
      }
    }
    for (const h of hitsOf(o)) {
      const c = this.battle.creatures[h.targetId];
      if (c && !h.heal && !h.miss) leaveTrace(this.map, this.envRng, c, h.amount);
    }
    // Thunderwave throws whoever failed the save 2 squares away – into fire, onto ice, into water.
    if (o.kind === "spell" && o.spell.spellId === "thunderwave") {
      const caster = this.battle.creatures[o.spell.casterId];
      for (const t of o.spell.targets) {
        const c = this.battle.creatures[t.targetId];
        if (!caster?.pos || !c?.pos || c.dead || t.save?.success || ["large", "huge", "gargantuan"].includes(c.size)) continue;
        const line = this.pushCreature(c, { x: Math.sign(c.pos.x - caster.pos.x), y: Math.sign(c.pos.y - caster.pos.y) }, 2, caster);
        if (line) out.lines.push({ text: line.replace("stößt", "schleudert"), glossarKeys: ["zauber:thunderwave"] });
      }
    }
    return out;
  }

  private triggerTrap(hero: Creature): ExplainedLine[] {
    const trap = this.map.objects.find((o) => o.kind === "trap" && o.x === hero.pos!.x && o.y === hero.pos!.y);
    if (!trap) return [];
    trap.state = "used";
    const kind = TRAPS.find((t) => t.id === trap.variant) ?? TRAPS[this.envRng.int(0, TRAPS.length - 1)]!;
    const say = (text: string) => text.replaceAll("{hero}", hero.name);
    const save = savingThrow(this.rng, hero, kind.save, this.sg(TRAP_DC));
    const lines: ExplainedLine[] = [{ text: say(kind.intro), glossarKeys: ["falle"] }];
    lines.push(...explainCheck(this.battle, hero.id, save));
    if (save.success) {
      lines.push({ text: say(kind.dodge), glossarKeys: ["rettungswurf"] });
      return lines;
    }
    lines.push({ text: say(kind.hit), glossarKeys: ["falle"] });
    if (kind.gold) {
      const gold = rollDice(this.envRng, parseDice(kind.gold)).total;
      this.addItem(hero, "gold", gold);
      lines.push({ text: `💰 ${hero.name} sammelt ${gold} Münzen ein.`, glossarKeys: ["gegenstand:gold"] });
    }
    if (kind.prone && this.mode === "combat" && addCondition(hero, { id: "prone" })) lines.push({ text: `🤕 ${hero.name} liegt am Boden.`, glossarKeys: ["zustand:prone"] });
    if (kind.dice) {
      const d = rollDice(this.rng, parseDice(kind.dice));
      const damage = { lines: [{ type: kind.type ?? ("piercing" as const), dice: d.dice, parts: d.dice.map((v) => ({ label: "W6", value: v, glossarKey: "w6" })), raw: d.total, final: d.total }], total: d.total, crit: false };
      lines.push(...explainDamage(damage));
      lines.push(...explainHp(this.battle, applyDamage(this.rng, hero, d.total)));
    }
    if (hero.pos) this.emit("fx", kind.fx ?? "puff", hero.pos);
    return lines;
  }

  private pickUp(hero: Creature): ExplainedLine[] {
    const lines: ExplainedLine[] = [];
    for (const o of this.map.objects) {
      if (o.x !== hero.pos!.x || o.y !== hero.pos!.y || o.state === "used") continue;
      if (o.kind === "gold") {
        const amount = rollDice(this.rng, parseDice("1d8")).total;
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
    if (itemId === "gold" && qty > 0) this.statsOf(hero.id).gold += qty;
    if (qty > 0) {
      const who = { heroId: hero.id, name: hero.name, ...(hero.appearance ? { color: hero.appearance.color } : {}) };
      this.reward(hero, itemId === "gold" ? { kind: "gold", ...who, amount: qty } : { kind: "item", ...who, itemId, title: itemTitle(itemId), icon: itemIcon(itemId), qty });
    }
  }

  /** Tells the TV and the hero's phone what the hero just gained. */
  private reward(hero: Creature, reward: Reward): void {
    this.emit("reward", reward);
    if (hero.playerId) this.sendTo(hero.playerId, { type: "reward", reward });
  }

  // ---------------------------------------------------------------- equipment

  private gearOf(hero: Creature): NonNullable<NonNullable<Creature["pc"]>["gear"]> {
    const pc = hero.pc!;
    pc.gear ??= { owned: [] };
    return pc.gear;
  }

  /** Puts on a piece of equipment the hero owns. Returns an error in words, or undefined. */
  equip(hero: Creature, gearId: string, quiet = false): string | undefined {
    const g = getGear(gearId);
    if (!g || !hero.pc) return "Unbekannter Gegenstand.";
    const gear = this.gearOf(hero);
    if (!gear.owned.includes(gearId)) return "Das hast du nicht dabei.";
    const problem = gearProblem(hero, gearId);
    if (problem) return problem;
    if (this.mode === "combat" && g.slot !== "weapon") return "Rüstung und Schmuck wechselt man nicht mitten im Kampf.";
    if (gear[g.slot]) this.unequip(hero, g.slot, true);
    gear[g.slot] = gearId;
    if (g.effect === "hp") {
      hero.maxHp += g.bonus;
      hero.hp += g.bonus;
    }
    // The figure shows the new weapon or armour.
    if (g.doll && hero.appearance) {
      const look = hero.appearance.look as Record<string, string | undefined>;
      const before = (gear.lookBefore ??= {});
      if (!(g.doll.layer in before)) before[g.doll.layer] = look[g.doll.layer];
      look[g.doll.layer] = g.doll.id;
    }
    refreshAttacks(hero);
    if (!quiet) this.addLog([{ text: `${g.icon} ${hero.name} legt ${g.name} an.`, glossarKeys: ["ausruestung"] }]);
    this.emit("changed");
    return undefined;
  }

  unequip(hero: Creature, slot: "weapon" | "armor" | "trinket", quiet = false): string | undefined {
    const gear = this.gearOf(hero);
    const id = gear[slot];
    if (!id) return "Da trägst du nichts Besonderes.";
    const g = getGear(id)!;
    if (this.mode === "combat" && slot !== "weapon" && !quiet) return "Rüstung und Schmuck wechselt man nicht mitten im Kampf.";
    delete gear[slot];
    if (g.effect === "hp") {
      hero.maxHp -= g.bonus;
      hero.hp = Math.min(hero.hp, hero.maxHp);
    }
    const before = gear.lookBefore;
    if (g.doll && hero.appearance && before && g.doll.layer in before) {
      const look = hero.appearance.look as Record<string, string | undefined>;
      look[g.doll.layer] = before[g.doll.layer];
      delete before[g.doll.layer];
    }
    refreshAttacks(hero);
    if (!quiet) {
      this.addLog([{ text: `${hero.name} legt ${g.name} ab.`, glossarKeys: [] }]);
      this.emit("changed");
    }
    return undefined;
  }

  /** Hands a piece to another hero (outside fights). */
  giveGear(hero: Creature, gearId: string, toId: string): string | undefined {
    const to = this.battle.creatures[toId];
    const gear = this.gearOf(hero);
    if (!to?.pc || to.id === hero.id) return "Wem willst du es geben?";
    if (this.mode === "combat") return "Im Kampf ist dafür keine Zeit.";
    if (!gear.owned.includes(gearId)) return "Das hast du nicht dabei.";
    const g = getGear(gearId)!;
    if (gear[g.slot] === gearId) this.unequip(hero, g.slot, true);
    gear.owned = gear.owned.filter((x) => x !== gearId);
    this.grantGear(to, gearId, `${hero.name} gibt ${to.name}`);
    return undefined;
  }

  /** A new piece of equipment for a hero; worn right away if the slot is free and it fits. */
  grantGear(hero: Creature, gearId: string, how = "Beute"): void {
    const g = getGear(gearId);
    if (!g || !hero.pc) return;
    const gear = this.gearOf(hero);
    if (!gear.owned.includes(gearId)) gear.owned.push(gearId);
    const lines: ExplainedLine[] = [{ text: `🎁 ${how}: ${hero.name} erhält ${g.icon} ${g.name} – ${g.detail}.`, glossarKeys: ["ausruestung"] }];
    const fits = !gearProblem(hero, gearId);
    if (fits && !gear[g.slot] && (this.mode !== "combat" || g.slot === "weapon")) {
      this.equip(hero, gearId, true);
      lines.push({ text: `${hero.name} legt es gleich an.`, glossarKeys: [] });
    } else if (!fits) {
      lines.push({ text: `${hero.name} kann damit nichts anfangen – vielleicht jemand anderes? (Taschen → Weitergeben)`, glossarKeys: [] });
    }
    // Told once (the narration also lands in the log).
    this.narrate([{ text: lines.map((l) => l.text).join(" ") }]);
    this.emit("fx", "sparkle", hero.pos);
    this.reward(hero, { kind: "gear", heroId: hero.id, name: hero.name, ...(hero.appearance ? { color: hero.appearance.color } : {}), icon: g.icon, title: g.name, detail: g.detail, how });
  }

  /** A random piece nobody in the group has yet, preferably one this hero can use. */
  randomGear(forHero?: Creature, rng: Rng = this.rng): string | undefined {
    const owned = new Set(this.heroes().flatMap((h) => h.pc?.gear?.owned ?? []));
    const free = GEAR.filter((g) => !owned.has(g.id));
    const usable = forHero ? free.filter((g) => !gearProblem(forHero, g.id)) : free;
    const pool = usable.length ? usable : free;
    return pool.length ? pool[rng.int(0, pool.length - 1)]!.id : undefined;
  }

  // ---------------------------------------------------------------- the look back (recap)

  /** Numbers per hero for the look back at the end. */
  readonly stats = new Map<string, HeroStats>();
  private downed = new Set<string>();

  statsOf(heroId: string): HeroStats {
    let s = this.stats.get(heroId);
    if (!s) {
      s = emptyStats();
      this.stats.set(heroId, s);
    }
    return s;
  }

  /** Counts what a roll did (damage, kills, crits, healing, bad luck). */
  // ---------------------------------------------------------------- the final blow

  /** The hero who struck down a boss (taken by the director after the fight). */
  private bossKill: { heroId: string; boss: string } | undefined;
  private blowAsk: { heroId: string; boss: string; resolve: (text: string) => void } | undefined;

  /** A new scene begins: its title and goal big on the TV. */
  sceneCard(title: string, goal: string): void {
    this.emit("scene", title, goal);
  }

  /** A big note at the top of the TV while the table waits for something (undefined = away). */
  banner(info: { icon: string; title: string; text: string } | undefined): void {
    this.emit("banner", info);
  }

  takeBossKill(): { heroId: string; boss: string } | undefined {
    const k = this.bossKill;
    this.bossKill = undefined;
    return k;
  }

  /** Asks the hero's phone to describe the final blow; resolves with the text ("" = skipped). */
  askFinalBlow(heroId: string, boss: string): Promise<string> {
    return new Promise((resolve) => {
      this.blowAsk = { heroId, boss, resolve };
      this.broadcast();
    });
  }

  /** No answer in time: go on without. */
  endFinalBlow(): void {
    const ask = this.blowAsk;
    if (!ask) return;
    this.blowAsk = undefined;
    ask.resolve("");
    this.broadcast();
  }

  // ---------------------------------------------------------------- secret goals

  private goals = new Map<string, string>();
  private goalsMet = new Set<string>();

  /** The level each hero started this adventure with (hero book heroes may start above the story's level). */
  private startLevels = new Map<string, number>();

  /** Hands out the secret goals (hero id → goal id). */
  setGoals(goals: Record<string, string>): void {
    this.goals = new Map(Object.entries(goals).filter(([, id]) => goalById(id)));
    this.goalsMet.clear();
    this.broadcast();
  }

  /** Goals reached during the game: the phone cheers, the TV only says who (not what). */
  private checkGoals(): void {
    for (const [heroId, goalId] of this.goals) {
      const goal = goalById(goalId);
      if (!goal || goal.atEnd || this.goalsMet.has(heroId) || !goalReached(goal, this.statsOf(heroId))) continue;
      this.goalsMet.add(heroId);
      const hero = this.battle.creatures[heroId];
      if (!hero) continue;
      this.narrate([{ text: `🤫 ${hero.name} hat heimlich ein geheimes Ziel erfüllt! Was es war, erfahrt ihr am Ende.` }]);
      this.emit("emote", hero.id, "🤫");
      if (hero.playerId) this.sendTo(hero.playerId, { type: "secret_message", text: `🤫 Geheimes Ziel erfüllt: ${goal.text} Am Ende gibt es ${GOAL_GOLD} Gold dafür.` });
    }
  }

  /** The end: decides the goals, pays the bonus gold, tells everyone what they were. */
  finalizeGoals(): NonNullable<Recap["goals"]> {
    const out: NonNullable<Recap["goals"]> = [];
    for (const [heroId, goalId] of this.goals) {
      const goal = goalById(goalId);
      const hero = this.battle.creatures[heroId];
      if (!goal || !hero) continue;
      const done = this.goalsMet.has(heroId) || goalReached(goal, this.statsOf(heroId));
      if (done && !hero.dead) this.addItem(hero, "gold", GOAL_GOLD);
      out.push({ heroId, name: hero.name, color: hero.appearance?.color ?? "#888", icon: goal.icon, reveal: goal.reveal, done });
    }
    if (out.length) {
      this.narrate([
        { text: "🤫 Und jetzt die geheimen Ziele:" },
        ...out.map((g) => ({ text: `${g.done ? "✅" : "❌"} ${g.name} ${g.reveal}${g.done ? ` – geschafft! +${GOAL_GOLD} Gold` : "."}` })),
      ]);
    }
    return out;
  }

  private goalView(hero: Creature): PlayerView["goal"] {
    const goal = goalById(this.goals.get(hero.id) ?? "");
    if (!goal) return undefined;
    const [have, need] = goal.progress(this.statsOf(hero.id));
    return { icon: goal.icon, text: goal.text, have, need, done: this.goalsMet.has(hero.id), atEnd: !!goal.atEnd };
  }

  /** Counts one of the optional numbers (chests, finds, …). */
  private bump(heroId: string, key: "chests" | "finds" | "objects" | "helps"): void {
    const s = this.statsOf(heroId);
    s[key] = (s[key] ?? 0) + 1;
  }

  private track(r: RollOutcome): void {
    const actor = this.battle.creatures[r.creatureId];
    const heroActs = !!actor && actor.kind === "pc";
    if (heroActs && r.sides === 20 && r.dice.length && r.kept === 1) this.statsOf(actor.id).fumbles++;
    for (const hit of r.hits ?? []) {
      const target = this.battle.creatures[hit.targetId];
      if (hit.miss) continue;
      if (hit.heal) {
        if (heroActs) this.statsOf(actor.id).healing += hit.amount;
        continue;
      }
      if (heroActs && target?.kind !== "pc") {
        const s = this.statsOf(actor.id);
        s.damageDealt += hit.amount;
        if (hit.crit) s.crits++;
        if (hit.amount > s.biggestHit) {
          s.biggestHit = hit.amount;
          s.biggestHitTarget = target?.name.replace(/ \d+$/, "");
        }
        if (target && (target.dead || target.hp <= 0)) {
          s.kills++;
          if (target.monsterId) (s.slain ??= []).push(target.monsterId);
          if (this.bossIds.has(target.id)) this.bossKill = { heroId: actor.id, boss: target.name };
        }
      }
      if (target?.kind === "pc") {
        const s = this.statsOf(target.id);
        s.damageTaken += hit.amount;
        if (target.hp <= 0 && !this.downed.has(target.id)) {
          this.downed.add(target.id);
          s.downs++;
        }
        if (target.hp > 0) this.downed.delete(target.id);
      }
    }
  }

  /** The heroes with their numbers, for the look back. */
  recapHeroes(): RecapHero[] {
    return this.heroes().map((h) => ({
      id: h.id,
      name: h.name,
      color: h.appearance?.color ?? "#888",
      ...(h.appearance ? { look: h.appearance.look } : {}),
      classId: h.pc?.classId ?? "",
      level: h.pc?.level ?? 1,
      stats: { ...this.statsOf(h.id) },
    }));
  }

  /** The adventure is over: every phone gets its hero for the hero book. */
  saveHeroes(storyTitle: string, end: { won: boolean; difficulty: string; finalBlowHeroId?: string } = { won: true, difficulty: "normal" }): NonNullable<Recap["badges"]> {
    const earned: NonNullable<Recap["badges"]> = [];
    for (const h of this.heroes()) {
      if (!h.playerId || !h.pc || !h.appearance || h.dead) continue;
      // Badges: this adventure plus the running totals of the hero book.
      const stats = this.statsOf(h.id);
      const totals = addTotals(h.pc.totals, stats);
      const had = h.pc.badges ?? [];
      const fresh = newBadges(had, {
        stats,
        totals,
        won: end.won,
        difficulty: end.difficulty,
        stories: (h.pc.stories?.length ?? 0) + 1,
        level: h.pc.level,
        gold: h.pc.inventory.find((i) => i.itemId === "gold")?.qty ?? 0,
        goalMet: this.goalsMet.has(h.id) || (() => {
          const g = goalById(this.goals.get(h.id) ?? "");
          return !!g && goalReached(g, stats);
        })(),
        finalBlow: end.finalBlowHeroId === h.id,
        slain: stats.slain ?? [],
      });
      h.pc.badges = [...had, ...fresh.map((b) => b.id)];
      h.pc.totals = totals;
      for (const b of fresh) earned.push({ heroId: h.id, name: h.name, color: h.appearance.color, icon: b.icon, title: b.name, how: b.how });
      const gear = h.pc.gear ?? { owned: [] };
      // The figure as it looks without magic gear (the book puts the gear back on).
      const look = { ...h.appearance.look } as Record<string, string | undefined>;
      for (const [layer, v] of Object.entries(gear.lookBefore ?? {})) look[layer] = v;
      const clean = Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined)) as typeof h.appearance.look;
      const qty = (id: string) => h.pc!.inventory.find((i) => i.itemId === id)?.qty ?? 0;
      this.sendTo(h.playerId, {
        type: "hero_saved",
        hero: {
          profile: { name: h.name, classId: h.pc.classId, raceId: h.pc.raceId, look: clean, color: h.appearance.color, ...(h.appearance.gender ? { gender: h.appearance.gender } : {}) },
          legacy: {
            // Next adventure starts at level 1 again (gold, gear and potions stay).
            level: 1,
            xp: 0,
            ...(h.pc.improvements?.length ? { improvements: [...h.pc.improvements] } : {}),
            gold: qty("gold"),
            potions: qty("potion-of-healing"),
            ...(qty("verlobungsring") ? { rings: qty("verlobungsring") } : {}),
            gear: { owned: [...gear.owned], ...(gear.weapon ? { weapon: gear.weapon } : {}), ...(gear.armor ? { armor: gear.armor } : {}), ...(gear.trinket ? { trinket: gear.trinket } : {}) },
            stories: [...(h.pc.stories ?? []), storyTitle],
            badges: [...h.pc.badges],
            totals: { ...h.pc.totals },
            ...((pet) => (pet?.companion ? { companion: { kind: pet.companion.kind, name: pet.companion.name, trait: pet.companion.trait } } : {}))(this.companionOf(h)),
          },
          savedAt: Date.now(),
        },
      });
    }
    if (earned.length) this.narrate([{ text: "🏅 Neue Abzeichen fürs Heldenbuch:" }, ...earned.map((b) => ({ text: `${b.icon} ${b.name}: „${b.title}“ – ${b.how}` }))]);
    return earned;
  }

  /** Sends the look back to every phone (their own highlights). */
  sendRecap(recap: Recap): void {
    this.sendAll({ type: "recap", recap });
  }

  private interact(playerId: PlayerId, hero: Creature, objectId: string, targetId?: string, use?: string): void {
    const o = this.map.objects.find((x) => x.id === objectId);
    if (o && ["barrel", "lever", "chandelier", "secret", "campfire", "cauldron", "prop", "altar", "fountain"].includes(o.kind)) {
      this.useObject(playerId, hero, o, targetId, use);
      return;
    }
    if (!o || !hero.pos || Math.max(Math.abs(o.x - hero.pos.x), Math.abs(o.y - hero.pos.y)) > 1) {
      this.sendTo(playerId, { type: "action_error", reason: "Dafür musst du direkt daneben stehen." });
      return;
    }
    const lines: ExplainedLine[] = [];
    if (o.kind === "chest" && o.state !== "open") {
      this.itemUses++;
      this.bump(hero.id, "chests");
      o.state = "open";
      o.frame = "chest.open";
      const r = this.rng.next();
      const twist = this.envRng.next();
      const gearId = r < 0.3 ? this.randomGear(hero) : undefined;
      if (twist < 0.08) {
        // Surprise: this chest has teeth. It bites, hops off – and leaves what it swallowed.
        const d = this.hurtNoKnockout(hero, "1d6");
        const amount = rollDice(this.rng, parseDice("3d6")).total;
        this.addItem(hero, "gold", amount);
        lines.push(
          { text: `😱 Die Truhe hat Zähne! Sie schnappt nach ${hero.name} (${d} Schaden), hüpft zweimal quer durch den Raum …`, glossarKeys: ["truhe"] },
          { text: `… und spuckt beleidigt aus, was sie verschluckt hatte: ${amount} Goldmünzen.`, glossarKeys: ["gegenstand:gold"] },
        );
        this.emit("fx", "shake", { x: o.x, y: o.y });
      } else if (twist < 0.14) {
        const joke = ["einen einzelnen, sehr alten Socken", "einen Zettel: „Hier war Kobold Knorz. Ätsch!“", "eine Katze, die empört hinausspaziert", "ein Liebesgedicht an eine gewisse „Brunhilde vom Brocken“"][this.envRng.int(0, 3)]!;
        const amount = rollDice(this.rng, parseDice("1d4")).total;
        this.addItem(hero, "gold", amount);
        lines.push({ text: `🧰 ${hero.name} öffnet die Truhe – und findet ${joke}. Darunter: ${amount} Goldmünzen.`, glossarKeys: ["truhe", "gegenstand:gold"] });
      } else if (gearId) {
        lines.push({ text: `🧰 ${hero.name} öffnet die Truhe …`, glossarKeys: ["truhe"] });
        this.grantGear(hero, gearId, "In der Truhe");
      } else if (r < 0.65) {
        this.addItem(hero, "potion-of-healing", 1);
        lines.push({ text: `🧰 ${hero.name} öffnet die Truhe und findet einen Heiltrank!`, glossarKeys: ["truhe", "gegenstand:potion-of-healing"] });
      } else {
        const amount = rollDice(this.rng, parseDice("2d6")).total;
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

  private useObject(playerId: PlayerId, hero: Creature, o: MapObject, targetId?: string, use?: string): void {
    const far = !hero.pos || Math.max(Math.abs(o.x - hero.pos.x), Math.abs(o.y - hero.pos.y)) > this.objectRange(o);
    if (far) {
      this.sendTo(playerId, { type: "action_error", reason: o.kind === "chandelier" ? "Dafür musst du näher heran (5 Felder)." : "Dafür musst du direkt daneben stehen." });
      return;
    }
    const at = { x: o.x, y: o.y };
    const done = (r: RollOutcome, fx?: "puff" | "shake" | "sparkle" | "splash") => {
      this.bump(hero.id, "objects");
      if (fx) this.emit("fx", fx, at);
      this.emit("changed");
      return r;
    };
    const rollThen = (title: string, skill: SkillId, baseDc: number, glossarKey: string, then: (success: boolean, lines: ExplainedLine[], check: ReturnType<typeof skillCheck>) => RollOutcome) => {
      const dc = this.sg(baseDc);
      this.ask(playerId, hero, { title: `${title} (${nameOf("skills", skill)}, SG ${dc})`, sides: 20, glossarKey, need: rollNeed("SG", dc, sumParts(skillParts(hero, skill))) }, () => {
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
      case "prop":
      case "altar":
      case "fountain":
        this.useProp(playerId, hero, o, use ?? "", targetId, { rollThen, quick, done });
        return;
      case "barrel": {
        if (o.state === "used") return;
        if (this.mode !== "combat") {
          if (o.state === "found") return;
          o.state = "found";
          const r = this.rng.next();
          const lines: ExplainedLine[] = [];
          if (r < 0.4) {
            const gold = rollDice(this.rng, parseDice("1d4")).total;
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
          const gold = rollDice(this.rng, parseDice("1d8")).total;
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
            const gold = rollDice(this.rng, parseDice("1d10")).total;
            this.addItem(hero, "gold", gold);
            lines.push({ text: runes ? `✨ Die Zeichen leuchten auf – ein Stein gleitet zur Seite. Dahinter: ${gold} Goldmünzen!` : `✨ Die Platte lässt sich anheben. Darunter: ${gold} Goldmünzen!`, glossarKeys: ["gegenstand:gold"] });
            if (this.rng.next() < 0.4) {
              this.addItem(hero, "potion-of-healing", 1);
              lines.push({ text: "…und ein Heiltrank!", glossarKeys: ["gegenstand:potion-of-healing"] });
            }
            // Old hiding places sometimes keep a trinket.
            const trinket = this.rng.next() < 0.25 ? GEAR.filter((x) => x.slot === "trinket" && !this.heroes().some((h) => h.pc?.gear?.owned.includes(x.id)))[0] : undefined;
            if (trinket) queueMicrotask(() => this.grantGear(hero, trinket.id, "Im Versteck"));
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

  // ---------------------------------------------------------------- furniture, plants, places of power

  /** Boons for the next fight (prayer at an altar, a coin in the wishing well), by hero id. */
  private boons = new Map<string, "bless" | "luck">();
  /** The story adds a real clue when a hero finds something in a bookshelf. */
  onBookClue?: () => boolean;

  private hasFire(hero: Creature): boolean {
    return hasEffect(hero, "torch") || !!hero.pc?.inventory.some((i) => i.itemId === "torch" && i.qty > 0);
  }

  private spendBonus(hero: Creature): string | undefined {
    if (this.mode !== "combat") return undefined;
    const turn = this.battle.combat?.turn;
    if (!turn || turn.creatureId !== hero.id) return "Du bist nicht dran.";
    if (turn.bonusAction) {
      turn.bonusAction = false;
      return undefined;
    }
    if (turn.actions > 0) {
      turn.actions--;
      return undefined;
    }
    return "Du hast keine Aktion mehr übrig.";
  }

  /** Throw something (a mug, a stool, a spear from the rack): an improvised ranged attack. */
  private throwAt(hero: Creature, target: Creature, what: { name: string; dice: string; type: "bludgeoning" | "piercing"; rangeFt: number; proficient: boolean }): RollOutcome {
    const option: AttackOption = {
      id: `throw-${what.name}`,
      sourceId: "improvised",
      source: "weapon",
      kind: "ranged",
      toHit: [modPart(hero, "DEX"), ...(what.proficient ? [profPart(hero.proficiencyBonus)] : [])],
      damage: [{ dice: what.dice as never, type: what.type }],
      damageBonus: [modPart(hero, "DEX")],
      reachFt: 5,
      rangeFt: { normal: what.rangeFt },
    };
    const attack = resolveAttack(this.rng, this.battle, hero, target, option);
    const outcome: ActionOutcome = { ok: true, actorId: hero.id, cost: "action", kind: "attack", attack };
    const roll = this.outcomeToRoll(hero, `${what.name} werfen`, 20, outcome);
    if (roll.lines[0]) roll.lines[0] = { text: `${hero.name} wirft ${what.name} auf ${target.name}!`, glossarKeys: ["werfen", "angriffswurf"] };
    return roll;
  }

  private useProp(
    playerId: PlayerId,
    hero: Creature,
    o: MapObject,
    use: string,
    targetId: string | undefined,
    h: {
      rollThen: (title: string, skill: SkillId, baseDc: number, glossarKey: string, then: (success: boolean, lines: ExplainedLine[], check: ReturnType<typeof skillCheck>) => RollOutcome) => void;
      quick: (r: RollOutcome | { error: string }) => void;
      done: (r: RollOutcome, fx?: "puff" | "shake" | "sparkle" | "splash") => RollOutcome;
    },
  ): void {
    const fail = (reason: string) => this.sendTo(playerId, { type: "action_error", reason });
    const name = propDef(o)?.name ?? (o.kind === "altar" ? "Altar" : "Brunnen");
    const combat = this.mode === "combat";
    const key = `${o.id}:${hero.id}`;
    const target = targetId ? this.battle.creatures[targetId] : undefined;
    const say = (title: string, lines: ExplainedLine[], fx?: "puff" | "shake" | "sparkle" | "splash") => h.quick(h.done(this.objectRoll(hero, title, undefined, lines), fx));
    if (o.state === "used" && use !== "light") return fail(`${name}: Da ist nichts mehr zu machen.`);
    switch (use) {
      case "flip": {
        if (o.prop !== "table") return;
        const err = this.spendBonus(hero);
        if (err) return fail(err);
        o.prop = "table-flipped";
        o.frame = "table.flipped";
        say("Tisch umwerfen", [{ text: `💪 ${hero.name} wirft den Tisch um – Krüge scheppern! Dahinter ist jetzt volle Deckung (+5 RK gegen Fernangriffe).`, glossarKeys: ["deckung"] }], "puff");
        return;
      }
      case "throw": {
        const what =
          o.prop === "table" || o.prop === "table-flipped"
            ? { name: "einen Bierkrug", dice: "1d4", type: "bludgeoning" as const, rangeFt: 30, proficient: false }
            : o.prop === "stool"
              ? { name: "einen Hocker", dice: "1d6", type: "bludgeoning" as const, rangeFt: 20, proficient: false }
              : o.prop === "weapon-rack"
                ? { name: "einen Speer", dice: "1d6", type: "piercing" as const, rangeFt: 30, proficient: true }
                : undefined;
        if (!what || !combat) return;
        if (!target || !isActive(target) || !target.pos || !hero.pos || distanceFt(hero, target) > what.rangeFt * 2) return fail("Kein Ziel in Wurfweite.");
        const err = this.spendAction(hero);
        if (err) return fail(err);
        const roll = this.throwAt(hero, target, what);
        if (o.prop === "stool") {
          o.state = "used";
          o.frame = "";
          this.map.decals ??= {};
          this.map.decals[cellIndex(this.map, target.pos.x, target.pos.y)] = "debris";
        } else {
          o.uses = Math.max(0, (o.uses ?? 1) - 1);
          if (!o.uses && o.prop === "weapon-rack") o.state = "used";
        }
        this.bump(hero.id, "objects");
        h.quick(roll);
        return;
      }
      case "smash": {
        if (!propDef(o)?.smash) return;
        const err = this.spendAction(hero);
        if (err) return fail(err);
        o.state = "used";
        o.blocking = false;
        o.frame = o.prop === "pot" ? "pot.shards" : "debris";
        const r = this.rng.next();
        const lines: ExplainedLine[] = [{ text: `💥 ${hero.name} zerschlägt ${o.prop === "pot" ? "den Tonkrug" : "die Kiste"}. Splitter fliegen!`, glossarKeys: ["zerschlagen"] }];
        if (r < 0.3) {
          const gold = rollDice(this.rng, parseDice("1d4")).total + 1;
          this.addItem(hero, "gold", gold);
          lines.push({ text: `Darin: ${gold} Goldmünzen!`, glossarKeys: ["gegenstand:gold"] });
        } else if (r < 0.45) {
          this.addItem(hero, "potion-of-healing", 1);
          lines.push({ text: "Darin: ein Heiltrank, gut in Stroh gepackt!", glossarKeys: ["gegenstand:potion-of-healing"] });
        } else if (r < 0.55) {
          this.addItem(hero, "torch", 1);
          lines.push({ text: "Darin: eine Fackel.", glossarKeys: ["gegenstand:torch"] });
        } else if (r < 0.75) {
          const item = (["heilkraut", "oelflasche", "pilz", "knochen"] as const)[this.rng.int(0, 3)]!;
          this.addItem(hero, item, 1);
          lines.push({ text: `Darin: ${itemTitle(item)} – eine Zutat zum Brauen.`, glossarKeys: [`gegenstand:${item}`, "brauen"] });
        } else lines.push({ text: o.prop === "pot" ? "Nur alte Linsen. Und eine sehr empörte Maus." : "Nur Stroh und rostige Nägel.", glossarKeys: [] });
        say("Zerschlagen", lines, "puff");
        return;
      }
      case "search": {
        if (o.prop !== "bookshelf") return;
        if (this.triedObject.has(key)) return fail("Du hast dieses Regal schon durchstöbert.");
        h.rollThen("Im Regal stöbern", "investigation", 12, "buecherregal", (ok, lines, check) => {
          this.triedObject.add(key);
          if (ok) {
            const clue = !o.variant && this.onBookClue?.();
            if (clue) {
              o.variant = "clue";
              lines.push({ text: `📚 Zwischen zwei staubigen Bänden steckt ein Zettel – ${hero.name} findet einen Hinweis!`, glossarKeys: ["hinweis"] });
            } else {
              lines.push({ text: `📚 ${hero.name} liest: „${BOOK_LORE[this.rng.int(0, BOOK_LORE.length - 1)]}“`, glossarKeys: [] });
              if (this.rng.next() < 0.4) {
                const gold = rollDice(this.rng, parseDice("1d4")).total;
                this.addItem(hero, "gold", gold);
                lines.push({ text: `Ein Buch ist hohl: ${gold} Goldmünzen!`, glossarKeys: ["gegenstand:gold"] });
              }
            }
          } else lines.push({ text: "Nur Rechnungsbücher und ein Kochbuch für Rübensuppe.", glossarKeys: [] });
          return h.done(this.objectRoll(hero, "Bücherregal", check, lines), ok ? "sparkle" : undefined);
        });
        return;
      }
      case "herbs": {
        if (o.prop !== "herbs" || combat) return;
        if (this.triedObject.has(key)) return fail("Du hast hier schon gesucht.");
        h.rollThen("Kräuter sammeln", "medicine", 10, "kraeuter", (ok, lines, check) => {
          this.triedObject.add(key);
          const n = ok ? 2 : 1;
          if (ok) {
            o.state = "used";
            o.frame = "";
          }
          this.addItem(hero, "heilkraut", n);
          lines.push({ text: ok ? `🌿 ${hero.name} pflückt ${n} gute Heilkräuter. (Zwei ergeben im Taschen-Tab einen Heiltrank.)` : `🌿 Viel Unkraut dabei – nur ${n} brauchbares Heilkraut.`, glossarKeys: ["kraeuter", "brauen"] });
          return h.done(this.objectRoll(hero, "Heilkräuter", check, lines), ok ? "sparkle" : undefined);
        });
        return;
      }
      case "gather": {
        if (o.prop !== "mushrooms" && o.prop !== "mushrooms-glow" && o.prop !== "web") return;
        const err = this.spendAction(hero);
        if (err) return fail(err);
        const item = o.prop === "web" ? "spinnenseide" : o.prop === "mushrooms-glow" ? "leuchtpilz" : "pilz";
        const n = o.prop === "web" ? 1 : this.rng.int(1, 2);
        o.state = "used";
        o.frame = "";
        this.addItem(hero, item, n);
        say("Sammeln", [{ text: o.prop === "web" ? `🕸️ ${hero.name} wickelt vorsichtig Spinnenseide auf einen Stock.` : `🍄 ${hero.name} sammelt ${n} ${o.prop === "mushrooms-glow" ? "Leuchtpilz" : "Pilz"}${n > 1 ? "e" : ""} ein.`, glossarKeys: ["brauen", `gegenstand:${item}`] }], "sparkle");
        return;
      }
      case "eat": {
        if (o.prop !== "mushrooms" && o.prop !== "mushrooms-glow") return;
        if (this.triedObject.has(key)) return fail("Noch ein Pilz? Lieber nicht.");
        const err = this.spendAction(hero);
        if (err) return fail(err);
        this.triedObject.add(key);
        const lines: ExplainedLine[] = [{ text: `🍄 ${hero.name} beißt mutig in einen Pilz …`, glossarKeys: ["pilze"] }];
        const hits: { targetId: string; amount: number; heal?: boolean }[] = [];
        const roll = o.prop === "mushrooms-glow" ? 0 : this.rng.int(1, 5);
        if (roll === 0) {
          addEffect(hero, "torch", 600, "mushroom");
          lines.push({ text: `✨ ${hero.name} leuchtet grünlich von innen! Das Licht reicht 6 Meter weit – praktisch im Dunkeln.`, glossarKeys: ["dunkelheit"] });
        } else if (roll === 1) {
          const amount = rollDice(this.rng, parseDice("2d4")).total;
          const before = hero.hp;
          heal(hero, amount);
          hits.push({ targetId: hero.id, amount: hero.hp - before, heal: true });
          lines.push({ text: `Lecker! Ein Steinpilz. +${hero.hp - before} Trefferpunkte.`, glossarKeys: [] });
        } else if (roll === 2) {
          this.boons.set(hero.id, "luck");
          lines.push({ text: "💪 Ein Kribbeln in den Armen: Beim nächsten Kampf hat der erste Angriff Vorteil!", glossarKeys: ["vorteil"] });
        } else if (roll === 3) {
          const d = this.hurtNoKnockout(hero, "1d4");
          hits.push({ targetId: hero.id, amount: d });
          lines.push({ text: `🤢 Giftig! Bauchweh: ${d} Schaden.`, glossarKeys: [] });
        } else if (roll === 4) {
          lines.push({ text: `😂 ${hero.name} muss eine Minute lang ununterbrochen kichern. Sonst passiert nichts.`, glossarKeys: [] });
        } else {
          lines.push({ text: `🫧 ${hero.name} rülpst eine kleine Seifenblase. Die anderen sind beeindruckt.`, glossarKeys: [] });
        }
        h.quick({ ...h.done(this.objectRoll(hero, "Pilz", undefined, lines), roll === 0 ? "sparkle" : undefined), ...(hits.length ? { hits } : {}) });
        return;
      }
      case "light": {
        if (o.prop !== "candles" && o.prop !== "brazier") return;
        if (o.state === "used") return fail("Das Kohlebecken liegt umgekippt am Boden.");
        const out = o.variant === "out";
        if (out && !this.hasFire(hero) && !this.map.objects.some((x) => propLight(x) && Math.max(Math.abs(x.x - o.x), Math.abs(x.y - o.y)) <= 3)) {
          return fail("Du hast kein Feuer dabei (eine Fackel hilft).");
        }
        const err = this.spendBonus(hero);
        if (err) return fail(err);
        if (out) delete o.variant;
        else o.variant = "out";
        o.frame = o.prop === "candles" ? (out ? "candles" : "candles.out") : out ? "brazier.lit" : "brazier.out";
        say(out ? "Anzünden" : "Löschen", [{ text: out ? `🔥 ${hero.name} zündet ${o.prop === "candles" ? "die Kerzen" : "das Kohlebecken"} an. Es wird heller.` : `🌑 ${hero.name} löscht ${o.prop === "candles" ? "die Kerzen" : "das Kohlebecken"}. Im Dunkeln sieht man schlecht – wer nicht gesehen wird, greift mit Vorteil an!`, glossarKeys: ["licht_loeschen", "dunkelheit"] }], out ? "sparkle" : "puff");
        return;
      }
      case "tip": {
        if (o.prop !== "brazier" || !combat) return;
        const foe = target && isActive(target) && target.pos && Math.max(Math.abs(target.pos.x - o.x), Math.abs(target.pos.y - o.y)) <= 3 ? target : undefined;
        if (!foe) return fail("Kein Gegner nah genug am Kohlebecken (3 Felder).");
        h.rollThen("Kohlebecken umstoßen", "athletics", 10, "feuer", (ok, lines, check) => {
          if (!ok) {
            lines.push({ text: "Das Becken wackelt, bleibt aber stehen. Heiß!", glossarKeys: [] });
            return h.done(this.objectRoll(hero, "Kohlebecken", check, lines));
          }
          const r = spillCoals(this.map, this.envRng, o, foe.pos!);
          lines.push(...r.lines);
          const hits: { targetId: string; amount: number }[] = [];
          for (const c of Object.values(this.battle.creatures)) {
            if (!c.pos || !isActive(c) || surfaceKind(this.map, c.pos) !== "fire") continue;
            const b = burnCreature(this.envRng, c);
            lines.push(...b.lines);
            hits.push(...b.hits);
          }
          return { ...h.done(this.objectRoll(hero, "Kohlebecken", check, lines), "shake"), ...(hits.length ? { hits } : {}) };
        });
        return;
      }
      case "ignite": {
        if (!propDef(o)?.flammable) return;
        if (!this.hasFire(hero)) return fail("Dafür brauchst du eine Fackel.");
        const err = this.spendAction(hero);
        if (err) return fail(err);
        const r = setAlight(this.map, o);
        say("Anzünden", [{ text: `🔥 ${hero.name} hält die Fackel an ${name === "Heuballen" ? "den Heuballen" : `„${name}“`}.`, glossarKeys: ["feuer"] }, ...r.lines]);
        return;
      }
      case "wish": {
        if (combat) return;
        if (this.triedObject.has(key)) return fail("Jeder darf sich nur einmal etwas wünschen.");
        if (!this.spendGoldOf(hero, WISH_GOLD)) return fail(`Du brauchst ${WISH_GOLD} Goldmünzen.`);
        this.triedObject.add(key);
        this.boons.set(hero.id, "luck");
        say("Wunschbrunnen", [{ text: `🪙 ${hero.name} wirft ${WISH_GOLD} Goldmünzen in den Brunnen und wünscht sich etwas. Es plätschert zufrieden – beim nächsten Kampf hat der erste Angriff Vorteil!`, glossarKeys: ["wunschbrunnen", "vorteil"] }], "sparkle");
        return;
      }
      case "pray": {
        if (combat) return;
        if (this.triedObject.has(key)) return fail("Du hast hier schon gebetet.");
        h.rollThen("Beten", "religion", 10, "altar", (ok, lines, check) => {
          this.triedObject.add(key);
          if (ok) {
            this.boons.set(hero.id, "bless");
            lines.push({ text: `🙏 Ein warmes Licht umhüllt ${hero.name}: Im nächsten Kampf ist ${hero.name} gesegnet (+1W4 auf Angriffe und Rettungswürfe).`, glossarKeys: ["altar", "zauber:bless"] });
          } else lines.push({ text: "Die Götter schweigen heute. Vielleicht später?", glossarKeys: [] });
          return h.done(this.objectRoll(hero, "Altar", check, lines), ok ? "sparkle" : undefined);
        });
        return;
      }
      case "open": {
        if (o.prop !== "coffin" || combat) return;
        if (this.triedObject.has(key)) return fail("Der Deckel ist dir zu schwer. Vielleicht schafft es jemand anderes?");
        h.rollThen("Sargdeckel aufschieben", "athletics", 12, "sarg", (ok, lines, check) => {
          this.triedObject.add(key);
          if (!ok) {
            lines.push({ text: "Der steinerne Deckel rührt sich nicht.", glossarKeys: [] });
            return h.done(this.objectRoll(hero, "Sarg", check, lines));
          }
          o.state = "used";
          o.frame = "coffin.open";
          lines.push({ text: `⚰️ Knirschend gleitet der Deckel zur Seite …`, glossarKeys: [] });
          const r = this.rng.next();
          const gear = r < 0.15 ? this.randomGear(hero) : undefined;
          if (gear) queueMicrotask(() => this.grantGear(hero, gear, "Im Sarg"));
          else if (r < 0.6) {
            const gold = rollDice(this.rng, parseDice("1d6")).total;
            this.addItem(hero, "gold", gold);
            lines.push({ text: `Grabbeigaben: ${gold} Goldmünzen.`, glossarKeys: ["gegenstand:gold"] });
          } else lines.push({ text: "Nur Staub und ein grinsender Schädel. Er grinst zurück. Oder?", glossarKeys: [] });
          return h.done(this.objectRoll(hero, "Sarg", check, lines), "puff");
        });
        return;
      }
    }
  }

  // ---------------------------------------------------------------- brewing, ingredients, tools

  private craftFor(hero: Creature, recipeId: string): string | undefined {
    const recipe = recipeById(recipeId);
    const inv = hero.pc?.inventory;
    if (!recipe || !inv) return "Dieses Rezept gibt es nicht.";
    if (hero.dead) return "Dafür ist es zu spät.";
    if (!craft(recipe, inv)) return "Dir fehlen noch Zutaten.";
    const lines: ExplainedLine[] = [{ text: `⚗️ ${hero.name} stellt her: ${recipe.icon} ${recipe.name}.`, glossarKeys: ["brauen", `gegenstand:${recipe.gives.itemId}`] }];
    this.addLog(lines);
    this.emit("lines", lines);
    const who = { heroId: hero.id, name: hero.name, ...(hero.appearance ? { color: hero.appearance.color } : {}) };
    this.reward(hero, { kind: "item", ...who, itemId: recipe.gives.itemId, title: itemTitle(recipe.gives.itemId), icon: recipe.icon, qty: recipe.gives.qty });
    this.bump(hero.id, "objects");
    this.broadcast();
    return undefined;
  }

  private takeItem(hero: Creature, itemId: string): boolean {
    const entry = hero.pc?.inventory.find((i) => i.itemId === itemId && i.qty > 0);
    if (!entry) return false;
    entry.qty--;
    if (!entry.qty) hero.pc!.inventory = hero.pc!.inventory.filter((i) => i !== entry);
    return true;
  }

  private pickUpGround(playerId: PlayerId, hero: Creature, use: "oil" | "bones", at: GridPos): void {
    const fail = (reason: string) => this.sendTo(playerId, { type: "action_error", reason });
    if (!hero.pos || Math.max(Math.abs(at.x - hero.pos.x), Math.abs(at.y - hero.pos.y)) > 1) return fail("Dafür musst du direkt daneben stehen.");
    const i = cellIndex(this.map, at.x, at.y);
    if (use === "oil" ? this.map.surface?.[i]?.kind !== "oil" : this.map.decals?.[i] !== "bones") return fail("Da ist nichts mehr.");
    const err = this.spendAction(hero);
    if (err) return fail(err);
    if (use === "oil") delete this.map.surface![i];
    else delete this.map.decals![i];
    this.addItem(hero, use === "oil" ? "oelflasche" : "knochen", 1);
    const lines: ExplainedLine[] = [{ text: use === "oil" ? `🫙 ${hero.name} füllt das Öl vom Boden in eine Flasche.` : `🦴 ${hero.name} hebt einen Knochen auf. Irgendein Hund wird sich freuen …`, glossarKeys: [`gegenstand:${use === "oil" ? "oelflasche" : "knochen"}`] }];
    this.bump(hero.id, "objects");
    this.publishRoll(this.objectRoll(hero, "Aufheben", undefined, lines));
    this.addLog(lines);
    this.afterAction();
  }

  /** Brewed potions and tinkered tools. */
  private useCustomItem(playerId: PlayerId, hero: Creature, itemId: string, targetId?: string): void {
    const fail = (reason: string) => this.sendTo(playerId, { type: "action_error", reason });
    if (!hero.pc?.inventory.some((i) => i.itemId === itemId && i.qty > 0)) return fail("Das hast du nicht mehr.");
    const target = targetId ? this.battle.creatures[targetId] : undefined;
    const lines: ExplainedLine[] = [];
    let hits: { targetId: string; amount: number }[] = [];
    let title = itemTitle(itemId);
    switch (itemId) {
      case "leuchttrank": {
        const err = this.spendBonus(hero);
        if (err) return fail(err);
        this.takeItem(hero, itemId);
        addEffect(hero, "torch", 600, "leuchttrank");
        lines.push({ text: `✨ ${hero.name} trinkt den Leuchttrank und leuchtet grünlich – so hell wie eine Fackel.`, glossarKeys: ["gegenstand:leuchttrank", "dunkelheit"] });
        break;
      }
      case "staerketrank": {
        const err = this.spendBonus(hero);
        if (err) return fail(err);
        this.takeItem(hero, itemId);
        addEffect(hero, "helped", 100, "staerketrank");
        lines.push({ text: `🐻 ${hero.name} trinkt den Bärenkraft-Trank. Die Muskeln spannen sich – der nächste Angriff hat Vorteil!`, glossarKeys: ["gegenstand:staerketrank", "vorteil"] });
        break;
      }
      case "stolperdraht": {
        if (!hero.pos) return;
        const here = hero.pos;
        if (this.map.objects.some((o) => o.x === here.x && o.y === here.y && (o.kind === "trap" || o.blocking))) return fail("Hier liegt schon etwas.");
        const err = this.spendAction(hero);
        if (err) return fail(err);
        this.takeItem(hero, itemId);
        this.map.objects.push({ id: `wire${++this.rollCounter}`, kind: "trap", variant: "wire", x: here.x, y: here.y, frame: "trap.net", blocking: false, state: "found" });
        lines.push({ text: `🪢 ${hero.name} spannt einen Stolperdraht über den Boden. Wer da drüberläuft, fällt vielleicht hin!`, glossarKeys: ["gegenstand:stolperdraht", "hinterhalt"] });
        break;
      }
      case "oelflasche": {
        const spot = target?.pos && hero.pos && Math.max(Math.abs(target.pos.x - hero.pos.x), Math.abs(target.pos.y - hero.pos.y)) <= 4 ? target.pos : hero.pos;
        if (!spot) return;
        const err = this.spendAction(hero);
        if (err) return fail(err);
        this.takeItem(hero, itemId);
        this.map.surface ??= {};
        for (const p of [spot, { x: spot.x + 1, y: spot.y }, { x: spot.x, y: spot.y + 1 }]) {
          if (this.map.cells[cellIndex(this.map, p.x, p.y)] === "floor" && !this.map.surface[cellIndex(this.map, p.x, p.y)]) this.map.surface[cellIndex(this.map, p.x, p.y)] = { kind: "oil" };
        }
        lines.push({ text: target && spot === target.pos ? `🫙 ${hero.name} schleudert die Ölflasche vor ${target.name}. Glitschig – und sehr brennbar!` : `🫙 ${hero.name} gießt Öl auf den Boden. Ein Funke genügt …`, glossarKeys: ["gegenstand:oelflasche", "feuer"] });
        break;
      }
      case "brandflasche": {
        if (!target || !isActive(target) || !target.pos || !hero.pos || distanceFt(hero, target) > 30) return fail("Kein Ziel in Wurfweite (6 Felder).");
        const err = this.spendAction(hero);
        if (err) return fail(err);
        this.takeItem(hero, itemId);
        title = "Brandflasche";
        const save = savingThrow(this.rng, target, "DEX", this.sg(12));
        const dice = rollDice(this.rng, parseDice("2d6"));
        const dmg = save.success ? Math.floor(dice.total / 2) : dice.total;
        lines.push({ text: `🔥 ${hero.name} wirft eine Brandflasche auf ${target.name}!`, glossarKeys: ["gegenstand:brandflasche"] });
        lines.push(...explainCheck(this.battle, target.id, save));
        lines.push(...explainHp(this.battle, applyDamage(this.rng, target, dmg)));
        lines.push({ text: `💥 ${dice.dice.join(" + ")} = ${dice.total} Feuerschaden${save.success ? `, halbiert → ${dmg}` : ""}.`, glossarKeys: ["schadensart:fire"] });
        hits = [{ targetId: target.id, amount: dmg }];
        this.map.surface ??= {};
        const i = cellIndex(this.map, target.pos.x, target.pos.y);
        if (this.map.surface[i]?.kind !== "puddle") this.map.surface[i] = { kind: "fire", turns: 2 };
        lines.push(...fireHits(this.map, this.envRng, [target.pos]).lines);
        leaveTrace(this.map, this.envRng, target, dmg);
        break;
      }
      default:
        return;
    }
    this.addLog(lines);
    this.publishRoll({ ...this.objectRoll(hero, title, undefined, lines), ...(hits.length ? { hits, fx: [{ from: hero.id, to: hits.map((x) => x.targetId), kind: "spell", element: "fire" }] } : {}) });
    this.emit("changed");
    this.checkWinner();
    this.afterAction();
  }

  /** Items for brewing and tinkering on the phone's action list. */
  private customItemChoices(me: Creature, enemies: Creature[], mine: boolean, costReason: (cost: "action" | "bonus") => string | undefined): ActionChoice[] {
    const out: ActionChoice[] = [];
    const inv = me.pc?.inventory ?? [];
    const qty = (id: string) => inv.find((i) => i.itemId === id)?.qty ?? 0;
    const combat = this.mode === "combat";
    const notMine = mine ? undefined : "Warte, bis du dran bist.";
    const bonus = combat && this.turnFor(me)?.bonusAction ? "bonus" : combat ? "action" : "free";
    const add = (itemId: string, label: string, detail: string, cost: "action" | "bonus" | "free", extra: Partial<ActionChoice> = {}) => {
      const reason = extra.reason ?? (cost === "free" ? notMine : costReason(cost));
      out.push({ id: `item:${itemId}`, group: "item", label: `${itemIcon(itemId)} ${label} (${qty(itemId)})`, detail, glossarKey: `gegenstand:${itemId}`, cost, enabled: !reason, ...(reason ? { reason } : {}), ...extra, action: { kind: "use_item", itemId } });
    };
    const inReach = (ft: number) => enemies.filter((e) => e.pos && me.pos && distanceFt(me, e) <= ft);
    const targetsOf = (list: Creature[]) => ({ targets: list.map((t) => ({ id: t.id, name: t.name, detail: `TP ${t.hp}/${t.maxHp}` })), pick: { min: 1, max: 1, repeat: false } });
    if (qty("leuchttrank")) add("leuchttrank", "Leuchttrank trinken", "Du leuchtest wie eine Fackel", bonus);
    if (qty("staerketrank")) add("staerketrank", "Bärenkraft-Trank trinken", "Dein nächster Angriff hat Vorteil", bonus);
    if (qty("stolperdraht")) add("stolperdraht", "Stolperdraht hier spannen", "Gegner, die darüberlaufen, fallen vielleicht hin", combat ? "action" : "free");
    if (qty("brandflasche")) {
      const t = inReach(30);
      add("brandflasche", "Brandflasche werfen", "Rettungswurf GE 12 · 2W6 Feuer, der Boden brennt · bis 6 Felder", "action", { ...(t.length ? {} : { reason: costReason("action") ?? "Kein Gegner in Wurfweite." }), ...targetsOf(t) });
    }
    if (qty("oelflasche")) {
      const t = inReach(20);
      add("oelflasche", t.length ? "Öl vor Gegner schleudern" : "Öl hier ausgießen", t.length ? "Macht eine Öllache am Gegner (bis 4 Felder) – dann Feuer dran!" : "Eine Öllache neben dir – für einen Hinterhalt", combat ? "action" : "free", t.length ? targetsOf(t) : {});
    }
    return out;
  }

  // ---------------------------------------------------------------- companions

  private mourned = new Set<string>();

  companionOf(hero: Creature): Creature | undefined {
    return Object.values(this.battle.creatures).find((c) => c.companion?.ownerId === hero.id && !c.dead);
  }

  /** New map: companions walk in beside their heroes, show their gifts, and strays may be around. */
  private arriveWithCompanions(): void {
    const lines: ExplainedLine[] = [];
    for (const kid of Object.values(this.battle.creatures)) {
      const owner = kid.squire ? this.battle.creatures[kid.squire.ownerId] : undefined;
      if (!owner?.pos || kid.dead) continue;
      kid.pos = besideFree(this.map, this.battle, owner.pos);
      kid.effects = [];
      kid.conditions = [];
    }
    for (const pet of Object.values(this.battle.creatures)) {
      const info = pet.companion;
      const owner = info ? this.battle.creatures[info.ownerId] : undefined;
      if (!info || pet.dead || !owner?.pos) continue;
      pet.pos = besideFree(this.map, this.battle, owner.pos);
      pet.effects = [];
      pet.conditions = [];
      if (info.trait === "maeusejaeger") {
        const gold = rollDice(this.envRng, parseDice("1d4")).total;
        this.addItem(owner, "gold", gold);
        lines.push({ text: `🐈 ${pet.name} legt ${owner.name} stolz ${gold} Münzen vor die Füße.`, glossarKeys: ["begleiter"] });
      } else if (info.trait === "elster") {
        const item = (["heilkraut", "pilz", "spinnenseide", "knochen", "oelflasche"] as const)[this.envRng.int(0, 4)]!;
        this.addItem(owner, item, 1);
        lines.push({ text: `🐦‍⬛ ${pet.name} bringt ${owner.name} etwas mit: ${itemTitle(item)}.`, glossarKeys: ["begleiter", `gegenstand:${item}`] });
      } else if (info.trait === "spaeher") {
        const hidden = this.map.rooms.map((_, i) => i).filter((i) => i > 0 && !this.map.explored[cellIndex(this.map, Math.floor(this.map.rooms[i]!.x + this.map.rooms[i]!.w / 2), Math.floor(this.map.rooms[i]!.y + this.map.rooms[i]!.h / 2))]);
        const room = hidden[this.envRng.int(0, Math.max(0, hidden.length - 1))];
        if (room !== undefined && hidden.length) {
          const r = this.map.rooms[room]!;
          for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.map.roomOf[cellIndex(this.map, x, y)] === room) this.map.explored[cellIndex(this.map, x, y)] = true;
          lines.push({ text: `🐦‍⬛ ${pet.name} fliegt voraus und kreist über: ${r.name}.`, glossarKeys: ["begleiter"] });
        }
      }
    }
    // The kennel keeps companions healthy.
    if (this.village.includes("zwinger")) for (const pet of Object.values(this.battle.creatures)) if (pet.companion && !pet.dead) pet.hp = pet.maxHp;
    // A stray animal – only if somebody still has no companion.
    if (this.heroes().some((h) => !h.dead && !this.companionOf(h))) {
      const free = (p: GridPos) => isWalkable(this.map, p) && !Object.values(this.battle.creatures).some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y);
      const heroSpots = this.heroes().flatMap((h) => (h.pos ? [h.pos] : []));
      // The village kennel sends a dog along (first map), a travel event may promise an animal.
      const promised: import("../shared/companions").CompanionKind | undefined = this.pendingStray ?? (this.village.includes("zwinger") && !this.kennelDone ? "dog" : undefined);
      const lead = heroSpots[0];
      const stray = promised && lead ? { kind: promised, pos: besideFree(this.map, this.battle, { x: lead.x + 2, y: lead.y }) } : placeStray(this.map, this.envRng, free, heroSpots);
      if (promised) {
        this.pendingStray = undefined;
        this.kennelDone = true;
      }
      if (stray) {
        const def = COMPANIONS[stray.kind];
        const c = createMonster(def.monster, `wild-${++this.rollCounter}`, { name: `streunende${stray.kind === "dog" || stray.kind === "raven" || stray.kind === "wolf" ? "r" : ""} ${def.name}`, side: "neutral" });
        c.wild = stray.kind;
        c.pos = stray.pos;
        this.battle.creatures[c.id] = c;
      }
    }
    if (lines.length) this.addLog(lines);
  }

  /** In exploration companions trot after their hero. */
  private companionsFollow(hero: Creature): void {
    const followers = Object.values(this.battle.creatures).filter((c) => c.followId === hero.id && c.side === "neutral" && !c.dead);
    for (const pet of [this.companionOf(hero), this.squireOf(hero), ...followers]) {
      if (!pet?.pos || !hero.pos || !isActive(pet)) continue;
      if (Math.max(Math.abs(pet.pos.x - hero.pos.x), Math.abs(pet.pos.y - hero.pos.y)) <= 1) continue;
      pet.pos = besideFree(this.map, this.battle, hero.pos);
    }
  }

  /** A hero's teenage child along as squire. */
  squireOf(hero: Creature): Creature | undefined {
    return Object.values(this.battle.creatures).find((c) => c.squire?.ownerId === hero.id && !c.dead);
  }

  /** The squires of this adventure and whether they had to go home wounded (for the family's memory). */
  squireReport(): { hero: string; child: string; hurt: boolean }[] {
    return Object.values(this.battle.creatures).flatMap((c) => {
      const owner = c.squire ? this.battle.creatures[c.squire.ownerId] : undefined;
      return owner ? [{ hero: owner.name, child: c.name, hurt: c.dead }] : [];
    });
  }

  /** Taming a stray: the lure is used up (a dog eats the bone either way), Animal Handling decides. */
  private tame(playerId: PlayerId, hero: Creature, creatureId: string): void {
    const fail = (reason: string) => this.sendTo(playerId, { type: "action_error", reason });
    const animal = this.battle.creatures[creatureId];
    if (!animal?.wild || animal.dead || !animal.pos || !hero.pos) return fail("Das Tier ist weg.");
    if (Math.max(Math.abs(animal.pos.x - hero.pos.x), Math.abs(animal.pos.y - hero.pos.y)) > 1) return fail("Geh erst ganz nah heran.");
    if (this.companionOf(hero)) return fail("Du hast schon einen Begleiter.");
    if (this.mode === "combat") return fail("Mitten im Kampf lässt sich kein Tier zähmen.");
    const def = COMPANIONS[animal.wild];
    const hasLure = def.lure.itemId ? hero.pc?.inventory.some((i) => i.itemId === def.lure.itemId && i.qty > 0) : this.goldOf(hero) >= (def.lure.gold ?? 0);
    if (!hasLure) return fail(`Dafür brauchst du: ${def.lure.label}.`);
    const dc = this.sg(def.dc);
    this.ask(playerId, hero, { title: `${def.name} zähmen (Mit Tieren umgehen, SG ${dc})`, sides: 20, glossarKey: "begleiter", need: rollNeed("SG", dc, sumParts(skillParts(hero, "animal-handling"))) }, () => {
      if (def.lure.itemId) this.takeItem(hero, def.lure.itemId);
      else this.spendGoldOf(hero, def.lure.gold ?? 0);
      const check = skillCheck(this.rng, hero, "animal-handling", dc);
      const lines = explainCheck(this.battle, hero.id, check);
      if (!check.success) {
        lines.push({ text: `${def.icon} Der ${def.name === "Katze" ? "Katze schnappt sich das Kraut" : `${def.name} schnappt sich ${def.lure.label}`} – und hält trotzdem Abstand. Vielleicht beim nächsten Mal?`, glossarKeys: ["begleiter"] });
        return this.objectRoll(hero, "Zähmen", check, lines);
      }
      const taken = Object.values(this.battle.creatures).flatMap((c) => (c.companion ? [c.companion.name] : []));
      const info = newCompanion(animal.wild!, taken, (n) => this.envRng.int(0, n - 1));
      const pet = makeCompanion(info, hero, `pet-${hero.id}-${++this.rollCounter}`);
      pet.pos = animal.pos;
      delete this.battle.creatures[animal.id];
      this.battle.creatures[pet.id] = pet;
      const trait = traitOf(info)!;
      lines.push({ text: `${def.icon} ${def.name === "Katze" ? "Die Katze" : `Der ${def.name}`} schmiegt sich an ${hero.name}. Ab jetzt heißt ${def.name === "Katze" ? "sie" : "er"} ${info.name}!`, glossarKeys: ["begleiter"] });
      lines.push({ text: `✨ Gabe: ${trait.name} – ${trait.text}`, glossarKeys: ["begleiter"] });
      this.banner({ icon: def.icon, title: `${info.name} gehört jetzt zu ${hero.name}!`, text: `${trait.name}: ${trait.text}` });
      setTimeout(() => this.banner(undefined), 6000);
      this.emit("fx", "sparkle", pet.pos);
      return this.objectRoll(hero, "Zähmen", check, lines);
    });
  }

  /** Companion gifts that act when a fight starts. */
  private companionsAtFightStart(): void {
    const lines: ExplainedLine[] = [];
    for (const pet of Object.values(this.battle.creatures)) {
      if (!pet.companion || pet.dead || !pet.pos) continue;
      const owner = this.battle.creatures[pet.companion.ownerId];
      if (pet.companion.trait === "glueckskatze" && owner && !owner.dead) {
        addEffect(owner, "helped", 10, pet.id);
        lines.push({ text: `🍀 ${pet.name} streicht ${owner.name} um die Beine – Glück für den ersten Angriff!`, glossarKeys: ["begleiter", "vorteil"] });
      }
      if (pet.companion.trait === "heuler") {
        const near = Object.values(this.battle.creatures).filter((c) => c.side === "enemy" && isActive(c) && c.pos && distanceFt(pet, c) <= 30);
        for (const e of near) addEffect(e, "distracted", 10, pet.id);
        if (near.length) lines.push({ text: `🐺 ${pet.name} heult markerschütternd! Die Gegner zucken zusammen – der nächste Angriff auf sie hat Vorteil.`, glossarKeys: ["begleiter", "abgelenkt"] });
      }
    }
    if (lines.length) this.addLog(lines);
  }

  /** A fallen companion is mourned once (and gone for good). */
  private mournCompanions(): void {
    for (const kid of Object.values(this.battle.creatures)) {
      if (!kid.squire || !kid.dead || this.mourned.has(kid.id)) continue;
      this.mourned.add(kid.id);
      const owner = this.battle.creatures[kid.squire.ownerId];
      // Children never die here: a wounded squire is carried home and gets well again.
      const lines: ExplainedLine[] = [{ text: `🩹 ${kid.name} ist verwundet – ein Bauer bringt ${kid.name} nach Hause${owner ? ` zu ${owner.name}s Familie` : ""}. Es wird wieder gesund.`, glossarKeys: ["familie"] }];
      this.addLog(lines);
      this.emit("lines", lines);
    }
    for (const pet of Object.values(this.battle.creatures)) {
      if (!pet.companion || !pet.dead || this.mourned.has(pet.id)) continue;
      this.mourned.add(pet.id);
      const owner = this.battle.creatures[pet.companion.ownerId];
      const def = COMPANIONS[pet.companion.kind];
      const lines: ExplainedLine[] = [{ text: `💔 ${pet.name} ist gefallen. ${owner ? `${owner.name} wird ${def.name === "Katze" ? "sie" : "ihn"} nie vergessen.` : ""}`, glossarKeys: ["begleiter"] }];
      this.addLog(lines);
      this.emit("lines", lines);
      this.banner({ icon: "💔", title: `${pet.name} ist gefallen`, text: `${def.icon} Ein treuer Begleiter bis zuletzt.` });
      setTimeout(() => this.banner(undefined), 6000);
    }
  }

  // ---------------------------------------------------------------- monsters and the room

  /** Buildings of the home village (set by the board, src/shared/homeland.ts). */
  village: string[] = [];
  /** The temple's blessing is used once per adventure. */
  private templeUsed = false;
  /** The kennel's dog waits only at the adventure's first map. */
  private kennelDone = false;
  /** A travel event promised a stray animal at the next map. */
  pendingStray: import("../shared/companions").CompanionKind | undefined;

  /** Temple: the first hero who goes down this adventure gets straight back up. */
  private templeBlessing(): void {
    if (this.templeUsed || !this.village.includes("tempel")) return;
    const down = this.heroes().find((h) => h.hp === 0 && !h.dead);
    if (!down) return;
    this.templeUsed = true;
    const amount = rollDice(this.envRng, parseDice("1d8")).total + 2;
    heal(down, amount);
    const lines: ExplainedLine[] = [{ text: `⛪ Die Gebete aus eurem Heimatdorf wirken: ${down.name} steht wieder auf (+${amount} Trefferpunkte)!`, glossarKeys: ["heimatdorf"] }];
    this.addLog(lines);
    this.publishRoll({ ...this.objectRoll(down, "Tempelsegen", undefined, lines), hits: [{ targetId: down.id, amount, heal: true }] });
  }

  /** The boss fight's arena (it changes as the boss weakens). */
  private arena: ArenaState | undefined;

  private startArena(): void {
    const boss = [...this.bossIds].map((id) => this.battle.creatures[id]).find((c) => c && !c.dead);
    this.arena = boss ? arenaFor(boss) : undefined;
  }

  private arenaTick(): void {
    if (!this.arena || this.mode !== "combat") return;
    const r = arenaRound(this.arena, this.map, this.battle, this.envRng, this.sg(12));
    if (r.banner) {
      this.banner(r.banner);
      setTimeout(() => this.banner(undefined), 7000);
      this.emit("fx", "shake", undefined);
    }
    this.syncWorld();
    const boss = this.battle.creatures[this.arena.bossId];
    if (r.lines.length && boss) this.publishWorld(boss, "Die Arena", r);
    else this.emit("changed");
  }

  /** Tricks each monster already used this fight (so they don't repeat every turn). */
  private tricksUsed = new Set<string>();

  /**
   * A monster uses the furniture. Returns true if that took its action
   * (flipping a table is quick and does not).
   */
  private monsterTrick(m: Creature): boolean {
    if (!m.pos || !isActive(m) || m.side !== "enemy" || this.envRng.next() > 0.5) return false;
    const heroes = Object.values(this.battle.creatures).filter((c) => c.side === "party" && isActive(c) && c.pos);
    if (!heroes.length) return false;
    const near = (a: GridPos, b: GridPos, d: number) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= d;
    const props = this.map.objects.filter((o) => o.kind === "prop" && o.state !== "used");
    const smart = m.abilities.INT >= 5;
    const publish = (title: string, lines: ExplainedLine[], hits: { targetId: string; amount: number }[] = [], fx?: "puff" | "shake" | "sparkle" | "splash", at?: GridPos) => {
      this.addLog(lines);
      this.publishRoll({ ...this.objectRoll(m, title, undefined, lines), ...(hits.length ? { hits } : {}) });
      if (fx) this.emit("fx", fx, at);
    };
    const once = (what: string) => {
      const k = `${m.id}:${what}`;
      if (this.tricksUsed.has(k)) return false;
      this.tricksUsed.add(k);
      return true;
    };

    // 1. Duck behind a table when the heroes shoot from afar (free).
    const shooters = heroes.filter((h) => h.attacks.some((a) => a.kind === "ranged" || a.thrown) || (h.pc?.spells.length ?? 0) > 0);
    const table = props.find((o) => o.prop === "table" && near(o, m.pos!, 1));
    if (smart && m.creatureType === "humanoid" && table && shooters.some((h) => !near(h.pos!, m.pos!, 1)) && once("flip")) {
      table.prop = "table-flipped";
      table.frame = "table.flipped";
      this.syncWorld();
      publish("Tisch umgeworfen", [{ text: `🪑 ${m.name} tritt den Tisch um und duckt sich dahinter – volle Deckung gegen Fernangriffe!`, glossarKeys: ["deckung", "tisch"] }], [], "puff", table);
      return false;
    }

    // 2. Tip a burning brazier towards the heroes.
    const brazier = props.find((o) => o.prop === "brazier" && o.variant !== "out" && near(o, m.pos!, 1));
    const victim = brazier && heroes.find((h) => near(h.pos!, brazier, 3));
    if (smart && brazier && victim && once("brazier")) {
      const r = spillCoals(this.map, this.envRng, brazier, victim.pos!);
      const lines: ExplainedLine[] = [{ text: `🔥 ${m.name} stößt das Kohlebecken um!`, glossarKeys: ["feuer"] }, ...r.lines];
      const hits: { targetId: string; amount: number }[] = [];
      for (const c of Object.values(this.battle.creatures)) {
        if (!c.pos || !isActive(c) || surfaceKind(this.map, c.pos) !== "fire") continue;
        const b = burnCreature(this.envRng, c);
        lines.push(...b.lines);
        hits.push(...b.hits);
      }
      this.syncWorld();
      publish("Kohlebecken", lines, hits, "shake", brazier);
      return true;
    }

    // 3. Throw a torch into oil, hay or webs next to a hero.
    const firebugs = ["kobold", "goblin", "cultist", "cult-fanatic", "bandit", "bandit-captain", "thug"];
    if (m.monsterId && firebugs.includes(m.monsterId) && this.envRng.next() < 0.6) {
      const fuel = (p: GridPos) => surfaceKind(this.map, p) === "oil" || props.some((o) => o.x === p.x && o.y === p.y && propDef(o)?.flammable && ["hay", "web", "bush", "thorns"].includes(o.prop ?? ""));
      const spot = heroes
        .flatMap((h) => [...Array(9).keys()].map((k) => ({ x: h.pos!.x + (k % 3) - 1, y: h.pos!.y + Math.floor(k / 3) - 1 })))
        .find((p) => fuel(p) && near(p, m.pos!, 6) && !Object.values(this.battle.creatures).some((c) => c.side === "enemy" && c.pos && near(c.pos, p, 1)));
      if (spot && once("torch")) {
        const r = fireHits(this.map, this.envRng, [spot]);
        const lines: ExplainedLine[] = [{ text: `🔥 ${m.name} schleudert eine brennende Fackel!`, glossarKeys: ["feuer"] }, ...r.lines];
        const hits: { targetId: string; amount: number }[] = [];
        for (const c of creaturesOn(this.battle, [spot])) {
          if (surfaceKind(this.map, c.pos) !== "fire" || !isActive(c)) continue;
          const b = burnCreature(this.envRng, c);
          lines.push(...b.lines);
          hits.push(...b.hits);
        }
        this.syncWorld();
        publish("Brennende Fackel", lines, hits, "puff", spot);
        return true;
      }
    }

    // 3b. Cunning ones splash oil at the heroes' feet (a burning torch may follow).
    if (smart && m.monsterId && firebugs.includes(m.monsterId) && this.envRng.next() < 0.2 && once("oil")) {
      const target = heroes.filter((h) => near(h.pos!, m.pos!, 5)).sort((a, b) => a.hp - b.hp)[0];
      if (target?.pos) {
        this.map.surface ??= {};
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const p = { x: target.pos.x + dx, y: target.pos.y + dy };
          const k = cellIndex(this.map, p.x, p.y);
          if (this.map.cells[k] === "floor" && !this.map.surface[k]) this.map.surface[k] = { kind: "oil" };
        }
        this.syncWorld();
        publish("Öl!", [{ text: `🛢️ ${m.name} schleudert einen Ölkrug vor ${target.name}s Füße – glitschig und brennbar!`, glossarKeys: ["feuer"] }], [], "splash", target.pos);
        return true;
      }
    }

    // 4. Big brutes hurl crates, barrels, stools and pots.
    const big = ["large", "huge", "gargantuan"].includes(m.size) && m.abilities.STR >= 16;
    const missile = big ? this.map.objects.find((o) => o.state !== "used" && near(o, m.pos!, 1) && (o.kind === "barrel" || (o.kind === "prop" && ["crate", "stool", "pot"].includes(o.prop ?? "")))) : undefined;
    const aim = missile && heroes.filter((h) => !near(h.pos!, m.pos!, 1) && near(h.pos!, m.pos!, 6)).sort((a, b) => a.hp - b.hp)[0];
    if (missile && aim) {
      const str = Math.floor((m.abilities.STR - 10) / 2);
      const option: AttackOption = {
        id: "hurl",
        sourceId: "improvised",
        source: "weapon",
        kind: "ranged",
        toHit: [{ label: "Stärke", value: str, glossarKey: "staerke" }, { label: "Übung", value: m.proficiencyBonus, glossarKey: "uebungsbonus" }],
        damage: [{ dice: "2d6", type: "bludgeoning" }],
        damageBonus: [{ label: "Stärke", value: str, glossarKey: "staerke" }],
        reachFt: 5,
        rangeFt: { normal: 30 },
      };
      const what = missile.kind === "barrel" ? "ein Fass" : missile.prop === "crate" ? "eine Kiste" : missile.prop === "pot" ? "einen Tonkrug" : "einen Hocker";
      missile.state = "used";
      missile.blocking = false;
      missile.frame = missile.kind === "barrel" ? "" : missile.prop === "pot" ? "pot.shards" : "";
      const attack = resolveAttack(this.rng, this.battle, m, aim, option);
      const roll = this.outcomeToRoll(m, `${m.name} wirft ${what}`, 20, { ok: true, actorId: m.id, cost: "action", kind: "attack", attack });
      if (roll.lines[0]) roll.lines[0] = { text: `💪 ${m.name} reißt ${what} hoch und schleudert es auf ${aim.name}!`, glossarKeys: ["werfen", "angriffswurf"] };
      this.map.decals ??= {};
      this.map.decals[cellIndex(this.map, aim.pos!.x, aim.pos!.y)] = "debris";
      this.addLog(roll.lines);
      this.publishRoll(roll);
      this.syncWorld();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- travel between chapters

  showTravel(view: TravelView | undefined): void {
    this.emit("travel", view);
  }

  /** A travel event hurts, but never knocks anyone out (the rest at the fire follows). */
  travelHurt(hero: Creature, dice: string): number {
    return this.hurtNoKnockout(hero, dice);
  }

  /** A blessing or luck for the next fight (prayers on the way, the saga …). */
  grantBoon(heroId: string, boon: "bless" | "luck"): void {
    this.boons.set(heroId, boon);
  }

  /** Takes gold from this hero (or, if they have too little, from the group). */
  private spendGoldOf(hero: Creature, amount: number): boolean {
    if (this.goldOf(hero) >= amount) {
      const g = hero.pc!.inventory.find((i) => i.itemId === "gold")!;
      g.qty -= amount;
      return true;
    }
    return this.spendGold(amount);
  }

  /** Applies prayers and wishes when a fight starts. */
  private grantBoons(): void {
    for (const [id, boon] of this.boons) {
      const c = this.battle.creatures[id];
      if (!c || c.dead) continue;
      if (boon === "bless") addEffect(c, "bless", 10, "altar");
      else addEffect(c, "helped", 10, "wish");
      this.addLog([{ text: boon === "bless" ? `🙏 Der Segen vom Altar liegt auf ${c.name}.` : `🍀 ${c.name} hat Glück: Der erste Angriff hat Vorteil.`, glossarKeys: [boon === "bless" ? "zauber:bless" : "vorteil"] }]);
    }
    this.boons.clear();
  }

  /** What a hero can do with an object right next to them (also used for "hingehen und benutzen"). */
  private objectChoices(me: Creature, o: MapObject, enemies: Creature[], mine: boolean, costReason: (cost: "action" | "bonus") => string | undefined): ActionChoice[] {
    const out: ActionChoice[] = [];
    const notMine = mine ? undefined : "Warte, bis du dran bist.";
    if (o.kind === "chest" && o.state !== "open") {
      out.push({ id: `open:${o.id}`, group: "look", label: "Truhe öffnen", detail: "Direkt neben dir · kostet nichts", glossarKey: "truhe", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
    }
    if (o.kind === "barrel" && o.state !== "used" && !(this.mode !== "combat" && o.state === "found")) {
      if (this.mode === "combat") {
        const targets = enemies.filter((e) => e.pos && Math.max(Math.abs(e.pos.x - o.x), Math.abs(e.pos.y - o.y)) <= 4);
        const reason = costReason("action") ?? (targets.length ? undefined : "Kein Gegner in Rollweite (4 Felder vom Fass).");
        out.push({ id: `barrel:${o.id}`, group: "look", label: "🛢️ Fass auf Gegner rollen", detail: "Athletik SG 10 · 1W6 Schaden, kleine Gegner fallen um", glossarKey: "fass", cost: "action", enabled: !reason, ...(reason ? { reason } : {}), action: { kind: "interact", objectId: o.id }, targets: targets.map((t) => ({ id: t.id, name: t.name, detail: `TP ${t.hp}/${t.maxHp}` })), pick: { min: 1, max: 1, repeat: false } });
      } else out.push({ id: `search:${o.id}`, group: "look", label: "🛢️ Fass durchsuchen", detail: "Direkt neben dir · kostet nichts", glossarKey: "fass", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
    }
    if (o.kind === "lever" && o.state !== "used") {
      const reason = this.mode === "combat" ? costReason("action") : notMine;
      out.push({ id: `lever:${o.id}`, group: "look", label: "🕹️ Hebel ziehen", detail: this.mode === "combat" ? "Kostet deine Aktion · was passiert wohl?" : "Direkt neben dir · was passiert wohl?", glossarKey: "hebel", cost: this.mode === "combat" ? "action" : "free", enabled: !reason && (mine || this.mode !== "combat"), ...(reason ? { reason } : {}), action: { kind: "interact", objectId: o.id } });
    }
    if (o.kind === "secret" && o.state !== "found") {
      const reason = this.mode === "combat" ? costReason("action") : notMine;
      const runes = o.variant === "runes";
      out.push({ id: `secret:${o.id}`, group: "look", label: runes ? "🔍 Zeichen an der Wand untersuchen" : "🔍 Bodenplatte untersuchen", detail: runes ? "Arkane Kunde SG 12" : "Nachforschungen SG 12", glossarKey: "geheimnis", cost: this.mode === "combat" ? "action" : "free", enabled: !reason, ...(reason ? { reason } : {}), recommended: o.state === "closed", action: { kind: "interact", objectId: o.id } });
    }
    if (o.kind === "campfire" && this.mode !== "combat" && !this.restedAtFire.size) {
      out.push({ id: `fire:${o.id}`, group: "look", label: "🔥 Am Feuer rasten", detail: "Alle heilen ein wenig (einmal pro Ort)", glossarKey: "lagerfeuer", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
    }
    if (o.kind === "cauldron" && this.mode !== "combat" && !this.triedObject.has(`${o.id}:${me.id}`)) {
      out.push({ id: `cauldron:${o.id}`, group: "look", label: "🧪 Aus dem Kessel kosten", detail: "Naturkunde SG 13: Heiltrank oder Hexengebräu?", glossarKey: "kessel", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
    }
    if (o.kind === "prop" || o.kind === "altar" || o.kind === "fountain") out.push(...this.propChoices(me, o, enemies, mine, costReason));
    if (o.kind === "door") {
      out.push({ id: `door:${o.id}`, group: "look", label: o.state === "open" ? "Tür schließen" : "Tür öffnen", detail: "Direkt neben dir · kostet nichts", glossarKey: "aktion", cost: "free", enabled: mine, ...(notMine ? { reason: notMine } : {}), action: { kind: "interact", objectId: o.id } });
    }
    return out;
  }

  /** What a hero can do with the props next to them (phone buttons). */
  private propChoices(me: Creature, o: MapObject, enemies: Creature[], mine: boolean, costReason: (cost: "action" | "bonus") => string | undefined): ActionChoice[] {
    const out: ActionChoice[] = [];
    const combat = this.mode === "combat";
    const notMine = mine ? undefined : "Warte, bis du dran bist.";
    const tried = this.triedObject.has(`${o.id}:${me.id}`);
    const add = (use: string, label: string, detail: string, glossarKey: string, cost: "action" | "bonus" | "free", extra: Partial<ActionChoice> = {}) => {
      const reason = extra.reason ?? (cost === "free" ? notMine : costReason(cost));
      out.push({ id: `${use}:${o.id}`, group: "look", label, detail, glossarKey, cost, enabled: !reason, ...(reason ? { reason } : {}), ...extra, action: { kind: "interact", objectId: o.id, use } });
    };
    const bonusOrAction = (): "bonus" | "action" | "free" => (!combat ? "free" : this.turnFor(me)?.bonusAction ? "bonus" : "action");
    const throwTargets = (ft: number) => enemies.filter((e) => e.pos && me.pos && distanceFt(me, e) <= ft * 2);
    const throwChoice = (label: string, detail: string, ft: number) => {
      const targets = throwTargets(ft);
      add("throw", label, detail, "werfen", "action", { ...(targets.length ? {} : { reason: costReason("action") ?? "Kein Gegner in Wurfweite." }), targets: targets.map((t) => ({ id: t.id, name: t.name, detail: `TP ${t.hp}/${t.maxHp}` })), pick: { min: 1, max: 1, repeat: false } });
    };
    if (o.kind === "altar") {
      if (!combat && !tried) add("pray", "🙏 Am Altar beten", "Religion SG 10 · Segen für den nächsten Kampf", "altar", "free");
      return out;
    }
    if (o.kind === "fountain") {
      if (!combat && !tried) add("wish", `🪙 Münze in den Brunnen werfen`, `${WISH_GOLD} Gold · Glück im nächsten Kampf`, "wunschbrunnen", "free", this.goldOf(me) + this.partyGold() < WISH_GOLD ? { reason: `Du brauchst ${WISH_GOLD} Goldmünzen.` } : {});
      return out;
    }
    const def = propDef(o);
    if (!def || o.state === "used") return out;
    switch (o.prop) {
      case "table":
        add("flip", "💪 Tisch umwerfen", `Volle Deckung dahinter (+5 RK gegen Fernangriffe)${combat ? " · kostet die Bonusaktion" : ""}`, "deckung", bonusOrAction());
        if (combat && (o.uses ?? 0) > 0 && this.map.rooms.find((r) => r.id === o.roomId)?.theme === "tavern") throwChoice("🍺 Bierkrug werfen", "Geschick-Angriff · 1W4 Schaden · bis 6 Felder", 30);
        break;
      case "table-flipped":
        if (combat && (o.uses ?? 0) > 0 && this.map.rooms.find((r) => r.id === o.roomId)?.theme === "tavern") throwChoice("🍺 Bierkrug werfen", "Geschick-Angriff · 1W4 Schaden · bis 6 Felder", 30);
        break;
      case "stool":
        if (combat) throwChoice("🪑 Hocker werfen", "Geschick-Angriff · 1W6 Schaden · bis 4 Felder", 20);
        break;
      case "weapon-rack":
        if (combat && (o.uses ?? 0) > 0) throwChoice("🗡️ Speer werfen", `Geschick + Übung · 1W6 Schaden · bis 6 Felder (noch ${o.uses})`, 30);
        break;
      case "crate":
      case "pot":
        add("smash", o.prop === "pot" ? "💥 Tonkrug zerschlagen" : "💥 Kiste aufbrechen", "Vielleicht ist etwas drin?", "zerschlagen", combat ? "action" : "free");
        break;
      case "bookshelf":
        if (!tried) add("search", "📚 Im Bücherregal stöbern", "Nachforschungen SG 12 · Wissen, Hinweise, Verstecktes", "buecherregal", combat ? "action" : "free", combat ? { reason: "Dafür ist im Kampf keine Zeit." } : {});
        break;
      case "herbs":
        if (!combat && !tried) add("herbs", "🌿 Heilkräuter sammeln", "Heilkunde SG 10 · Zutat für Heiltränke", "kraeuter", "free");
        break;
      case "web":
        add("gather", "🕸️ Spinnenseide sammeln", "Zutat für Stolperdraht und Brandflasche", "brauen", combat ? "action" : "free");
        break;
      case "mushrooms":
      case "mushrooms-glow":
        add("gather", o.prop === "mushrooms-glow" ? "✨ Leuchtpilze sammeln" : "🍄 Pilze sammeln", "Zutat zum Brauen (Taschen-Tab)", "brauen", combat ? "action" : "free");
        if (!tried) add("eat", o.prop === "mushrooms-glow" ? "🍄 Leuchtpilz essen" : "🍄 Pilz probieren", o.prop === "mushrooms-glow" ? "Man sagt, man leuchtet danach …" : "Lecker, giftig oder komisch? Probier's aus!", "pilze", combat ? "action" : "free");
        break;
      case "candles":
      case "brazier": {
        const out_ = o.variant === "out";
        add("light", out_ ? "🔥 Anzünden" : "🌑 Löschen", out_ ? "Macht es wieder hell" : "Im Dunkeln sieht man schlecht – gut zum Verstecken", "licht_loeschen", bonusOrAction());
        if (o.prop === "brazier" && combat && o.variant !== "out") {
          const targets = enemies.filter((e) => e.pos && Math.max(Math.abs(e.pos.x - o.x), Math.abs(e.pos.y - o.y)) <= 3);
          add("tip", "🔥 Kohlebecken umstoßen", "Athletik SG 10 · glühende Kohlen Richtung Gegner (1W6 Feuer)", "feuer", "action", { ...(targets.length ? {} : { reason: costReason("action") ?? "Kein Gegner nah genug am Becken." }), targets: targets.map((t) => ({ id: t.id, name: t.name, detail: `TP ${t.hp}/${t.maxHp}` })), pick: { min: 1, max: 1, repeat: false } });
        }
        break;
      }
      case "well":
        if (!combat && !tried) add("wish", "🪙 Münze in den Brunnen werfen", `${WISH_GOLD} Gold · Glück im nächsten Kampf`, "wunschbrunnen", "free", this.goldOf(me) + this.partyGold() < WISH_GOLD ? { reason: `Du brauchst ${WISH_GOLD} Goldmünzen.` } : {});
        break;
      case "coffin":
        if (!combat && !tried) add("open", "⚰️ Sargdeckel aufschieben", "Athletik SG 12 · Grabbeigaben?", "sarg", "free");
        break;
    }
    if (def.flammable && this.hasFire(me) && o.prop !== "table-flipped") add("ignite", `🔥 ${def.name} anzünden`, "Mit der Fackel · Feuer breitet sich aus!", "feuer", combat ? "action" : "free");
    return out;
  }

  private lookAround(hero: Creature): RollOutcome | { error: string } {
    const turn = this.battle.combat?.turn;
    if (turn && turn.creatureId === hero.id) {
      if (turn.actions <= 0) return { error: "Du hast deine Aktion schon benutzt." };
      turn.actions--;
    }
    // A dog with a keen nose sniffs along.
    const nose = this.companionOf(hero)?.companion?.trait === "spuernase" ? this.companionOf(hero) : undefined;
    const check = skillCheck(this.rng, hero, "perception", this.sg(LOOK_DC), nose ? { reasons: [advantage(`${nose.name} schnüffelt mit (Spürnase)`, "begleiter")] } : {});
    const lines = explainCheck(this.battle, hero.id, check);
    const roomIndex = hero.pos ? (this.map.roomOf[cellIndex(this.map, hero.pos.x, hero.pos.y)] ?? -1) : -1;
    const traps = this.map.objects.filter((o) => o.kind === "trap" && o.state === "hidden" && (roomIndex < 0 || o.roomId === this.map.rooms[roomIndex]?.id));
    const secrets = this.map.objects.filter((o) => o.kind === "secret" && o.state === "hidden" && (roomIndex < 0 || o.roomId === this.map.rooms[roomIndex]?.id));
    if (check.success) {
      this.bump(hero.id, "finds");
      traps.forEach((t) => (t.state = "found"));
      // Secrets become easy to spot (and can be examined up close).
      secrets.forEach((s) => (s.state = "closed"));
      if (secrets.length) lines.push({ text: `🔍 ${hero.name} bemerkt etwas Merkwürdiges ${secrets[0]!.variant === "runes" ? "an der Wand" : "am Boden"}.`, glossarKeys: ["geheimnis"] });
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

  /** Counts every line ever put in the TV's log column (it redraws when this changes). */
  logCount = 0;
  /** The TV's log column: short lines with symbols, no dice sums (those stay on the phones). */
  private tvLog: ExplainedLine[] = [];

  /** The newest lines of the TV's log column (oldest first). */
  recentLog(n: number): ExplainedLine[] {
    return this.tvLog.slice(-n);
  }

  /** `tv`: what the TV's log column shows instead (default: the same lines without the calculations). */
  private addLog(lines: ExplainedLine[], tv: ExplainedLine[] = lines.filter((l) => !MATH_LINE.test(l.text))): void {
    this.log.push(...lines);
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
    this.logCount += tv.length;
    this.tvLog.push(...tv);
    if (this.tvLog.length > LOG_SIZE) this.tvLog.splice(0, this.tvLog.length - LOG_SIZE);
  }

  broadcast(): void {
    // Outside a fight nobody stays down (fire, a trap, a burning barrel): up again with 1 hit point.
    if (this.mode !== "combat") {
      for (const h of this.heroes()) {
        if (h.dead || h.hp > 0) continue;
        heal(h, 1);
        h.conditions = h.conditions.filter((c) => c.id !== "prone" && c.id !== "unconscious");
        this.addLog([{ text: `${h.name} rappelt sich mit 1 Trefferpunkt wieder auf.`, glossarKeys: ["stabil"] }]);
      }
    }
    this.sweepXp();
    this.checkGoals();
    if (this.training) for (const h of this.heroes()) if (h.hp === 0 && !h.dead) h.stable = true;
    this.syncWorld();
    this.mournCompanions();
    this.templeBlessing();
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
        speedFt: me.speedFt,
        ...(!mine && !free && this.nextUp()?.id === me.id ? { nextUp: true } : {}),
        ...(mine && this.undo?.heroId === me.id ? { canUndo: true } : {}),
      },
      order,
      roomName: roomIndex >= 0 ? this.map.rooms[roomIndex]!.name : "Gang",
      minimap: this.minimap(me, mine),
      choices: this.choicesFor(me, mine, this.beginner.get(playerId) ?? true),
      log: this.log.slice(-15),
      beginnerMode: this.beginner.get(playerId) ?? true,
      party: this.heroes().filter((h) => h.id !== me.id && !h.dead).map((h) => ({ id: h.id, name: h.name, ...(h.appearance ? { color: h.appearance.color } : {}) })),
    };
    if (this.pending?.playerId === playerId) view.pendingRoll = this.pending.prompt;
    const pet = Object.values(this.battle.creatures).find((c) => c.companion?.ownerId === me.id && (!c.dead || this.mourned.has(c.id)));
    if (pet?.companion) {
      const def = COMPANIONS[pet.companion.kind];
      const trait = traitOf(pet.companion);
      view.companion = { icon: def.icon, kind: def.name, name: pet.name, trait: trait?.name ?? "", traitText: trait?.text ?? "", hp: pet.hp, maxHp: pet.maxHp, dead: pet.dead };
    }
    const camp = this.campView(me);
    if (camp) view.camp = camp;
    const goal = this.goalView(me);
    if (goal) view.goal = goal;
    if (this.blowAsk?.heroId === me.id) view.finalBlow = { boss: this.blowAsk.boss };
    const family = this.familyOf?.(me.name);
    if (family) view.family = family;
    if (this.storyView) view.story = { ...this.storyView, narration: this.narrationLog.slice(-4), choices: this.storyChoiceView(playerId), ...(this.votes ? { vote: { cast: this.votes.size, total: this.voters().length } } : {}) };
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

  /**
   * Where the phone map looks: in a fight at the hero and the nearest enemies (as many as fit),
   * otherwise at the hero. The hero always stays on the map, with a square to spare.
   */
  private minimapFocus(me: Creature, pos: GridPos, w: number, h: number): GridPos {
    if (this.mode !== "combat" || !me.pos) return pos;
    const d = (c: Creature) => Math.max(Math.abs(c.pos!.x - pos.x), Math.abs(c.pos!.y - pos.y));
    const foes = this.enemiesVisible()
      .filter((c) => isActive(c) && c.pos && this.map.explored[cellIndex(this.map, c.pos.x, c.pos.y)])
      .sort((a, b) => d(a) - d(b));
    let box = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
    for (const f of foes.slice(0, 4)) {
      const next = { x1: Math.min(box.x1, f.pos!.x), y1: Math.min(box.y1, f.pos!.y), x2: Math.max(box.x2, f.pos!.x), y2: Math.max(box.y2, f.pos!.y) };
      if (next.x2 - next.x1 > w - 3 || next.y2 - next.y1 > h - 3) break;
      box = next;
    }
    const cx = Math.round((box.x1 + box.x2) / 2);
    const cy = Math.round((box.y1 + box.y2) / 2);
    const hw = Math.floor(w / 2) - 1;
    const hh = Math.floor(h / 2) - 1;
    return { x: Math.max(pos.x - hw, Math.min(pos.x + hw, cx)), y: Math.max(pos.y - hh, Math.min(pos.y + hh, cy)) };
  }

  private minimap(me: Creature, mine: boolean): MiniMap {
    const map = this.map;
    const pos = me.pos ?? { x: 0, y: 0 };
    const w = Math.min(MINIMAP_W, map.width);
    const h = Math.min(MINIMAP_H, map.height);
    const focus = this.minimapFocus(me, pos, w, h);
    const x0 = Math.max(0, Math.min(map.width - w, focus.x - Math.floor(w / 2)));
    const y0 = Math.max(0, Math.min(map.height - h, focus.y - Math.floor(h / 2)));
    const frames: string[] = [];
    const overlays: (string | null)[] = [];
    const ground: string[] = [];
    let marks = "";
    const t = this.battle.terrain;
    const difficult = new Set(t?.difficult ?? []);
    const high = new Set(t?.high ?? []);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = cellIndex(map, x, y);
        const seenCell = !!map.explored[i];
        frames.push(seenCell ? (map.frames[i] ?? "") : "");
        overlays.push(seenCell ? (map.overlays[i] ?? null) : null);
        const surface = map.surface?.[i]?.kind;
        const groundFrame = surface === "fire" ? "fire.0" : surface === "mud" ? "floor.mud.0" : surface === "warn" ? "danger" : surface;
        ground.push(seenCell ? [map.decals?.[i], groundFrame].filter(Boolean).join("|") : "");
        const k = `${x},${y}`;
        marks += !seenCell ? "." : surface === "fire" || surface === "warn" ? "f" : surface === "ice" ? "i" : high.has(k) ? "h" : difficult.has(k) && map.cells[i] !== "water" ? "d" : t?.cover[k] ? "c" : ".";
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
      .map((o) => {
        const use = mine && o.kind !== "trap" && o.kind !== "door" ? this.objectChoices(me, o, this.enemiesVisible().filter(isActive), true, () => undefined)[0]?.label : undefined;
        return { id: o.id, x: o.x, y: o.y, frame: o.frame, name: objectName(o), ...(use ? { use } : {}) };
      });
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
        ...(c.side === "enemy" ? { ac: armorClass(c), hp: c.hp, maxHp: c.maxHp, danger: dangerFor(me, c), ...(this.knownTypes(c).length ? { types: this.knownTypes(c) } : {}) } : {}),
        ...(c.side === "neutral" && !c.appearance ? this.noteFor(c.name, me.name) : {}),
      }));
    return { x0, y0, w, h, frames, overlays, ground, marks, objects, creatures, reachable: mine && !this.pending ? this.reachable(me).filter(inWindow) : [], ...(light ? { light } : {}) };
  }

  private noteFor(name: string, hero: string): { bond?: number; mood?: string; memory?: string; love?: number; loveLabel?: string; tie?: "spouse" | "engaged" } {
    const n = this.npcNote?.(name, hero);
    return n ? { bond: n.bond, mood: n.mood, ...(n.memory ? { memory: n.memory } : {}), ...(n.love ? { love: n.love, loveLabel: n.loveLabel ?? "" } : {}), ...(n.tie ? { tie: n.tie } : {}) } : {};
  }

  /** A friend standing on this square who would trade places (narrow tunnels!). */
  private swapPartner(me: Creature, p: GridPos): Creature | undefined {
    if (squaresOf(me).length !== 1) return undefined;
    return Object.values(this.battle.creatures).find((c) => c.id !== me.id && c.side === me.side && !c.dead && isActive(c) && c.pos?.x === p.x && c.pos?.y === p.y && squaresOf(c).length === 1);
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
    // Cheapest way to every square (difficult ground costs two steps).
    const best = new Map<string, number>([[`${me.pos.x},${me.pos.y}`, 0]]);
    const buckets: GridPos[][] = [[me.pos]];
    const out: GridPos[] = [];
    for (let s = 0; s < buckets.length && s <= steps; s++) {
      for (const p of buckets[s] ?? []) {
        if (best.get(`${p.x},${p.y}`) !== s) continue;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const q = { x: p.x + dx, y: p.y + dy };
            const k = `${q.x},${q.y}`;
            if (!dx && !dy) continue;
            const cost = s + stepCost(this.battle, q);
            if (cost > steps || (best.has(k) && best.get(k)! <= cost) || enemies.has(k) || !isWalkable(this.map, q)) continue;
            if (!this.map.explored[cellIndex(this.map, q.x, q.y)] && !this.map.explored[cellIndex(this.map, p.x, p.y)]) continue;
            if (!best.has(k) && (!occupied.has(k) || this.swapPartner(me, q))) out.push(q);
            best.set(k, cost);
            (buckets[cost] ??= []).push(q);
          }
        }
      }
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
    this.emit("changed");
    this.broadcast();
  }

  private storyChoiceView(playerId: PlayerId): ActionChoice[] {
    const votes = this.votes;
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
      ...(votes
        ? {
            votes: {
              names: [...votes].filter(([, id]) => id === c.id).map(([pid]) => this.heroOf(pid)?.name ?? "?"),
              mine: votes.get(playerId) === c.id,
            },
          }
        : {}),
    }));
  }

  /** Offers story choices to all phones; resolves with the first pick and who made it. */
  choose(offers: StoryChoiceOffer[], opts: { vote?: boolean } = {}): Promise<{ id: string; playerId: PlayerId }> {
    this.storyChoices = offers;
    // Big decisions are voted on by everyone (not with only one player at the table).
    this.votes = opts.vote && this.voters().length > 1 ? new Map() : undefined;
    return new Promise((resolve) => {
      this.choiceWaiter = resolve;
      this.emitVote();
      this.broadcast();
    });
  }

  // ---------------------------------------------------------------- group votes

  /** Player → chosen option, while a vote is open. */
  private votes: Map<PlayerId, string> | undefined;
  private voteTimer: ReturnType<typeof setTimeout> | undefined;

  /** Everyone at the table votes, also a knocked-out hero's player. */
  private voters(): Creature[] {
    return this.heroes().filter((h) => h.playerId && !h.dead);
  }

  private emitVote(): void {
    const votes = this.votes;
    if (!votes || !this.storyChoices.length) {
      this.emit("vote", undefined);
      return;
    }
    const total = this.voters().length;
    this.emit("vote", {
      total,
      cast: votes.size,
      options: this.storyChoices.map((c) => ({
        label: c.label,
        voters: [...votes].filter(([, id]) => id === c.id).map(([pid]) => {
          const h = this.heroOf(pid);
          return { name: h?.name ?? "?", color: h?.appearance?.color ?? "#888" };
        }),
      })),
    });
  }

  /** A phone voted (or changed its vote). Decides when all have voted, or 40 s after the first vote. */
  private castVote(playerId: PlayerId, choiceId: string): void {
    const votes = this.votes!;
    votes.set(playerId, choiceId);
    this.emitVote();
    if (this.voters().every((h) => votes.has(h.playerId!))) {
      this.decideVote();
      return;
    }
    this.voteTimer ??= setTimeout(() => this.decideVote(), VOTE_S * 1000);
    this.broadcast();
  }

  private decideVote(): void {
    clearTimeout(this.voteTimer);
    this.voteTimer = undefined;
    const votes = this.votes;
    const resolve = this.choiceWaiter;
    if (!votes || !resolve || !votes.size) return;
    const tally = this.storyChoices.map((c) => ({ c, n: [...votes.values()].filter((id) => id === c.id).length }));
    const most = Math.max(...tally.map((t) => t.n));
    const tied = tally.filter((t) => t.n === most);
    // A tie: the recommended option wins, otherwise the one voted for first.
    const firstVoted = [...votes.values()].find((id) => tied.some((t) => t.c.id === id));
    const win = (tied.find((t) => t.c.recommended) ?? tied.find((t) => t.c.id === firstVoted) ?? tied[0]!).c;
    const chooser = [...votes].find(([, id]) => id === win.id)![0];
    this.votes = undefined;
    this.choiceWaiter = undefined;
    this.storyChoices = [];
    this.addLog([{ text: `🗳️ Abstimmung: ${most} von ${votes.size} für „${win.label}“${tied.length > 1 ? " (Gleichstand – entschieden)" : ""}.`, glossarKeys: ["entscheidung"] }]);
    this.narrate([{ text: `🗳️ Die Gruppe hat entschieden: ${win.label}` }]);
    this.emit("vote", undefined);
    resolve({ id: win.id, playerId: chooser });
    this.broadcast();
  }

  /** Resolves once `pred` is true after some state change. */
  waitFor(pred: () => boolean): Promise<void> {
    if (pred()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ pred, resolve }));
  }

  /** A skill check for one hero; resolves when the phone has rolled. */
  check(hero: Creature, skill: SkillId, baseDc: number, title: string, opts: { plan?: string; cancellable?: boolean } = {}): Promise<CheckResult & { cancelled?: boolean }> {
    const dc = this.sg(baseDc);
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
        const prompt = { title: `${title} (${nameOf("skills", skill)}, SG ${dc})`, sides: 20, glossarKey: `fertigkeit:${skill}`, need: rollNeed("SG", dc, sumParts(skillParts(hero, skill))), ...(opts.plan ? { plan: opts.plan } : {}), ...(opts.cancellable ? { cancellable: true } : {}) };
        // Taken back: no roll, nothing happens (the caller gives the action back).
        const cancel = opts.cancellable ? () => resolve({ ...skillCheck(this.envRng, hero, skill, 99), success: false, cancelled: true }) : undefined;
        this.ask(playerId, hero, prompt, run, cancel);
      };
      tryAsk();
    });
  }

  /** Spawns monsters in the heroes' current room and starts a fight. Resolves with the winner. */
  fight(groups: MonsterGroup[], opts: { training?: boolean; allies?: { monster: string; name: string }[] } = {}): Promise<{ winner: "party" | "enemy"; spawned: Creature[] }> {
    const spawned = this.spawnGroups(groups, opts.allies ?? [], !!opts.training);
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

  isBoss(id: string): boolean {
    return this.bossIds.has(id);
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

  /** A boss waits among the staged foes (no sneaking past those). */
  get stagedHasBoss(): boolean {
    return !!this.staged?.spawned.some((m) => this.bossIds.has(m.id));
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
    clearTimeout(this.voteTimer);
    this.voteTimer = undefined;
    if (this.votes) {
      this.votes = undefined;
      this.emit("vote", undefined);
    }
    const waiter = this.choiceWaiter;
    this.choiceWaiter = undefined;
    this.storyChoices = [];
    this.broadcast();
    waiter({ id: "", playerId: "" });
  }

  /** Nothing is open: no roll, no choice, no fight. */
  get idle(): boolean {
    return this.mode === "explore" && !this.pending && !this.choiceWaiter && !this.staged && !this.camp;
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
  /** Fire and ice age by one step; returns whether anything was burning or frozen. */
  private tickSurfaces(): boolean {
    const weathery = this.map.weather === "rain" || this.map.weather === "snow";
    if (weathery) weatherTick(this.map, this.envRng);
    const surface = this.map.surface;
    if (!surface || !Object.values(surface).some((x) => x.kind === "fire" || x.kind === "ice")) {
      if (weathery) this.emit("changed");
      return weathery;
    }
    const r = tickWorldSurface(this.map, this.envRng);
    if (r.lines.length) {
      this.addLog(r.lines);
      this.emit("lines", r.lines);
    }
    this.emit("changed");
    return true;
  }

  /**
   * The world between the heroes' actions. Exploring in turns: people and patrols move once per round
   * (`roundEnd`); the clock only skips a player who has been silent for a long time.
   */
  tickWorld(roundEnd = false): void {
    if (this.destroyed || this.mode !== "explore") return;
    if (!this.freeExplore && !roundEnd) {
      const c = this.active();
      const left = this.secondsLeft();
      if (c?.playerId && !this.pending && left === 0) {
        this.addLog([{ text: `⏭️ ${c.name} war eine Weile still – der Nächste ist dran.`, glossarKeys: ["zug_beenden"] }]);
        this.endTurn();
        return;
      }
      return;
    }
    if (roundEnd || this.tickSurfaces()) this.broadcast();
    let moved = false;
    const creatures = Object.values(this.battle.creatures);
    const free = (p: GridPos) => isWalkable(this.map, p) && !creatures.some((c) => !c.dead && c.pos?.x === p.x && c.pos?.y === p.y);
    const heroes = this.heroes().filter((h) => h.pos && !h.dead);
    const heroNear = (p: GridPos, d: number) => heroes.some((h) => Math.max(Math.abs(h.pos!.x - p.x), Math.abs(h.pos!.y - p.y)) <= d);
    for (const c of creatures) {
      if (!c.pos || c.dead) continue;
      if ((c.id.startsWith("npc-") || c.wild) && c.side === "neutral") {
        if (!this.npcHomes.has(c.id)) this.npcHomes.set(c.id, { ...c.pos });
        // Stays put while someone talks to them (or walks along with the group); otherwise strolls now and then.
        if (c.followId || heroNear(c.pos, 2) || this.rng.next() > 0.25) continue;
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
        // Both ways blocked (a table, a crate …): turn around the corner.
        if (!free(next)) {
          const side = [{ x: dir.y, y: dir.x }, { x: -dir.y, y: -dir.x }].find((d) => free({ x: c.pos!.x + d.x, y: c.pos!.y + d.y }));
          if (side) {
            dir = side;
            next = { x: c.pos.x + dir.x, y: c.pos.y + dir.y };
          }
        }
        this.patrolDir.set(c.id, dir);
        if (free(next)) {
          c.pos = next;
          moved = true;
        }
      }
    }
    if (!moved) {
      // A hero may have walked right up to a guard that stands still.
      if (this.staged) this.checkCombatStart();
      return;
    }
    this.emit("changed");
    this.broadcast();
    // A patrol may walk right into the heroes.
    this.checkCombatStart();
  }

  private spawnGroups(groups: MonsterGroup[], allies: { monster: string; name: string }[], training = false): Creature[] {
    const rules = DIFFICULTY[this.difficulty];
    const extra = groups.some((g) => g.boss) && !rules.extraWithBoss ? 0 : rules.extraMonsters;
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
      // Harder levels bring one more of the rank and file (never in the training fight).
      const count = scaleGroup(g, players) + (g.boss || training || !g.count ? 0 : extra);
      const spots = freeSpots(g.boss ? [...room.spots.boss, ...room.spots.monster] : room.spots.monster);
      // Now and then the whole group is an elemental variant (Feuerkobolde, Frost-Skelette …).
      const kinds = !g.boss && !training && !g.name ? VARIANTS[g.monster] : undefined;
      const element = kinds && this.envRng.next() < ELEMENT_CHANCE ? kinds[Math.floor(this.envRng.next() * kinds.length) % kinds.length] : undefined;
      for (let i = 0; i < count && spots.length; i++) {
        const pos = spots.shift()!;
        const m = createMonster(g.monster, `m${++this.rollCounter}`, { name: g.name ?? nameOf("monsters", g.monster) });
        if (element) applyElement(m, element);
        if (count > 1) m.name = `${m.name} ${i + 1}`;
        m.pos = pos;
        if (!training) hardenMonster(m, rules);
        // The group is below this chapter's level: its foes are a bit weaker (−20 % hit points per level, at most half).
        if (!training && this.levelGap > 0) {
          m.maxHp = Math.max(1, Math.round(m.maxHp * Math.max(0.5, 1 - 0.2 * this.levelGap)));
          m.hp = m.maxHp;
        }
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
    this.reinforced = false;
    const ids = [...this.heroes().filter((h) => !h.dead).map((h) => h.id), ...extraIds];
    this.styleUsed.clear();
    const combat = startCombat(this.rng, this.battle, [...new Set(ids)]);
    const lines: ExplainedLine[] = [
      { text: "⚔️ Kampf! Alle würfeln Initiative. Wer am höchsten würfelt, ist zuerst dran.", glossarKeys: ["initiative"] },
      ...combat.order.map((e) => explainInitiative(this.battle, e)),
    ];
    this.addLog(lines);
    this.publishRoll({ id: `o${++this.rollCounter}`, creatureId: combat.order[0]!.creatureId, title: "Kampf!", sides: 20, dice: [], kept: 0, lines });
    this.emit("combat", true);
    this.tricksUsed.clear();
    this.startArena();
    this.wizardLore();
    this.grantBoons();
    this.companionsAtFightStart();
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
    this.seedEnv(map);
    this.findsThisMap = 0;
    this.ratsCalled = false;
    this.setups.clear();
    this.combosRewarded = 0;
    this.ideasRewarded = 0;
    this.barricades = 0;
    this.wallsBroken = 0;
    this.collapses = 0;
    this.firstAidThisMap.clear();
    this.npcHomes.clear();
    this.triedObject.clear();
    this.restedAtFire.clear();
    this.patrolDir.clear();
    this.staged = undefined;
    // Monsters stay behind – tamed companions come along (the fallen ones don't).
    for (const c of Object.values(this.battle.creatures)) if (c.kind === "monster" && !c.squire && (!c.companion || c.dead)) delete this.battle.creatures[c.id];
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
    // The village's watchtower: scouts have seen every room already.
    if (this.village.includes("wachturm")) map.explored.fill(true);
    this.arriveWithCompanions();
    const weather = WEATHER_NOTE[map.weather ?? ""];
    if (weather && map.rooms.some((r) => THEMES[r.theme].outdoor)) this.addLog([{ text: weather, glossarKeys: ["wetter"] }]);
    if (map.weather === "snow") weatherTick(map, this.envRng);
    this.syncWorld();
    this.mode = "explore";
    delete this.battle.combat;
    this.emit("mapChanged");
    this.start();
  }

  /**
   * The rules' view of the map: furniture (cover, difficult ground, high places, fire) and,
   * at night, the fixed lights (wall torches, fires, braziers, candles, glowing mushrooms).
   */
  syncWorld(): void {
    const map = this.map;
    if (!map) return;
    this.battle.terrain = terrainOf(map);
    // Heroes who climbed onto a table, a barrel, a rock count as standing high.
    for (const c of Object.values(this.battle.creatures)) if (c.pos && !c.dead && hasEffect(c, "elevated")) this.battle.terrain.high.push(`${c.pos.x},${c.pos.y}`);
    if (!map.dark) {
      delete this.battle.darkness;
      return;
    }
    const lights = Object.entries(map.overlays).flatMap(([k, o]) => {
      const i = Number(k);
      return o.startsWith("torch") ? [{ x: i % map.width, y: Math.floor(i / map.width), radiusFt: 15 }] : [];
    });
    for (const o of map.objects) {
      if (o.kind === "campfire" || o.kind === "cauldron") lights.push({ x: o.x, y: o.y, radiusFt: 20 });
      const light = propLight(o);
      if (light) lights.push({ x: o.x, y: o.y, radiusFt: Math.round(light.radius) * 5 });
    }
    for (const [k, s] of Object.entries(map.surface ?? {})) {
      const i = Number(k);
      if (s.kind === "fire") lights.push({ x: i % map.width, y: Math.floor(i / map.width), radiusFt: 10 });
    }
    this.battle.darkness = { lights };
  }

  /** Milestone levelling: rebuild the heroes on a higher level, keeping their things. */
  levelUp(level: number): boolean {
    let changed = false;
    for (const h of this.heroes()) {
      if (!h.pc || h.pc.level >= level) continue;
      this.levelHero(h, level, false);
      changed = true;
    }
    if (changed) this.broadcast();
    return changed;
  }

  // ---------------------------------------------------------------- experience

  /** Enemies whose EP were already handed out. */
  private xpDone = new Set<string>();
  /** How many levels the group is below what this chapter was made for (foes are weaker then). */
  levelGap = 0;

  /** EP for every living hero (the same for all). Levels come right away – or after the fight. */
  awardXp(each: number, reason: string): void {
    if (each <= 0) return;
    const heroes = this.heroes().filter((h) => h.pc && !h.dead);
    for (const h of heroes) h.pc!.xp = (h.pc!.xp ?? 0) + each;
    this.addLog([{ text: `✨ +${each} EP für alle – ${reason}`, glossarKeys: ["erfahrung"] }]);
    if (this.mode !== "combat") this.applyLevels();
  }

  /** Defeated enemies are worth their rule-book EP, shared equally by the group (not in training fights). */
  private sweepXp(): void {
    if (this.training) return;
    const fallen = Object.values(this.battle.creatures).filter((c) => c.side === "enemy" && c.dead && c.monsterId && !this.xpDone.has(c.id));
    if (!fallen.length) return;
    for (const c of fallen) this.xpDone.add(c.id);
    const total = fallen.reduce((sum, c) => sum + monsterXp(c.monsterId), 0);
    const heroes = this.heroes().filter((h) => h.pc && !h.dead).length;
    const names = [...new Set(fallen.map((c) => c.name.replace(/ \d+$/, "")))].join(", ");
    this.awardXp(shareXp(total, heroes), `${names} besiegt`);
  }

  /** A chapter is done: every living hero gets one attribute point (spent on the phone). */
  chapterDone(): void {
    const heroes = this.heroes().filter((h) => h.pc && !h.dead);
    for (const h of heroes) {
      h.pc!.chapters = (h.pc!.chapters ?? 0) + 1;
      if (h.playerId) this.sendTo(h.playerId, { type: "action_error", reason: "💪 Kapitel geschafft: ein neuer Attributspunkt! (Tab „Figur“)" });
    }
    if (heroes.length) this.addLog([{ text: "💪 Kapitel geschafft – jeder Held bekommt einen Attributspunkt.", glossarKeys: ["attribute"] }]);
    this.broadcast();
  }

  /** Heroes with enough EP reach the next level (keeping their wounds; one attribute point each). */
  private applyLevels(): void {
    let changed = false;
    for (const h of this.heroes()) {
      if (!h.pc || h.dead) continue;
      const target = Math.min(MAX_LEVEL, levelForXp(h.pc.xp ?? 0));
      if (target <= h.pc.level) continue;
      this.levelHero(h, target, true);
      changed = true;
      this.narrate([{ text: `⬆️ ${h.name} erreicht Stufe ${target}!` }]);
    }
    if (changed) this.broadcast();
  }

  /** Builds the hero anew at this level (with points spent); keeps items, gear, wounds if asked. */
  private levelHero(h: Creature, level: number, keepHp: boolean, reward = true): Creature {
    {
      const pc = h.pc!;
      const next = createCharacter({ id: h.id, name: h.name, classId: pc.classId, raceId: pc.raceId, level, chapters: pc.chapters ?? 0, ...(pc.improvements ? { improvements: pc.improvements } : {}) });
      next.playerId = h.playerId;
      next.appearance = h.appearance;
      next.pos = h.pos;
      if (h.traits.includes("dorfschmiede")) next.traits.push("dorfschmiede");
      // Keep found items (potions, gold, the lance).
      for (const item of pc.inventory) {
        const own = next.pc!.inventory.find((i) => i.itemId === item.itemId);
        if (own) own.qty = Math.max(own.qty, item.qty);
        else next.pc!.inventory.push({ ...item });
      }
      // Keep the equipment (worn pieces go back on) and the hero book history.
      if (pc.gear && next.appearance) {
        const look = { ...next.appearance.look } as Record<string, string | undefined>;
        for (const [layer, v] of Object.entries(pc.gear.lookBefore ?? {})) look[layer] = v;
        next.appearance = { ...next.appearance, look: look as typeof next.appearance.look };
        applyGear(next, pc.gear);
      }
      if (pc.stories) next.pc!.stories = [...pc.stories];
      if (pc.badges) next.pc!.badges = [...pc.badges];
      if (pc.totals) next.pc!.totals = { ...pc.totals };
      next.pc!.xp = pc.xp ?? 0;
      if (pc.chapters) next.pc!.chapters = pc.chapters;
      if (keepHp) {
        next.hp = Math.min(next.maxHp, h.hp + Math.max(0, next.maxHp - h.maxHp));
        next.conditions = [...h.conditions];
        next.effects = [...h.effects];
      }
      this.battle.creatures[h.id] = next;
      if (reward) {
        const gained = levelGains(h, next);
        const points = pointsDue(level, pc.chapters ?? 0) - pointsSpent(next.pc!.improvements);
        this.reward(next, { kind: "level", heroId: h.id, name: h.name, ...(h.appearance ? { color: h.appearance.color } : {}), level, ...gained, ...(points > 0 ? { points } : {}) });
      }
      return next;
    }
  }

  /** Gives an item to one hero (or all). */
  giveItem(itemId: string, qty: number, to?: Creature): void {
    for (const h of to ? [to] : this.heroes()) this.addItem(h, itemId, qty);
  }

  // ---------------------------------------------------------------- choices

  /** How an attack on this target looks right now: chance (with advantage/disadvantage), distance bonus, the reason. */
  private attackOdds(me: Creature, t: Creature, option: AttackOption, toHit: number, movedFt?: number): { t: Creature; chance: number; mode: "advantage" | "disadvantage" | "normal"; bonus?: BreakdownPart; why?: string } {
    const reasons = attackReasons(this.battle, me, t, option);
    const adv = reasons.find((r) => r.effect === "advantage");
    const dis = reasons.find((r) => r.effect === "disadvantage");
    const mode = adv && !dis ? "advantage" : dis && !adv ? "disadvantage" : "normal";
    const bonus = rangeBonuses(this.battle, me, t, option, movedFt)[0];
    const why = mode === "disadvantage" ? `⚠️ ${dis!.text}` : mode === "advantage" ? `✨ ${adv!.text}` : undefined;
    return { t, chance: withMode(hitChance(toHit, armorClass(t)), mode), mode, ...(bonus ? { bonus } : {}), ...(why ? { why } : {}) };
  }

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
    // Monks fight with their fists (Martial Arts), a druid in wolf shape bites.
    const wolf = me.effects.some((e) => e.id === "wild-shape");
    const kiLeft = pc.resources["ki"] ? pc.resources["ki"].max - pc.resources["ki"].used : 0;
    for (const option of me.attacks.filter((a) => (wolf ? a.id === "wolf-bite" : a.id !== "wolf-bite" && (a.source !== "unarmed" || pc.classId === "monk")))) {
      const targets = enemies.filter((e) => inRange(me, e, option));
      const toHit = sumParts(option.toHit);
      const dmg = `${option.damage.map((d) => d.dice.replace("d", "W")).join(" + ")}${sumParts(option.damageBonus) ? ` + ${sumParts(option.damageBonus)}` : ""}`;
      const reason = costReason("action") ?? (targets.length ? undefined : enemies.length ? "Kein Gegner in Reichweite. Geh näher heran." : "Hier ist kein Gegner.");
      // Per target: advantage/disadvantage and the distance bonus, so each weapon shows where it is good.
      const odds = targets.map((t) => this.attackOdds(me, t, option, toHit));
      const best = [...odds].sort((a, b) => b.chance * (1 + (b.bonus?.value ?? 0) / 8) - a.chance * (1 + (a.bonus?.value ?? 0) / 8))[0];
      const edge: ActionChoice["edge"] | undefined = best?.bonus
        ? { text: `${best.bonus.label === "Anlauf" ? "💨" : "🎯"} ${best.bonus.label} +${best.bonus.value}`, tone: "good" }
        : best?.mode === "disadvantage"
          ? { text: `⚠️ Nachteil: ${best.why?.replace(/^⚠️ /, "")}`, tone: "bad" }
          : best?.mode === "advantage"
            ? { text: `✨ Vorteil: ${best.why?.replace(/^✨ /, "")}`, tone: "good" }
            : undefined;
      choices.push({
        id: `attack:${option.id}`,
        group: "attack",
        label: option.id === "unarmed" ? "👊 Waffenloser Schlag" : option.id === "wolf-bite" ? "🐺 Wolfsbiss" : `${nameOf("weapons", option.sourceId)}`,
        detail: `${toHit >= 0 ? "+" : ""}${toHit} zum Treffen · ${dmg} Schaden${option.kind === "ranged" ? " · Fernkampf" : option.thrown ? " · auch werfen" : ""}`,
        glossarKey: `waffe:${option.sourceId}`,
        cost: "action",
        enabled: !reason,
        ...(reason ? { reason } : {}),
        action: { kind: "attack", targetId: "", optionId: option.id },
        targets: odds.map(({ t, chance, bonus, why }) => ({ id: t.id, name: t.name, detail: `RK ${armorClass(t)} · ${Math.round(distanceFt(me, t) / 5)} Felder · ${Math.round(chance * 100)} %${bonus ? ` · +${bonus.value} ${bonus.label}` : ""}${why ? ` · ${why}` : ""}${this.typeHint(t, option.damage.map((d) => d.type))}`, chance })),
        ...(odds.length ? { chance: best!.chance } : {}),
        avg: option.damage.reduce((sum, d) => sum + averageOf(d.dice), 0) + sumParts(option.damageBonus) + (best?.bonus?.value ?? 0),
        ...(edge ? { edge } : {}),
      });
      if (pc.features.includes("stunning-strike") && option.kind === "melee" && kiLeft > 0) {
        choices.push({
          id: `stun:${option.id}`,
          group: "attack",
          label: `${option.id === "unarmed" ? "Faust" : nameOf("weapons", option.sourceId)} + Betäubender Schlag`,
          detail: "Bei einem Treffer 1 Ki: Rettungswurf auf Konstitution, sonst verliert der Gegner seinen Zug",
          glossarKey: "merkmal:stunning-strike",
          cost: "action",
          enabled: !reason,
          ...(reason ? { reason } : {}),
          action: { kind: "attack", targetId: "", optionId: option.id, stun: true },
          targets: targets.map((t) => ({ id: t.id, name: t.name, detail: `RK ${armorClass(t)}` })),
        });
      }
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

    // No enemy within reach of the melee weapon, but one can be reached this turn: walk there and strike in one go.
    if (this.mode === "combat" && mine && me.pos && (turn?.movementLeftFt ?? 0) > 0) {
      const melee = me.attacks
        .filter((a) => a.kind === "melee" && (wolf ? a.id === "wolf-bite" : a.id !== "wolf-bite" && (a.source !== "unarmed" || pc.classId === "monk")))
        .sort((a, b) => b.damage.reduce((s2, d) => s2 + averageOf(d.dice), 0) - a.damage.reduce((s2, d) => s2 + averageOf(d.dice), 0))[0];
      const inReach = melee ? enemies.some((e) => inRange(me, e, melee)) : true;
      if (melee && !inReach) {
        const reach = this.reachable(me);
        const gap = (p: GridPos, e: Creature) => {
          const n = sizeInSquares(e.size);
          const dx = Math.max(0, e.pos!.x - p.x, p.x - (e.pos!.x + n - 1));
          const dy = Math.max(0, e.pos!.y - p.y, p.y - (e.pos!.y + n - 1));
          return Math.max(dx, dy);
        };
        const reachable = enemies.filter((e) => e.pos && reach.some((p) => gap(p, e) <= Math.max(1, Math.floor(melee.reachFt / 5))));
        if (reachable.length) {
          const toHit = sumParts(melee.toHit);
          const dmg = `${melee.damage.map((d) => d.dice.replace("d", "W")).join(" + ")}${sumParts(melee.damageBonus) ? ` + ${sumParts(melee.damageBonus)}` : ""}`;
          const reason = costReason("action");
          choices.push({
            id: `approach:${melee.id}`,
            group: "attack",
            label: `🦶⚔️ ${melee.id === "unarmed" ? "Faust" : melee.id === "wolf-bite" ? "Wolfsbiss" : nameOf("weapons", melee.sourceId)}: hin und zuschlagen`,
            detail: `${toHit >= 0 ? "+" : ""}${toHit} zum Treffen · ${dmg} Schaden · erst hinlaufen, dann Angriff`,
            glossarKey: `waffe:${melee.sourceId}`,
            cost: "action",
            enabled: !reason,
            ...(reason ? { reason } : {}),
            recommended: !choices.some((c) => c.group === "attack" && c.enabled),
            action: { kind: "approach", targetId: "", optionId: melee.id },
            // A long enough run-up hits harder.
            ...(reachable.some((e) => (gap(me.pos!, e) - 1) * 5 + (turn?.movedFt ?? 0) >= RUN_UP_FT) ? { edge: { text: "💨 mit Anlauf +2", tone: "good" as const } } : {}),
            targets: reachable.map((t) => ({ id: t.id, name: t.name, detail: `RK ${armorClass(t)} · ${Math.round(hitChance(toHit, armorClass(t)) * 100)} %`, chance: hitChance(toHit, armorClass(t)) })),
            chance: Math.max(...reachable.map((t) => hitChance(toHit, armorClass(t)))),
            avg: melee.damage.reduce((sum, d) => sum + averageOf(d.dice), 0) + sumParts(melee.damageBonus),
          });
        }
      }
    }

    // Spells
    for (const spellId of pc.spells) {
      const spell = getSpell(spellId);
      // No slot of the spell's own level left: a higher one is used (stronger, where the spell allows).
      let slot = spell.level;
      if (slot && (pc.spellSlots[slot - 1] ?? 0) <= 0) {
        const higher = pc.spellSlots.findIndex((n, i) => i + 1 > spell.level && n > 0);
        if (higher >= 0) slot = higher + 1;
      }
      const cost = spell.castingTime === "bonus" ? "bonus" : "action";
      const slotsLeft = slot ? (pc.spellSlots[slot - 1] ?? 0) : Infinity;
      const range = spell.rangeFt === "touch" ? 5 : spell.rangeFt === "self" ? (spell.area?.sizeFt ?? 0) : spell.rangeFt;
      const healing = !!spell.heal || spell.id === "bless" || spell.id === "shield-of-faith";
      const upcast = slot > spell.level && spell.level > 0 ? ` · mit Platz Grad ${slot}` : "";
      let pool = healing ? allies : enemies;
      if (spell.id === "divine-favor") pool = [me];
      const targets = pool.filter((t) => t.id === me.id || distanceFt(me, t) <= range);
      const n = maxTargets(spell, slot || 1);
      const repeat = spell.id === "magic-missile" || spell.id === "scorching-ray";
      const area = spell.id === "burning-hands" || spell.id === "sleep" || spell.id === "thunderwave";
      const reason =
        costReason(cost) ??
        (slotsLeft <= 0 ? "Keine Zauberplätze mehr. Sie kommen nach einer langen Rast zurück." : targets.length ? undefined : healing ? "Niemand in Reichweite." : "Kein Ziel in Reichweite.");
      const kurz = (spell.level === 0 ? "Zaubertrick · " : `Grad ${spell.level} · `) + (cost === "bonus" ? "Bonusaktion" : "Aktion");
      const choice: ActionChoice = {
        id: `spell:${spellId}`,
        group: "spell",
        label: nameOf("spells", spellId),
        detail: `${kurz}${slot ? ` · noch ${slotsLeft} Platz${slotsLeft === 1 ? "" : "e"}` : ""}${upcast}${spell.id === "fireball" ? " · trifft alle Gegner im Umkreis von 4 Feldern um das Ziel" : ""}`,
        glossarKey: `zauber:${spellId}`,
        cost,
        enabled: !reason,
        ...(reason ? { reason } : {}),
        action: { kind: "cast", spellId, ...(slot > spell.level ? { slotLevel: slot } : {}), targetIds: area ? targets.map((t) => t.id) : [] },
      };
      const spellHit = spell.attack ? sumParts(spellAttackParts(me, spellId)) : undefined;
      const dice = spellDice(spell.damage, slot, pc.level);
      if (dice) choice.avg = averageOf(dice);
      else if (spell.heal) {
        const heal = spell.heal[String(slot)] ?? Object.values(spell.heal)[0];
        if (heal) {
          choice.avg = averageOf(heal);
          choice.avgKind = "heal";
        }
      }
      if (!area && spell.id !== "divine-favor") {
        choice.targets = targets.map((t) => ({ id: t.id, name: t.id === me.id ? `${t.name} (du)` : t.name, detail: `TP ${t.hp}/${t.maxHp}${spellHit !== undefined ? ` · ${Math.round(hitChance(spellHit, armorClass(t)) * 100)} %` : ""}`, ...(spellHit !== undefined ? { chance: hitChance(spellHit, armorClass(t)) } : {}) }));
        if (spellHit !== undefined && targets.length) choice.chance = Math.max(...targets.map((t) => hitChance(spellHit, armorClass(t))));
        choice.pick = { min: 1, max: n, repeat };
      } else if (spell.id === "divine-favor") {
        choice.action = { kind: "cast", spellId, targetIds: [me.id] };
      }
      // Validate the automatic part (area spells) with the engine.
      if (choice.enabled && area) {
        const err = validateCast(this.battle, me, { spellId, ...(slot > spell.level ? { slotLevel: slot } : {}), targetIds: targets.map((t) => t.id) });
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

    choices.push(...this.customItemChoices(me, enemies, mine, costReason));

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
    if (res["bardic-inspiration"]) {
      const left = res["bardic-inspiration"].max - res["bardic-inspiration"].used;
      const friends = allies.filter((a) => a.id !== me.id && distanceFt(me, a) <= 60 && !a.effects.some((e) => e.id === "helped"));
      feature(
        "bardic-inspiration",
        `Bardische Inspiration (${left} übrig)`,
        "Ein Freund bekommt Vorteil auf seinen nächsten Wurf · Bonusaktion",
        "merkmal:bardic-inspiration-d6",
        "bonus",
        { kind: "feature", feature: "bardic-inspiration" },
        { targets: friends.map((t) => ({ id: t.id, name: t.name, detail: `TP ${t.hp}/${t.maxHp}` })), pick: { min: 1, max: 1, repeat: false } },
        left <= 0 ? "Aufgebraucht. Kommt nach einer Rast zurück." : friends.length ? undefined : "Kein Freund in 12 Feldern (oder alle sind schon inspiriert).",
      );
    }
    if (res["wild-shape"]) {
      const left = res["wild-shape"].max - res["wild-shape"].used;
      feature("wild-shape", `🐺 Tiergestalt: Wolf (${left} übrig)`, "+11 Trefferpunkte als Wolf, Biss +4 (2W4 + 2) · keine Zauber, solange du Wolf bist", "merkmal:wild-shape", "action", { kind: "feature", feature: "wild-shape" }, undefined, wolf ? "Du bist schon ein Wolf." : left <= 0 ? "Aufgebraucht. Kommt nach einer Rast zurück." : undefined);
    }
    if (pc.features.includes("martial-arts") && this.mode === "combat") {
      const fist = me.attacks.find((a) => a.id === "unarmed");
      const near = fist ? enemies.filter((e) => inRange(me, e, fist)) : [];
      const attacked = !!turn?.attacked;
      const needAttack = attacked ? undefined : "Erst mit der Aktion angreifen – dann kommt der Extraschlag.";
      const targets = { targets: near.map((t) => ({ id: t.id, name: t.name, detail: `RK ${armorClass(t)}` })), pick: { min: 1, max: 1, repeat: false } };
      feature("martial-arts", "👊 Kampfkunst: Extraschlag", "Ein waffenloser Schlag · Bonusaktion", "merkmal:martial-arts", "bonus", { kind: "feature", feature: "martial-arts" }, targets, needAttack ?? (near.length ? undefined : "Kein Gegner direkt neben dir."));
      if (pc.resources["ki"]) {
        feature("flurry-of-blows", `👊👊 Schlaghagel (1 Ki, ${kiLeft} übrig)`, "Zwei waffenlose Schläge · Bonusaktion", "merkmal:flurry-of-blows", "bonus", { kind: "feature", feature: "flurry-of-blows" }, targets, kiLeft <= 0 ? "Kein Ki mehr. Kommt nach einer Rast zurück." : needAttack ?? (near.length ? undefined : "Kein Gegner direkt neben dir."));
        feature("patient-defense", `🧘 Geduldige Abwehr (1 Ki)`, "Angriffe gegen dich haben Nachteil · Bonusaktion", "merkmal:patient-defense", "bonus", { kind: "feature", feature: "patient-defense" }, undefined, kiLeft <= 0 ? "Kein Ki mehr." : undefined);
        feature("step-of-the-wind", `🌬️ Schritt des Windes (1 Ki)`, "Doppelte Bewegung · Bonusaktion", "merkmal:step-of-the-wind", "bonus", { kind: "feature", feature: "step-of-the-wind" }, undefined, kiLeft <= 0 ? "Kein Ki mehr." : undefined);
      }
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
      choices.push(...this.objectChoices(me, o, enemies, mine, costReason));
    }
    // Stray animals next to you can be tamed.
    for (const c of Object.values(this.battle.creatures)) {
      if (!c.wild || c.dead || !c.pos || !me.pos || Math.max(Math.abs(c.pos.x - me.pos.x), Math.abs(c.pos.y - me.pos.y)) > 1) continue;
      const def = COMPANIONS[c.wild];
      const has = def.lure.itemId ? (pc.inventory.find((i) => i.itemId === def.lure.itemId)?.qty ?? 0) > 0 : this.goldOf(me) >= (def.lure.gold ?? 0);
      const reason = notMine ?? (this.mode === "combat" ? "Nicht mitten im Kampf." : this.companionOf(me) ? "Du hast schon einen Begleiter." : has ? undefined : `Dafür brauchst du: ${def.lure.label}.`);
      choices.push({ id: `tame:${c.id}`, group: "look", label: `${def.icon} ${def.name} zähmen`, detail: `Mit Tieren umgehen SG ${this.sg(def.dc)} · kostet ${def.lure.label}`, glossarKey: "begleiter", cost: "free", enabled: !reason, ...(reason ? { reason } : {}), recommended: !reason, action: { kind: "tame", creatureId: c.id } });
    }
    // Oil puddles and bones next to you can be picked up.
    if (me.pos) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const p = { x: me.pos.x + dx, y: me.pos.y + dy };
          if (p.x < 0 || p.y < 0 || p.x >= this.map.width || p.y >= this.map.height) continue;
          const i = cellIndex(this.map, p.x, p.y);
          const cost = this.mode === "combat" ? "action" : "free";
          const reason = cost === "free" ? notMine : costReason("action");
          if (this.map.surface?.[i]?.kind === "oil" && !choices.some((c) => c.id === "ground:oil")) choices.push({ id: "ground:oil", group: "look", label: "🫙 Öl abfüllen", detail: "Eine Ölflasche zum Ausgießen oder Brauen", glossarKey: "gegenstand:oelflasche", cost, enabled: !reason, ...(reason ? { reason } : {}), action: { kind: "ground", use: "oil", x: p.x, y: p.y } });
          if (this.map.decals?.[i] === "bones" && !choices.some((c) => c.id === "ground:bones")) choices.push({ id: "ground:bones", group: "look", label: "🦴 Knochen aufheben", detail: "Damit kann man Hunde und Wölfe zähmen", glossarKey: "gegenstand:knochen", cost, enabled: !reason, ...(reason ? { reason } : {}), action: { kind: "ground", use: "bones", x: p.x, y: p.y } });
        }
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
/** The damage dice of a spell at this slot (or character level for cantrips). */
function spellDice(d: { byCharLevel?: Record<string, string>; bySlot?: Record<string, string> } | undefined, slot: number, level: number): string | undefined {
  if (!d) return undefined;
  if (d.bySlot) return d.bySlot[String(slot)] ?? Object.values(d.bySlot)[0];
  if (d.byCharLevel) {
    const keys = Object.keys(d.byCharLevel).map(Number).filter((k) => k <= level).sort((a, b) => b - a);
    return d.byCharLevel[String(keys[0] ?? Object.keys(d.byCharLevel)[0])];
  }
  return undefined;
}

/** Chance that a d20 + bonus reaches the armour class (a 1 always misses, a 20 always hits). */
/** Chance with advantage (two dice, the better) or disadvantage (the worse). */
function withMode(p: number, mode: "advantage" | "disadvantage" | "normal"): number {
  return mode === "advantage" ? 1 - (1 - p) * (1 - p) : mode === "disadvantage" ? p * p : p;
}

function hitChance(bonus: number, ac: number): number {
  return Math.min(0.95, Math.max(0.05, (21 - (ac - bonus)) / 20));
}

/** Brewed and tinkered things with their own use (see useCustomItem). */
const CUSTOM_ITEMS = ["leuchttrank", "staerketrank", "stolperdraht", "oelflasche", "brandflasche"];

/** What the weather means, told when a map begins. */
const WEATHER_NOTE: Record<string, string> = {
  rain: "🌧️ Es regnet: Draußen bilden sich Pfützen, und Feuer erlischt schnell.",
  fog: "🌫️ Dichter Nebel: Draußen haben Fernangriffe auf mehr als 6 Felder Nachteil.",
  wind: "🌬️ Starker Wind: Draußen treffen Pfeile und Bolzen schlechter (−2), und Feuer breitet sich schneller aus.",
  snow: "❄️ Es schneit: Pfützen draußen sind zu Eis gefroren – Vorsicht, rutschig!",
};

/** A coin for the wishing well. */
const WISH_GOLD = 5;

/** What the heroes read in bookshelves (Harz legends and small jokes). */
const BOOK_LORE = [
  "Wer auf dem Brocken dreimal rückwärts um den Hexenaltar läuft, hört die Hexen lachen.",
  "Die Rosstrappe: Hier soll eine Königstochter mit ihrem Pferd über die Bode gesprungen sein. Der Hufabdruck ist noch im Stein.",
  "Rezept: Harzer Käse. Man nehme Quark und sehr viel Geduld. Und eine Nase, die nicht so empfindlich ist.",
  "Der Teufel baute eine Mauer im Harz – aber der Hahn krähte zu früh, und er musste fliehen.",
  "Bergleute grüßen sich mit „Glück auf!“, denn unter Tage braucht man jede Menge davon.",
  "Kobolde lieben glänzende Knöpfe. Wer einen verliert, sollte unter der Treppe nachsehen.",
  "Werwölfe fürchten Silber. Und laute Kinderlieder, sagt man.",
  "Die Walpurgisnacht ist die Nacht vor dem ersten Mai. Dann tanzen die Hexen auf dem Brocken.",
  "Ein Tagebuch: „Tag 3. Die Ratten sind schlauer als ich dachte. Sie haben meinen Käse. Schon wieder.“",
];

const SPELL_FX: Record<string, Pick<ActionFx, "kind" | "element">> = {
  "fire-bolt": { kind: "spell", element: "fire" },
  "ray-of-frost": { kind: "spell", element: "cold" },
  "sacred-flame": { kind: "spell", element: "radiant" },
  "magic-missile": { kind: "spell", element: "force" },
  "burning-hands": { kind: "breath", element: "fire" },
  "guiding-bolt": { kind: "spell", element: "radiant" },
  "scorching-ray": { kind: "spell", element: "fire" },
  fireball: { kind: "spell", element: "fire" },
  "produce-flame": { kind: "spell", element: "fire" },
  "vicious-mockery": { kind: "spell", element: "force" },
  thunderwave: { kind: "breath", element: "force" },
  "hunters-mark": { kind: "buff", element: "radiant" },
  "mass-healing-word": { kind: "heal" },
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
    case "strikes":
      return o.attacks.map(fromAttack);
    case "boost":
      return [{ from: actor.id, to: [o.targetId], kind: "buff", element: o.what === "wild-shape" ? "poison" : "radiant" }];
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
    case "strikes":
      o.attacks.forEach(fromAttack);
      break;
  }
  return hits;
}

/** How dangerous an enemy is for this hero: its strongest hit and its toughness against the hero's. */
function dangerFor(me: Creature, enemy: Creature): "leicht" | "gefährlich" | "sehr gefährlich" {
  const hit = Math.max(0, ...enemy.attacks.map((a) => a.damage.reduce((sum, d) => sum + averageOf(d.dice), 0) + sumParts(a.damageBonus)));
  const score = hit / Math.max(1, me.maxHp) + enemy.maxHp / Math.max(1, me.maxHp) / 3;
  return score >= 0.9 ? "sehr gefährlich" : score >= 0.45 ? "gefährlich" : "leicht";
}
