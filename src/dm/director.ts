/**
 * Runs a story on the host: scene after scene, step after step.
 * The director owns the rules of the story (flags, clues, fights, endings);
 * the DungeonMaster (scripted or AI) tells it and makes the "creative" decisions.
 */
import { CLUE_XP } from "../shared/progression";
import { familyAfterAdventure, familyFarewell, STAGE_LABEL, holdWeddings, partnerOf, proposalAnswer, attractedTo, bondOf, canDate, changeBond, changeLove, flirtDc, flirtLine, flirtResult, genderOf, giftValue, greetingFor, IN_LOVE, loveOf, markDate, meet, mindPrompt, remember, type FlirtOutcome, type NpcMind, type NpcWorld } from "./npc-world";
import { applyDamage, distanceFt, isActive } from "../engine/combat";
import { savingThrow, skillParts, sumParts } from "../engine/core";
import { parseDice, rollDice } from "../engine/dice";
import { nameOf } from "../engine/names";
import type { Rng } from "../engine/rng";
import { generateWithRetries } from "../map/generate";
import type { DmContext, DmResponse, DmTrigger, DungeonMaster } from "../shared/dm";
import type { Creature } from "../shared/game";
import { cellIndex, type Weather } from "../shared/map";
import type { SagaCarry, SagaNpc } from "../shared/homeland";
import { pickRoutes, type TravelRoute } from "../shared/travel";
import type { Duration, MonsterGroup, Narration, Outcome, Scene, Step, Story, StoryChoice } from "../shared/story";
import type { PlayerId } from "../shared/types";
import type { GameController } from "../tv/game";
import { actOf, planScenes, plannedMinutes, sceneById, sceneRooms, tempoCheck } from "./planner";
import { pickEnding } from "./scripted";
import { resolveClue, validateResponse } from "./validate";
import { filterEffects } from "./effects";
import { glossaryAnswer, glossaryExcerpt, heroSummary } from "./rules-help";
import { SKILL_IDS, type SkillId } from "../shared/rules";
import { World } from "./world";
import { buildHighlights, type Recap } from "../shared/recap";
import type { Difficulty } from "../shared/difficulty";
import { getGear } from "../data/gear";
import { seededRng } from "../engine/rng";
import type { CampOffer } from "../tv/game";

/** Lines that only tell the group what to do ("Geht zur Wirtin.") are not read out: they find out themselves. */
const DIRECTION = /^(geht (zu|zum|zur|ganz|nach)|lauft (bis|zu|zum|zur)|schaut euch eure hinweise|sucht (den|die|das)\b)/i;

export interface StoryState {
  storyId: string;
  duration: Duration;
  truth: string;
  plan: string[];
  sceneIndex: number;
  flags: string[];
  clues: string[];
  twistRevealed: boolean;
  eventsUsed: string[];
  dropped: string[];
  /** Minutes played before this session (after loading a save). */
  minutesBefore: number;
  ending?: string;
  /** Short memory of notable free actions, newest last (for the game master). */
  chronicle?: string[];
  /** Dice seed for the travel map (drawn once per game from the story dice). */
  travelSeed?: number;
  /** Attitude of story characters towards the group, −3 … +3. */
  attitudes?: Record<string, number>;
  /** What the heroes told at the campfire (the game master weaves it in later). */
  tales?: string[];
  /** Secret goal of each hero (hero id → goal id). */
  goals?: Record<string, string>;
  /** The final blow against the boss (for the look back). */
  finalBlow?: { heroId: string; name: string; boss: string; text: string; narration: string };
  /** How tough the world is (older saves: normal). */
  difficulty?: Difficulty;
  /** This adventure, for the characters' memory ("we have met before"). */
  adventureId?: string;
}

export interface StoryResult {
  ending: { id: string; title: string; kind: string; text: Narration[] };
  truth: { id: string; title: string; summary: string };
  found: { text: string; falseLead: boolean }[];
  missed: { text: string }[];
  /** Highlights and numbers of the heroes. */
  recap: Recap;
  /** For the saga: who became a friend, who got away. */
  homeland?: { ally?: SagaNpc; nemesis?: SagaNpc; heroes: string[] };
  /** Filled in by the board: what the village got. */
  village?: { income: number; gold: number; ally?: string | undefined; nemesis?: string | undefined };
}

export interface DirectorOptions {
  duration: Duration;
  truth?: string;
  now?: () => number;
  /** A scene begins: store this state. `announce` at the real save points of long games. */
  onSave?: (state: StoryState, announce: boolean) => void;
  onEnd?: (result: StoryResult) => void;
  /** The living world: random events, greetings, time pressure, sleeping enemies (not in tests). */
  world?: boolean;
  /** Rest at the campfire between chapters (default on). */
  camp?: boolean;
  /** The player who defeats the final boss describes the blow (default on). */
  finalBlow?: boolean;
  /** Before a boss fight the heroes may prepare an ambush (default on). */
  ambush?: boolean;
  /** Between chapters the group picks a route on the Harz map (default on). */
  travel?: boolean;
  /** What earlier adventures bring along (old friends, old foes). */
  saga?: SagaCarry;
  /** At the end of a scene the group votes when to move on (default on). */
  leaveVote?: boolean;
  /** The memory of the world: every character one person for good (stored on the TV). */
  npcs?: { world: NpcWorld; save: () => void; onMeet?: (mind: NpcMind) => void };
}

/** Questions at the campfire: small, personal, easy to answer for beginners. */
export const CAMP_QUESTIONS = [
  "Warum bist du auf diese Reise gegangen?",
  "Wovor hast du heimlich Angst?",
  "Was vermisst du von zu Hause am meisten?",
  "Was machst du mit deinem Anteil am Schatz?",
  "Woher hast du deine auffälligste Narbe (oder dein Lieblingsstück)?",
  "Was war heute dein schönster Moment?",
  "Wem in der Gruppe vertraust du am meisten – und warum?",
  "Was war der peinlichste Moment deines Lebens?",
  "Wen möchtest du nach dem Abenteuer als Erstes wiedersehen?",
  "Welches Versprechen hast du jemandem gegeben?",
  "Was ist dein größter Traum?",
  "Was kannst du richtig gut, was die anderen noch nicht wissen?",
];
/** The player has this long to describe the final blow (seconds). */
const FINAL_BLOW_S = 90;
/** The campfire ends after this long even if not everyone tapped "Weiter". */
const CAMP_MINUTES = 5;

export function newStoryState(story: Story, rng: Rng, duration: Duration, truth?: string): StoryState {
  return {
    storyId: story.id,
    duration,
    truth: truth ?? story.truths[rng.int(0, story.truths.length - 1)]!.id,
    plan: planScenes(story, duration),
    sceneIndex: 0,
    flags: [],
    clues: [],
    twistRevealed: false,
    eventsUsed: [],
    dropped: [],
    minutesBefore: 0,
  };
}

const HERO_SPOT = 1; // squares: "next to"

export class Director {
  private startedAt: number;
  private now: () => number;
  private scene!: Scene;
  private stepId: string | undefined;
  private lowestHpRatio = 1;
  /** Surroundings of the hero doing a free action (for the DM's ideas). */
  private actingRoom: { name: string; objects: string[] } | undefined;
  finished = false;
  private world: World | undefined;
  /** Characters of the current scene (name → mind) and everyone met in this adventure. */
  private minds = new Map<string, NpcMind>();
  private metMinds = new Map<string, NpcMind>();
  private greeted = new Set<string>();

  constructor(
    readonly story: Story,
    readonly state: StoryState,
    private game: GameController,
    private dm: DungeonMaster,
    private rng: Rng,
    private opts: DirectorOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.startedAt = this.now();
    game.onFreeText = (playerId, hero, text) => void this.freeText(playerId, hero, text);
    game.onBookClue = () => this.bookClue();
    game.onSuggest = (playerId, hero) => this.suggest(playerId, hero);
    game.onAskRules = (playerId, hero, question) => this.askRules(playerId, hero, question);
    game.onRoundEnd = () => this.world?.roundEnded();
    game.onFlirt = (playerId, hero, name) => void this.flirt(playerId, hero, name);
    game.onGift = (_playerId, hero, name, itemId, itemName) => this.gift(hero, name, itemId, itemName);
    game.onPropose = (playerId, hero, name) => this.propose(playerId, hero, name);
    if (opts.world) {
      this.world = new World({
        game,
        rng,
        story,
        duration: opts.duration,
        scene: () => this.scene,
        now: this.now,
        attitude: (npcId) => this.state.attitudes?.[npcId] ?? 0,
        fight: (groups) => this.fight(groups, false, false),
        changeGold: (amount) => this.changeGold(amount),
        remember: (entry) => this.remember(entry),
        nudge: async () => {
          if (this.finished) return;
          await this.askDm({ kind: "idle", seconds: Math.round((this.now() - this.game.lastActionAt) / 1000) });
        },
      });
    }
  }

  // ---------------------------------------------------------------- helpers

  private has(flag: string): boolean {
    return this.state.flags.includes(flag);
  }

  private set(flags: string[] | undefined): void {
    for (const f of flags ?? []) if (!this.has(f)) this.state.flags.push(f);
  }

  private heroes(): Creature[] {
    return this.game.heroes();
  }

  minutesPlayed(): number {
    return this.state.minutesBefore + (this.now() - this.startedAt) / 60000;
  }

  private ctx(): DmContext {
    const heroes = this.heroes();
    const hardship = heroes.length ? 1 - this.lowestHpRatio : 0;
    return {
      storyId: this.story.id,
      duration: this.state.duration,
      truth: this.state.truth,
      sceneId: this.scene.id,
      ...(this.stepId ? { stepId: this.stepId } : {}),
      sceneIndex: this.state.sceneIndex,
      sceneCount: this.state.plan.length,
      players: heroes.map((h) => ({ id: h.playerId ?? h.id, name: h.name, classId: h.pc?.classId ?? "", hp: h.hp, maxHp: h.maxHp })),
      flags: [...this.state.flags],
      cluesFound: [...this.state.clues],
      twistRevealed: this.state.twistRevealed,
      minutesPlayed: this.minutesPlayed(),
      minutesPlanned: plannedMinutes(this.story, this.state.plan.slice(0, this.state.sceneIndex + 1)),
      hardship,
      eventsUsed: [...this.state.eventsUsed],
      ...(this.game.mode === "combat" ? { combat: { enemies: this.game.enemiesInFight() } } : {}),
      gold: this.game.partyGold(),
      chronicle: [...(this.state.chronicle ?? [])],
      attitudes: { ...(this.state.attitudes ?? {}) },
      ...(this.minds.size ? { minds: [...this.minds.values()].map((m) => mindPrompt(m, heroes.map((h) => h.name))) } : {}),
      tales: [...(this.state.tales ?? [])],
      ...(this.actingRoom ? { room: this.actingRoom } : {}),
    };
  }

  /** Asks the DM, validates the answer and applies the safe parts. */
  private async askDm(trigger: DmTrigger): Promise<DmResponse> {
    let raw: DmResponse;
    try {
      raw = await this.dm.respond(this.ctx(), trigger);
    } catch {
      raw = { narration: "", next: "await_action" };
    }
    const { response } = validateResponse(raw, { story: this.story, scene: this.scene, truth: this.state.truth, eventsUsed: this.state.eventsUsed });
    // Free text from the game master is kept short (read aloud in full; long texts lose the table).
    const lines: Narration[] = (response.script ?? (response.narration ? [{ text: shorten(response.narration, 2) }] : [])).filter((l) => l.npc || !DIRECTION.test(l.text));
    if (response.npc_say) lines.push({ npc: response.npc_say.name, text: response.npc_say.text });
    this.game.narrate(lines);
    if (response.reveal_twist) this.state.twistRevealed = true;
    this.set(response.set_flags);
    if (response.reveal_clue) this.addClue(response.reveal_clue);
    if (response.npc_attitude) {
      const { npc, change } = response.npc_attitude;
      const atts = (this.state.attitudes ??= {});
      atts[npc] = Math.max(-3, Math.min(3, (atts[npc] ?? 0) + change));
      const name = this.story.npcs.find((n) => n.id === npc)?.name ?? npc;
      if (change) this.game.narrate([{ text: change > 0 ? `💚 ${name} mag euch jetzt mehr.` : `💢 ${name} traut euch weniger.` }]);
      // Feelings last beyond this adventure: towards the hero who acted (or the whole group).
      const mind = this.minds.get(name) ?? this.metMinds.get(name);
      const actor = "heroName" in trigger ? trigger.heroName : undefined;
      if (mind && change) for (const h of actor ? [actor] : this.heroes().map((x) => x.name)) changeBond(mind, h, change * 2);
    }
    this.keepInMind(trigger, response);
    return response;
  }

  /** What the characters keep from an answer: the AI's own note, or at least what a hero said to them. */
  private keepInMind(trigger: DmTrigger, response: DmResponse): void {
    const w = this.opts.npcs;
    if (!w || !this.minds.size) return;
    let changed = false;
    const said = response.npc_say ? this.minds.get(response.npc_say.name) : undefined;
    if (response.npc_memory) {
      const mind = this.minds.get(response.npc_memory.name);
      if (mind) {
        remember(mind, response.npc_memory.fact);
        changed = true;
      }
    } else if (said && trigger.kind === "free_text") {
      remember(said, `${trigger.heroName} sagte zu mir: „${trigger.text.slice(0, 80)}“`);
      changed = true;
    }
    if (said && "heroName" in trigger && !(trigger.heroName in said.bond)) {
      said.bond[trigger.heroName] = 0;
      changed = true;
    }
    if (changed) w.save();
  }

  /** The scene's characters: known ones come back with their memory, new ones get a personality. */
  private meetCharacters(npcs: { id: string; name: string; monster: string }[]): void {
    const w = this.opts.npcs;
    this.minds.clear();
    if (!w) return;
    this.state.adventureId ??= `${this.story.id}-${this.startedAt}`;
    for (const n of npcs) {
      const { mind, returning } = meet(w.world, n.name, n.monster, this.state.adventureId, this.now());
      this.minds.set(n.name, mind);
      this.metMinds.set(n.name, mind);
      w.onMeet?.(mind);
      // What she feels about the group carries over: friends make things easier from the start.
      const bonds = this.heroes().map((h) => bondOf(mind, h.name));
      const atts = (this.state.attitudes ??= {});
      if (returning && atts[n.id] === undefined && bonds.some((b) => b !== 0)) {
        atts[n.id] = Math.max(-3, Math.min(3, Math.round(bonds.reduce((a, b) => a + b, 0) / bonds.length / 3)));
      }
    }
    w.save();
  }

  /** Flirted this scene (hero|character): she needs a moment before the next try. */
  private flirted = new Set<string>();

  private heroGender(hero: Creature): "female" | "male" {
    return hero.appearance?.gender ?? genderOf(hero.name);
  }

  /** 🌹 A flirt: a Charisma check (if she can fall for this hero at all), then her answer in her own way. */
  private async flirt(playerId: PlayerId, hero: Creature, name: string): Promise<void> {
    const w = this.opts.npcs;
    const mind = this.minds.get(name);
    if (!w || !mind || this.finished) {
      this.game.tellPlayer(playerId, `${name} hat gerade keinen Kopf dafür.`);
      return;
    }
    const lock = `${hero.name}|${name}|${this.scene.id}`;
    if (this.flirted.has(lock)) {
      this.game.tellPlayer(playerId, `Gib ${name} etwas Zeit – später wieder.`);
      return;
    }
    this.flirted.add(lock);
    const before = loveOf(mind, hero.name);
    let roll: { total: number; dc: number } | undefined;
    if (attractedTo(mind, this.heroGender(hero))) {
      const r = await this.game.check(hero, "persuasion", flirtDc(mind, hero.name), `🌹 Flirten mit ${name}`);
      roll = { total: r.total, dc: r.dc };
    }
    const res = flirtResult(mind, this.heroGender(hero), roll);
    if (res.love) changeLove(mind, hero.name, res.love);
    if (res.bond) changeBond(mind, hero.name, res.bond);
    const facts: Record<FlirtOutcome, string> = {
      not_interested: `${hero.name} hat mit mir geflirtet – aber daraus wird nichts.`,
      great: `${hero.name} hat mit mir geflirtet, und mein Herz hat gepocht.`,
      yes: `${hero.name} hat mit mir geflirtet, und es hat mir gefallen.`,
      no: `${hero.name} hat mit mir geflirtet, aber ich war nicht in Stimmung.`,
      too_much: `${hero.name} war mir gegenüber zu aufdringlich.`,
    };
    remember(mind, facts[res.outcome]);
    // Her answer: in her own words by the AI, or from her lines.
    const answer = await this.askDm({ kind: "npc_moment", playerId, heroName: hero.name, npc: name, what: "flirt", outcome: res.outcome });
    if (!answer.npc_say) this.game.narrate([{ npc: name, text: flirtLine(mind, hero.name, res.outcome, this.flirted.size) }]);
    const after = loveOf(mind, hero.name);
    if (before < IN_LOVE && after >= IN_LOVE) this.game.narrate([{ text: `💘 ${name} hat sich in ${hero.name} verguckt!` }]);
    else if (res.love) this.game.narrate([{ text: `🌹 ${name} und ${hero.name}: ${"❤".repeat(Math.max(1, Math.round(after / 2)))}` }]);
    w.save();
  }

  /** 🎁 A gift: what she likes counts triple; for someone in love it warms the heart too. */
  private gift(hero: Creature, name: string, itemId: string, itemName: string): void {
    const w = this.opts.npcs;
    const mind = this.minds.get(name);
    if (!w || !mind) return;
    const v = giftValue(mind, itemId, itemName);
    changeBond(mind, hero.name, v.bond);
    if (attractedTo(mind, this.heroGender(hero)) && (v.liked || loveOf(mind, hero.name) > 0)) changeLove(mind, hero.name, v.liked ? 2 : 1);
    remember(mind, `${hero.name} hat mir ${itemName} geschenkt${v.liked ? " – genau, was ich mag!" : "."}`);
    this.game.narrate([
      { npc: name, text: v.liked ? `Oh, ${itemName}! Woher wusstest du, dass ich das so mag, ${hero.name}?` : `Danke, ${hero.name}. Das ist lieb von dir.` },
      { text: v.liked ? `💚💚 ${name} freut sich riesig.` : `💚 ${name} freut sich.` },
    ]);
    w.save();
  }

  /** 💍 A proposal: she says yes only if she is very much in love and likes the hero; the wedding is at home. */
  private propose(playerId: PlayerId, hero: Creature, name: string): boolean {
    const w = this.opts.npcs;
    const mind = this.minds.get(name);
    if (!w || !mind) {
      this.game.tellPlayer(playerId, `${name} hat gerade keinen Kopf dafür.`);
      return false;
    }
    const answer = proposalAnswer(w.world, mind, hero.name, this.heroGender(hero));
    if (answer === "already_bound") {
      this.game.tellPlayer(playerId, `Du hast dein Herz schon an ${partnerOf(w.world, hero.name)!.mind.name} verschenkt.`);
      return false;
    }
    const lines: Record<Exclude<typeof answer, "already_bound">, string> = {
      yes: `Ja! Ja, ich will, ${hero.name}!`,
      too_soon: `Oh, ${hero.name} … das geht mir zu schnell. Gib uns noch etwas Zeit.`,
      not_interested: `Du bist ein wunderbarer Mensch, ${hero.name} – aber so empfinde ich nicht für dich.`,
      taken: `Ach, ${hero.name} … mein Herz gehört schon jemand anderem.`,
    };
    this.game.narrate([{ text: `💍 ${hero.name} kniet vor ${name} nieder und hält einen Ring hoch …` }, { npc: name, text: lines[answer] }]);
    if (answer === "yes") {
      mind.engaged = hero.name;
      changeLove(mind, hero.name, 1);
      remember(mind, `${hero.name} hat mir einen Antrag gemacht – und ich habe Ja gesagt!`);
      this.game.narrate([{ text: `🔔 ${hero.name} und ${name} sind verlobt! Die Hochzeit wird im Heimatdorf gefeiert, wenn ihr heimkehrt.` }]);
    } else if (answer === "too_soon") remember(mind, `${hero.name} hat mir einen Antrag gemacht – viel zu früh.`);
    w.save();
    return answer === "yes";
  }

  /** At the start: married heroes think of their partner – a blessing in the first fight ("Rückhalt"). */
  private familyStrength(): void {
    const w = this.opts.npcs;
    if (!w || this.state.sceneIndex > 0) return;
    for (const hero of this.heroes()) {
      const p = partnerOf(w.world, hero.name);
      if (!p?.married) continue;
      this.game.grantBoon(hero.id, "bless");
      this.game.narrate([{ text: `💍 ${hero.name} denkt an ${p.mind.name} daheim – das gibt Kraft: Im ersten Kampf liegt ein Segen auf ${hero.name}.` }]);
    }
  }

  /** 🌙 At the campfire (or at the end): a couple in love meets – once per adventure, then fade out. */
  private rendezvous(): void {
    const w = this.opts.npcs;
    const adventure = this.state.adventureId;
    if (!w || !adventure) return;
    for (const hero of this.heroes().filter((h) => !h.dead)) {
      const mind = [...this.metMinds.values()].find((m) => canDate(m, hero.name, adventure));
      if (!mind) continue;
      markDate(mind, hero.name, adventure);
      changeLove(mind, hero.name, 1);
      remember(mind, `Ich hatte ein heimliches Treffen mit ${hero.name}.`);
      this.game.grantBoon(hero.id, "luck");
      this.game.narrate([
        { text: `🌙 Am Abend schleicht sich ${hero.name} davon – ${mind.name} wartet schon am alten Brunnen. Was die beiden sich erzählen, bleibt ihr Geheimnis …` },
        { npc: mind.name, text: `Ich habe mich auf dich gefreut, ${hero.name}.` },
        { text: `✨ ${hero.name} ist beflügelt: Der erste Angriff im nächsten Kampf hat Vorteil.` },
      ]);
      w.save();
      return;
    }
  }

  /** Before the first scene: the families see their heroes off (once per adventure). */
  private seenOff = false;
  private seeOff(): void {
    const w = this.opts.npcs;
    if (!w || this.seenOff) return;
    this.seenOff = true;
    const lines = familyFarewell(w.world, this.heroes().map((h) => h.name));
    if (!lines.length) return;
    this.game.narrate(lines.slice(0, 6));
    w.save();
  }

  /** Home again: mourning, births, children growing up – and a night with the curtain drawn. */
  private familyAtHome(): void {
    const w = this.opts.npcs!;
    const heroes = this.heroes();
    for (const s of this.game.squireReport()) {
      const parent = Object.values(w.world.npcs).find((m) => m.children?.some((c) => c.name === s.child && c.hero === s.hero));
      if (parent) remember(parent, s.hurt ? `${s.child} kam verwundet heim – aber stolz, mit ${s.hero} gekämpft zu haben.` : `${s.child} war als Knappe bei ${s.hero} – und erzählt allen davon.`);
    }
    const events = familyAfterAdventure(w.world, heroes.filter((h) => !h.dead).map((h) => h.name), heroes.filter((h) => h.dead).map((h) => h.name));
    const lines: Narration[] = [];
    for (const e of events) {
      if (e.kind === "mourn") lines.push({ text: `🕯️ Im Heimatdorf wartet ${e.name} vergeblich auf ${e.hero}. Die Kinder bleiben – und die Erinnerung.` }, { npc: e.name, text: `Ich zünde jeden Abend eine Kerze an, ${e.hero}.` });
      else if (e.kind === "night") lines.push({ text: `🌙 ${e.hero} und ${e.name} haben sich lange nicht gesehen. Die Tür schließt sich, das Licht geht aus – und der Vorhang fällt.` });
      else if (e.kind === "birth") lines.push({ text: `👶 Ein Kind ist geboren! ${e.name} und ${e.hero} haben ${e.child.gender === "female" ? "eine Tochter" : "einen Sohn"}: ${e.child.name}. (Den Namen kann ${e.hero} einmal auf dem Handy ändern.)` });
      else lines.push({ text: e.stage === "jugend" ? `🧑 ${e.child.name} ist jetzt ${STAGE_LABEL[e.stage].toLowerCase()} – und darf als Knappe mit ${e.hero} ziehen, wenn ${e.hero} es erlaubt.` : `🧒 ${e.child.name} ist kein Baby mehr – und läuft schon überall herum.` });
    }
    if (lines.length) this.game.narrate(lines);
  }

  /** Characters who know the group from before say so (once per adventure). */
  private greetReturning(): void {
    const heroes = this.heroes().map((h) => h.name);
    const lines: Narration[] = [];
    for (const [name, mind] of this.minds) {
      if (this.greeted.has(name) || !mind.facts.length || mind.adventures.length < 2) continue;
      this.greeted.add(name);
      lines.push({ text: `💭 ${name} erkennt euch wieder.` }, { npc: name, text: greetingFor(mind, heroes) });
    }
    if (lines.length) this.game.narrate(lines);
  }

  /** A hero found something in a bookshelf: one clue the group does not have yet (never a false lead). */
  private bookClue(): boolean {
    const open = this.story.clues.filter((c) => (c.truth === this.state.truth || c.truth === null) && !c.falseLeadFor?.length && !this.state.clues.includes(c.id));
    const clue = open[Math.floor(Math.random() * open.length)];
    if (!clue) return false;
    this.addClue(clue.id);
    return true;
  }

  private addClue(ref: string): void {
    const id = resolveClue({ story: this.story, scene: this.scene, truth: this.state.truth, eventsUsed: [] }, ref);
    if (!id || this.state.clues.includes(id)) return;
    this.state.clues.push(id);
    const clue = this.story.clues.find((c) => c.id === id)!;
    this.game.narrate([{ text: `🔎 Hinweis: ${clue.text}`, tip: { key: "hinweis", text: "Neuer Hinweis! Ihr findet ihn im Tab „Hinweise“ auf dem Handy." } }]);
    this.game.awardXp(CLUE_XP, "Hinweis gefunden");
    this.updateView();
  }

  private updateView(): void {
    const { index, act } = actOf(this.story, this.scene.id);
    this.game.setStoryView({
      title: this.story.title,
      chapter: `Kapitel ${index + 1} von ${this.story.acts.length} · ${act.title}`,
      scene: this.scene.title,
      goal: this.scene.ziel,
      narration: [],
      choices: [],
      clues: this.state.clues.map((id) => ({ text: this.story.clues.find((c) => c.id === id)!.text })),
      ...this.taskList(),
    });
  }

  /** Steps of this scene done so far (for the checklist). */
  private doneSteps = new Set<string>();

  /** The scene as a checklist: what is done, what is to do now, and how many more come. */
  private taskList(): { tasks: { text: string; done: boolean }[]; moreTasks: number } {
    const steps = this.scene.steps.filter((s) => s.kind !== "narrate" && (!s.truths || s.truths.includes(this.state.truth)));
    const tasks: { text: string; done: boolean }[] = [];
    let more = 0;
    let current = false;
    for (const s of steps) {
      if (this.doneSteps.has(s.id)) tasks.push({ text: this.taskText(s), done: true });
      else if (!current && (s.id === this.stepId || !this.stepId)) {
        tasks.push({ text: this.taskText(s), done: false });
        current = true;
      } else if (current || tasks.length) more++;
    }
    return { tasks, moreTasks: more };
  }

  private taskText(s: Step): string {
    switch (s.kind) {
      case "reach": {
        if (!s.target || s.target === "exit") return "Den Weg nach draußen finden";
        const npc = this.story.npcs.find((n) => n.id === s.target);
        return `Zu ${npc?.name ?? "der Person"} gehen`;
      }
      case "explore":
        return "Die Gegend erkunden";
      case "check":
        return s.check?.title ?? "Eine Probe bestehen";
      case "fight":
        return "Den Kampf bestehen";
      case "use_item":
        return "Etwas öffnen oder benutzen";
      case "choice":
        return "Gemeinsam entscheiden";
      default:
        return "Weiter";
    }
  }

  // ---------------------------------------------------------------- main loop

  async run(): Promise<StoryResult | undefined> {
    this.game.narrate(this.state.sceneIndex === 0 ? this.story.intro : [{ text: "Ihr setzt euer Abenteuer fort …" }]);
    // Secret goals are no longer handed out (they confused more than they helped).
    // The saga: what happened last time, and who might turn up again.
    const saga = this.opts.saga;
    if (saga?.recap && this.state.sceneIndex === 0) {
      this.game.narrate([
        { text: `📜 Aus eurer Heldensaga: ${saga.recap}`, tip: { key: "kampagne", text: "Eure Abenteuer hängen zusammen: Alte Freunde und alte Feinde können wieder auftauchen." } },
        ...(saga.nemesis ? [{ text: `🗡️ Gerüchte gehen um: ${saga.nemesis.name} hat „${saga.nemesis.from}“ nicht vergessen …` }] : []),
      ]);
    }
    this.familyStrength();
    // A new chapter begins with a rest at the campfire (not when a saved game just continues).
    let lastAct = this.state.sceneIndex < this.state.plan.length ? actOf(this.story, this.state.plan[this.state.sceneIndex]!).index : 0;
    while (this.state.sceneIndex < this.state.plan.length) {
      const id = this.state.plan[this.state.sceneIndex]!;
      if (this.state.dropped.includes(id)) {
        this.state.sceneIndex++;
        continue;
      }
      const scene = sceneById(this.story, id);
      const actIndex = actOf(this.story, id).index;
      // A chapter is done: an attribute point for everyone. Rest at the fire, then choose the way on the Harz map.
      if (actIndex > lastAct) this.game.chapterDone();
      if (actIndex > lastAct && this.opts.camp !== false) await this.campfire();
      if (actIndex > lastAct && this.opts.travel !== false) await this.travel(actIndex);
      lastAct = actIndex;
      this.opts.onSave?.(structuredClone(this.state), !!scene.savePoint && this.state.duration === "lang");
      const outcome = await this.playScene(scene);
      if (outcome === "defeat") break;
      const report = tempoCheck(this.story, this.state.plan.filter((s) => !this.state.dropped.includes(s)), this.activeIndex(), this.minutesPlayed());
      if (report.dropped.length) {
        this.state.dropped.push(...report.dropped);
        this.game.narrate([{ text: "⏱️ Die Zeit drängt – ihr nehmt den direkten Weg." }]);
      }
      this.state.sceneIndex++;
    }
    return this.finish();
  }

  /**
   * Rest between chapters: everyone is healed, each hero answers a question at the fire
   * (the game master keeps the answers for later), and a trader offers potions and equipment.
   */
  private async campfire(): Promise<void> {
    this.game.narrate([
      { text: "🔥 Das Kapitel ist geschafft. Ihr schlagt ein Lager auf, das Feuer knistert." },
      { text: "💤 Nach der Rast sind alle wieder bei vollen Kräften: Trefferpunkte, Zauber und Fähigkeiten sind zurück.", tip: { key: "rast", text: "Erzählt euch am Handy etwas über eure Helden und schaut bei der Händlerin vorbei. Dann „Weiter“ tippen." } },
    ]);
    this.game.restAll();
    const heroes = this.heroes().filter((h) => !h.dead && h.playerId);
    const pool = [...CAMP_QUESTIONS];
    const questions: Record<string, string> = {};
    // Its own dice: the rest does not change what happens later in the story.
    const campRng = seededRng((this.opts.now ?? Date.now)() + this.state.sceneIndex * 7919);
    for (const h of heroes) questions[h.id] = pool.splice(campRng.int(0, pool.length - 1), 1)[0] ?? CAMP_QUESTIONS[0]!;
    const shop: CampOffer[] = [
      { id: "potion", icon: "🧪", name: "Heiltrank", detail: "Heilt 2W4 + 2 Trefferpunkte", price: 50, itemId: "potion-of-healing" },
      { id: "torch", icon: "🔥", name: "Fackel", detail: "Licht in dunklen Nächten und Höhlen", price: 2, itemId: "torch" },
      { id: "ring", icon: "💍", name: "Verlobungsring", detail: "Für einen Antrag – wenn jemand sehr verliebt ist", price: 60, itemId: "verlobungsring" },
    ];
    const taken = new Set<string>();
    for (const h of heroes) {
      if (taken.size >= 2) break;
      const g = getGear(this.game.randomGear(h, campRng) ?? "");
      if (g && !taken.has(g.id)) {
        taken.add(g.id);
        shop.push({ id: `gear:${g.id}`, icon: g.icon, name: g.name, detail: g.detail, price: g.price * 2, gearId: g.id });
      }
    }
    this.game.narrate([{ npc: "Händlerin Grete", text: "Guten Abend, ihr Helden! Heiltränke, Fackeln – und für die Mutigen ein paar besondere Stücke." }]);
    const limit = new Promise<void>((resolve) => {
      this.campTimer = setTimeout(resolve, CAMP_MINUTES * 60_000);
    });
    const done = this.game.startCamp(questions, shop);
    await Promise.race([done, limit]);
    clearTimeout(this.campTimer);
    this.game.endCamp();
    const tales = await done;
    this.state.tales = [...(this.state.tales ?? []), ...tales.map((t) => `${t.name} (${t.question}): „${t.text}“`)].slice(-12);
    if (tales.length) await this.askDm({ kind: "campfire", tales: tales.map((t) => ({ heroName: t.name, question: t.question, text: t.text })) });
    this.rendezvous();
    this.game.narrate([{ text: "🌅 Der Morgen graut. Weiter geht's!" }]);
  }

  /**
   * The Harz map between chapters: three routes, the group votes, something happens on the way.
   * Its own dice: the journey does not change what happens later in the story.
   */
  private async travel(actIndex: number): Promise<void> {
    // Seeded from the story's own dice once per game (same game → same journey; tests stay repeatable).
    this.state.travelSeed ??= this.rng.int(1, 1_000_000_000);
    const rng = seededRng(this.state.travelSeed + actIndex * 104729);
    const routes = pickRoutes((n) => rng.int(0, n - 1));
    const from = this.story.acts[actIndex - 1]?.title ?? "Lager";
    const to = this.story.acts[actIndex]?.title ?? "Weiter";
    const view = { from, to, routes: routes.map((r) => ({ icon: r.icon, name: r.name, text: r.text, x: r.x, y: r.y })) };
    this.game.showTravel(view);
    this.game.narrate([{ text: `🗺️ Weiter geht die Reise – nächstes Ziel: ${to}. Welchen Weg nehmt ihr?`, tip: { key: "reisekarte", text: "Stimmt auf dem Handy ab. Jeder Weg hat seine eigenen Chancen und Gefahren." } }]);
    const expire = setTimeout(() => this.game.cancelChoice(), 90_000);
    const pick = await this.game.choose(routes.map((r) => ({ id: r.id, label: `${r.icon} ${r.name}`, detail: r.text })), { vote: true }).catch(() => undefined);
    clearTimeout(expire);
    const index = Math.max(0, routes.findIndex((r) => r.id === pick?.id));
    const route = routes[index]!;
    this.game.showTravel({ ...view, chosen: index });
    await this.travelEvent(route, rng);
    setTimeout(() => this.game.showTravel(undefined), 6000);
  }

  private async travelEvent(route: TravelRoute, rng: Rng): Promise<void> {
    const heroes = this.heroes().filter((h) => !h.dead);
    const give = (itemId: string, qty: number) => heroes.forEach((h) => this.game.giveItem(itemId, qty, h));
    switch (route.event) {
      case "kraeuter":
        this.game.narrate([{ text: `🌿 ${route.name}: Die Wiesen stehen voller Kräuter. Jeder pflückt zwei Heilkräuter und einen Pilz.` }]);
        give("heilkraut", 2);
        give("pilz", 1);
        break;
      case "haendler":
        this.game.narrate([{ npc: "Kesselflicker Kaspar", text: "Ölflaschen! Spinnenseide! Alles, was der Held von heute braucht – für euch als Probe umsonst!" }]);
        give("oelflasche", 1);
        give("spinnenseide", 1);
        break;
      case "woelfe": {
        this.game.narrate([{ text: `🐺 ${route.name}: Ein Wolfsrudel! Ihr wehrt es ab – aber nicht ohne Kratzer.` }]);
        const lines: string[] = [];
        for (const h of heroes) {
          // Nobody lying on the ground gets bitten (the travel is no death trap).
          if (h.hp === 0) continue;
          const save = savingThrow(rng, h, "DEX", 12);
          if (save.success) lines.push(`${h.name} weicht aus.`);
          else lines.push(`${h.name}: ${this.game.travelHurt(h, "1d6")} Schaden.`);
        }
        this.game.narrate([{ text: lines.join(" ") }, { text: "Die Wölfe fliehen und lassen Knochen und ein paar Münzen ihrer letzten Opfer zurück." }]);
        give("knochen", 1);
        give("gold", 5);
        break;
      }
      case "streuner":
        this.game.pendingStray = rng.next() < 0.6 ? "dog" : "cat";
        this.game.narrate([{ text: `🐾 ${route.name}: Auf dem verlassenen Hof streunt ${this.game.pendingStray === "dog" ? "ein hungriger Hund" : "eine magere Katze"} herum. Sie folgt euch in sicherem Abstand …`, tip: { key: "begleiter", text: "Mit einem Knochen (Hund) oder Heilkraut (Katze) könnt ihr das Tier zähmen." } }]);
        give(this.game.pendingStray === "dog" ? "knochen" : "heilkraut", 1);
        break;
      case "stollen": {
        const best = [...heroes].sort((a, b) => sumParts(skillParts(b, "investigation")) - sumParts(skillParts(a, "investigation")))[0];
        this.game.narrate([{ text: `⛏️ ${route.name}: Ein alter Stollen. ${best?.name ?? "Jemand"} sucht nach Silberadern …` }]);
        if (best) {
          const r = await this.game.check(best, "investigation", 12, "Im Stollen suchen");
          if (r.success) {
            const gold = rollDice(rng, parseDice("2d10")).total;
            this.game.narrate([{ text: `💰 Silber! Jeder bekommt ${gold} Goldmünzen.` }]);
            give("gold", gold);
          } else this.game.narrate([{ text: "Nur taubes Gestein. Immerhin: eine Ölflasche aus der alten Grubenlampe für jeden." }]);
        }
        give("oelflasche", 1);
        break;
      }
      case "schrein":
        this.game.narrate([{ text: `⛩️ ${route.name}: Ihr zündet am Wegkreuz eine Kerze an und betet. Im nächsten Kampf seid ihr alle gesegnet.` }]);
        for (const h of heroes) this.game.grantBoon(h.id, "bless");
        break;
      case "nebel":
        this.nextWeather = "fog";
        this.game.pendingStray = "raven";
        this.game.narrate([{ text: `🌫️ ${route.name}: Dichter Nebel zieht mit euch. Ein Rabe krächzt über euch – er scheint euch zu folgen.` }]);
        give("spinnenseide", 1);
        break;
      case "gewitter":
        this.nextWeather = rng.next() < 0.5 ? "rain" : "wind";
        this.game.narrate([{ text: `⛈️ ${route.name}: Blitz und Donner! Ihr seid schnell, aber pitschnass. Am nächsten Ort ${this.nextWeather === "rain" ? "regnet" : "stürmt"} es noch.` }]);
        give("heilkraut", 1);
        break;
    }
  }

  private campTimer: ReturnType<typeof setTimeout> | undefined;
  /** Weather a travel event brings to the next map. */
  private nextWeather: Weather | undefined;
  private sagaAllyUsed = false;
  private nemesisUsed = false;
  /** The final boss (for the saga, if it gets away). */
  private finalBoss: SagaNpc | undefined;
  private finalBossKilled = false;
  /** Items used before the current scene began (a "use_item" step counts uses in this scene). */
  private sceneItemUses = 0;

  /** Index of the current scene within the plan without dropped scenes. */
  private activeIndex(): number {
    const active = this.state.plan.filter((s) => !this.state.dropped.includes(s));
    return active.indexOf(this.state.plan[this.state.sceneIndex]!);
  }

  private async playScene(scene: Scene): Promise<"done" | "defeat"> {
    this.scene = scene;
    this.doneSteps.clear();
    this.stepId = undefined;
    const { act } = actOf(this.story, scene.id);
    // No free levels per chapter: heroes grow only by experience. A chapter made for stronger heroes
    // has somewhat weaker foes while the group is below that level (hard, but not hopeless).
    const levels = this.heroes().map((h) => h.pc?.level ?? 1);
    const partyLevel = levels.length ? Math.floor(levels.reduce((a, b) => a + b, 0) / levels.length) : 1;
    this.game.levelGap = Math.max(0, (act.level ?? 1) - partyLevel);
    const map = generateWithRetries(this.rng, { path: sceneRooms(scene, this.state.duration) });
    const npcs = (scene.npcs ?? []).map((n) => {
      const npc = this.story.npcs.find((x) => x.id === n.npc)!;
      return { id: npc.id, name: npc.name, monster: npc.monster, room: n.room ?? 0 };
    });
    if (scene.dark) map.dark = true;
    if (this.nextWeather) {
      map.weather = this.nextWeather;
      this.nextWeather = undefined;
    }
    for (const room of map.rooms) {
      const name = scene.roomNames?.[room.moduleId];
      if (name) room.name = name;
    }
    this.meetCharacters(npcs);
    this.game.loadMap(map, npcs);
    this.sceneItemUses = this.game.itemUses;
    this.world?.newScene(this.state.sceneIndex === 0);
    this.game.sceneCard(scene.title, scene.ziel);
    this.lowestHpRatio = 1;
    this.updateView();
    await this.askDm({ kind: "scene_start" });
    this.greetReturning();
    if (this.state.sceneIndex === 0) this.seeOff();

    let index = 0;
    let viaGoto = false;
    while (index < scene.steps.length) {
      const step = scene.steps[index]!;
      if (step.truths && !step.truths.includes(this.state.truth) && !viaGoto) {
        index++;
        continue;
      }
      const result = await this.runStep(step);
      if (result === "defeat") return "defeat";
      if (result === "end") break;
      if (typeof result === "object") {
        const target = scene.steps.findIndex((s) => s.id === result.goto);
        index = target >= 0 ? target : index + 1;
        viaGoto = true;
      } else {
        index++;
        viaGoto = false;
      }
    }
    this.stepId = undefined;
    this.updateView();
    await this.leaveVote();
    const end = await this.askDm({ kind: "scene_end" });
    if (end.trigger_event) {
      const ev = this.story.events?.find((e) => e.id === end.trigger_event);
      if (ev) {
        this.state.eventsUsed.push(ev.id);
        this.game.narrate(ev.narration);
        if (ev.fight?.length) {
          const r = await this.fight(ev.fight);
          if (r === "defeat") return "defeat";
        }
      }
    }
    return "done";
  }

  /**
   * The goal of the scene is reached – but nobody is dragged away: the group decides when to move on.
   * "Noch umsehen" gives two more rounds (talk to people, look around, shop), then they are asked again.
   */
  private async leaveVote(): Promise<void> {
    if (this.opts.leaveVote === false) return;
    const nextId = this.state.plan.slice(this.state.sceneIndex + 1).find((id) => !this.state.dropped.includes(id));
    const next = nextId ? sceneById(this.story, nextId).title : undefined;
    for (let ask = 0; ask < 3; ask++) {
      const pick = await this.game.choose(
        [
          { id: "leave:go", label: next ? `➡️ Weiter: ${next}` : "🏁 Zum Finale", detail: "Das Ziel hier ist geschafft. Weiter geht's, wenn ihr bereit seid.", recommended: true },
          { id: "leave:stay", label: "🔎 Noch umsehen", detail: "Noch 2 Runden hierbleiben: Leute ansprechen, stöbern, Kräuter sammeln …" },
        ],
        { vote: true },
      );
      if (pick.id === "leave:go") return;
      this.game.narrate([{ text: "🔎 Ihr seht euch noch ein wenig um." }]);
      if (this.game.freeExplore) {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        continue;
      }
      const until = this.game.round + 2;
      await this.game.waitFor(() => this.game.round >= until && this.game.mode === "explore");
    }
  }

  // ---------------------------------------------------------------- steps

  private async runStep(step: Step): Promise<"next" | "end" | "defeat" | { goto: string }> {
    this.stepId = step.id;
    this.updateView();
    await this.askDm({ kind: "step_start" });
    let result: "next" | "end" | "defeat" | { goto: string } = "next";

    switch (step.kind) {
      case "narrate":
      case "explore":
        if (step.kind === "explore") await this.roam(this.game.waitFor(() => this.heroInLastRoom()));
        break;
      case "reach":
        await this.roam(this.game.waitFor(() => (step.target === "exit" ? this.heroInLastRoom() : this.heroNextTo(step.target ?? ""))));
        break;
      case "check": {
        const c = step.check!;
        if (c.who === "each") {
          let anySuccess = false;
          for (const hero of this.heroes().filter(isActive)) {
            const adj = this.attitudeDc(c.dc, `${c.title}: ${hero.name}`);
            const r = await this.game.check(hero, c.skill, adj.dc, adj.title);
            anySuccess ||= r.success;
            this.game.narrate(r.success ? c.success.narration : c.failure.narration);
          }
          const o = anySuccess ? c.success : c.failure;
          result = await this.applyOutcome({ ...o, narration: [] });
        } else {
          const hero = await this.pickRoller(c.skill, c.title);
          const adj = this.attitudeDc(c.dc, c.title);
          const r = await this.game.check(hero, c.skill, adj.dc, adj.title);
          result = await this.applyOutcome(r.success ? c.success : c.failure, hero);
        }
        break;
      }
      case "fight": {
        const r = await this.fight(step.fight ?? [], step.fight?.some((g) => g.training));
        if (r === "defeat") return "defeat";
        break;
      }
      case "use_item": {
        // Somebody already opened a chest or used an item in this scene (e.g. during the fight): done.
        if (this.game.itemUses > this.sceneItemUses) break;
        const before = this.game.itemUses;
        await this.game.waitFor(() => this.game.itemUses > before);
        break;
      }
      case "choice":
        result = await this.choice(step.choices ?? []);
        break;
    }
    if (result === "defeat") return result;
    this.doneSteps.add(step.id);
    this.set(step.set);
    if (step.clue) this.addClue(step.clue);
    for (const c of step.clues ?? []) this.addClue(c);
    await this.askDm({ kind: "step_done" });
    return result;
  }

  /** The group decides who rolls: one button per hero with their bonus; the best is recommended. */
  private async pickRoller(skill: import("../shared/rules").SkillId, title: string): Promise<Creature> {
    const heroes = this.heroes().filter(isActive);
    if (heroes.length <= 1) return heroes[0] ?? this.heroes()[0]!;
    const bonus = (h: Creature) => sumParts(skillParts(h, skill));
    const best = Math.max(...heroes.map(bonus));
    const pick = await this.game.choose(
      heroes.map((h) => ({
        id: `roller:${h.id}`,
        label: `${h.name} würfelt`,
        detail: `${title} · ${nameOf("skills", skill)} ${bonus(h) >= 0 ? "+" : ""}${bonus(h)}${h.pc?.skillProficiencies.includes(skill) ? " ★" : ""}`,
        recommended: bonus(h) === best,
      })),
    );
    return this.heroes().find((h) => `roller:${h.id}` === pick.id)!;
  }

  private async choice(choices: StoryChoice[]): Promise<"next" | "end" | "defeat" | { goto: string }> {
    const offered = choices.filter(
      (c) =>
        (!c.truths || c.truths.includes(this.state.truth)) &&
        (c.requires ?? []).every((f) => this.has(f)) &&
        !(c.unless ?? []).some((f) => this.has(f)),
    );
    // The story's big decisions: everyone votes.
    const pick = await this.game.choose(offered.map((c) => ({ id: c.id, label: c.label, detail: c.detail })), { vote: true });
    const choice = offered.find((c) => c.id === pick.id)!;
    const chooser = this.heroOfPlayer(pick.playerId);
    if (choice.check) {
      const hero = chooser && isActive(chooser) ? chooser : await this.pickRoller(choice.check.skill, choice.label);
      const adj = this.attitudeDc(choice.check.dc, choice.label);
      const r = await this.game.check(hero, choice.check.skill, adj.dc, adj.title);
      return this.applyOutcome(r.success ? choice.check.success : choice.check.failure, hero);
    }
    return this.applyOutcome(choice.outcome ?? { narration: [] }, chooser);
  }

  private heroOfPlayer(playerId: PlayerId): Creature | undefined {
    return this.heroes().find((h) => h.playerId === playerId);
  }

  private async applyOutcome(o: Outcome, hero?: Creature): Promise<"next" | "end" | "defeat" | { goto: string }> {
    this.game.narrate(o.narration);
    this.set(o.set);
    if (o.clue) this.addClue(o.clue);
    if (o.item) this.game.giveItem(o.item.id, o.item.qty, o.item.id === "drachenlanze" ? (hero ?? this.heroes()[0]) : undefined);
    if (o.gold) this.changeGold(o.gold);
    if (o.heal !== undefined) for (const h of this.heroes()) if (!h.dead) h.hp = o.heal === 0 ? h.maxHp : Math.min(h.maxHp, h.hp + o.heal);
    if (o.damage) {
      for (const h of this.heroes().filter(isActive)) {
        const d = rollDice(this.rng, parseDice(o.damage)).total;
        // Story damage hurts, but never knocks anyone out.
        applyDamage(this.rng, h, Math.min(d, h.hp - 1));
      }
    }
    this.game.broadcast();
    if (o.fight?.length) {
      const r = await this.fight(o.fight);
      if (r === "defeat") return "defeat";
    }
    if (o.goto) return { goto: o.goto };
    return o.endScene ? "end" : "next";
  }

  private changeGold(amount: number): void {
    if (amount > 0) {
      this.game.giveItem("gold", amount, this.heroes()[0]);
      return;
    }
    let owed = -amount;
    for (const h of this.heroes()) {
      const gold = h.pc?.inventory.find((i) => i.itemId === "gold");
      if (!gold || owed <= 0) continue;
      const pay = Math.min(gold.qty, owed);
      gold.qty -= pay;
      owed -= pay;
    }
  }

  // ---------------------------------------------------------------- fights

  /** While the story waits for the heroes, the world keeps moving. */
  private roam<T>(wait: Promise<T>): Promise<T> {
    return this.world ? this.world.roam(wait) : wait;
  }

  private async fight(groupsIn: MonsterGroup[], training = false, stealth = true): Promise<"won" | "lost" | "defeat"> {
    let groups = groupsIn;
    // NPCs who turn into enemies leave their peaceful figure behind.
    for (const g of groups) {
      const npc = this.story.npcs.find((n) => n.name === g.name);
      if (npc) delete this.game.session.battle.creatures[`npc-${npc.id}`];
    }
    const hasBoss = groups.some((g) => g.boss);
    const allies = hasBoss
      ? (this.story.allies ?? [])
          .filter((a) => a.scene === this.scene.id && this.has(a.flag))
          .map((a) => {
            const npc = this.story.npcs.find((n) => n.id === a.npc)!;
            return { monster: npc.monster, name: `${npc.name} (hilft euch)` };
          })
      : [];
    const last = this.state.sceneIndex === this.state.plan.length - 1;
    // An old friend from the saga comes to help in the final fight.
    const friend = this.opts.saga?.ally;
    if (friend && hasBoss && last && !training && !this.sagaAllyUsed) {
      this.sagaAllyUsed = true;
      allies.push({ monster: friend.monster, name: `${friend.name} (alter Freund)` });
      this.game.narrate([{ text: `📜 ${friend.name} aus „${friend.from}“ hat von eurer Not gehört – und kommt euch zu Hilfe!` }]);
    }
    // An old foe from the saga takes revenge in the first real fight.
    const foe = this.opts.saga?.nemesis;
    if (foe && !training && !this.nemesisUsed) {
      this.nemesisUsed = true;
      groups = [...groups, { monster: foe.monster, count: 1, name: `${foe.name} (sinnt auf Rache)` }];
      this.game.narrate([{ text: `🗡️ „Da seid ihr ja wieder!“ ${foe.name} ist zurück – und will Rache für „${foe.from}“!` }]);
    }
    if (hasBoss && last) {
      const b = groups.find((g) => g.boss);
      if (b) this.finalBoss = { monster: b.monster, name: b.name ?? b.monster };
    }
    if (allies.length) this.game.narrate(allies.filter((a) => a.name.includes("(hilft euch)")).map((a) => ({ text: `${a.name.replace(" (hilft euch)", "")} stürmt herbei und kämpft an eurer Seite!` })));
    const track = setInterval(() => this.trackHardship(), 500);
    // Ordinary enemies may not have noticed the heroes yet: sneak up, talk, or attack.
    const staged = this.world && stealth && !training && !hasBoss && this.game.idle;
    // A boss can be ambushed: a moment to prepare the room first.
    const ambush = this.world && stealth && !training && hasBoss && this.game.idle && this.opts.ambush !== false;
    const { winner, spawned } = staged
      ? await this.world!.stealthyFight(groups, allies)
      : ambush
        ? await this.world!.ambushFight(groups, allies)
        : await this.game.fight(groups, { training, allies });
    clearInterval(track);
    this.trackHardship();
    if (spawned.some((m) => m.monsterId === "red-dragon-wyrmling" && m.dead)) this.set(["drache_tot"]);
    const kill = this.game.takeBossKill();
    if (kill && hasBoss && last) this.finalBossKilled = true;
    if (winner === "party") {
      // The final boss: whoever struck the last blow tells how it happened.
      if (kill && hasBoss && this.state.sceneIndex === this.state.plan.length - 1 && this.opts.finalBlow !== false) await this.finalBlow(kill);
      // Loot: bosses always drop something, other fights sometimes.
      if (!training && (hasBoss || this.rng.next() < 0.3)) {
        const heroes = this.heroes().filter((h) => !h.dead);
        const hero = heroes[this.rng.int(0, heroes.length - 1)];
        const gearId = hero ? this.game.randomGear(hero) : undefined;
        if (hero && gearId) this.game.grantGear(hero, gearId, hasBoss ? "Beute des Anführers" : "Beute");
      }
      return "won";
    }
    if (hasBoss && last) {
      this.set(["niederlage_boss"]);
      return "defeat";
    }
    return "lost";
  }

  /** "Der letzte Schlag gehört dir": the player describes it, the game master tells it big. */
  private async finalBlow(kill: { heroId: string; boss: string }): Promise<void> {
    const hero = this.game.session.battle.creatures[kill.heroId];
    if (!hero?.playerId) return;
    this.game.narrate([{ text: `⚔️ ${kill.boss} ist besiegt! Der letzte Schlag gehört ${hero.name}. Beschreib ihn auf deinem Handy – wie ist es passiert?` }]);
    this.game.banner({ icon: "⚔️", title: `Der letzte Schlag gehört ${hero.name}!`, text: "Beschreib auf dem Handy, wie du den Endgegner besiegt hast …" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(""), FINAL_BLOW_S * 1000);
    });
    const ask = this.game.askFinalBlow(hero.id, kill.boss);
    const text = await Promise.race([ask, limit]);
    clearTimeout(timer);
    this.game.endFinalBlow();
    this.game.banner(undefined);
    if (!text) {
      this.game.narrate([{ text: `${hero.name} steht schwer atmend über ${kill.boss}. Es ist vorbei.` }]);
      return;
    }
    this.game.narrate([{ npc: hero.name, text: `„${text}“` }]);
    const res = await this.askDm({ kind: "final_blow", heroName: hero.name, bossName: kill.boss, text });
    const told = (res.script ?? []).map((l) => l.text).join(" ") || res.narration || "";
    this.state.finalBlow = { heroId: hero.id, name: hero.name, boss: kill.boss, text, narration: told.slice(0, 600) };
    this.remember(`Letzter Schlag: ${hero.name} gegen ${kill.boss}: „${text}“`);
  }

  private trackHardship(): void {
    for (const h of this.heroes()) this.lowestHpRatio = Math.min(this.lowestHpRatio, h.maxHp ? h.hp / h.maxHp : 1);
  }

  // ---------------------------------------------------------------- positions

  private npcCreature(npcId: string): Creature | undefined {
    return this.game.session.battle.creatures[`npc-${npcId}`];
  }

  private heroNextTo(npcId: string): boolean {
    const npc = this.npcCreature(npcId);
    if (!npc) return true;
    return this.heroes().some((h) => h.pos && !h.dead && distanceFt(h, npc) <= HERO_SPOT * 5);
  }

  private heroInLastRoom(): boolean {
    const map = this.game.map;
    const last = map.rooms.length - 1;
    return this.heroes().some((h) => h.pos && map.roomOf[cellIndex(map, h.pos.x, h.pos.y)] === last);
  }

  // ---------------------------------------------------------------- free text & ending

  private async freeText(playerId: PlayerId, hero: Creature, text: string): Promise<void> {
    if (!this.scene || this.finished) return;
    this.actingRoom = this.game.surroundings(hero);
    const trigger = { kind: "free_text" as const, text, playerId, heroName: hero.name };
    const res = await this.askDm(trigger);
    // Effects without a roll (helping, taking cover).
    this.applyEffects(res.effects, trigger, hero);
    const roll = res.request_roll;
    if (!roll?.skill || !SKILL_IDS.includes(roll.skill as SkillId) || this.finished) {
      if (!res.effects?.length) this.remember(`${hero.name}: ${text}`);
      return;
    }
    // The DM wants a roll for this idea: the same hero rolls, then the DM tells what follows.
    const skill = roll.skill as SkillId;
    const r = await this.game.check(hero, skill, roll.dc, "Freie Aktion");
    const result = { kind: "roll_result" as const, text, playerId, heroName: hero.name, skill, dc: roll.dc, total: r.total, success: r.success };
    const after = await this.askDm(result);
    // Real consequences – decided by the DM, checked and carried out by the rules.
    this.applyEffects(after.effects, result, hero);
    const margin = r.total - roll.dc;
    this.remember(`${hero.name}: ${text} → ${r.success ? (margin >= 5 ? "großartig geschafft" : "geschafft") : margin >= -2 ? "knapp, mit Preis" : "misslungen"}`);
    this.actingRoom = undefined;
  }

  private applyEffects(effects: DmResponse["effects"], trigger: DmTrigger, hero: Creature): void {
    const ok = filterEffects(effects, this.ctx(), trigger);
    if (ok.length) this.game.applyEffects(ok, hero);
  }

  private remember(entry: string): void {
    const list = (this.state.chronicle ??= []);
    list.push(entry.slice(0, 140));
    if (list.length > 8) list.splice(0, list.length - 8);
  }

  /** "Was könnte ich tun?" – a few ideas for this hero, sent only to their phone. */
  async suggest(playerId: PlayerId, hero: Creature): Promise<string[]> {
    if (!this.scene || this.finished) return [];
    this.actingRoom = this.game.surroundings(hero);
    const trigger: DmTrigger = { kind: "suggest", playerId, heroName: hero.name };
    let ideas: string[] = [];
    try {
      ideas = (await this.dm.respond(this.ctx(), trigger)).ideas ?? [];
    } catch {
      ideas = [];
    }
    this.actingRoom = undefined;
    return ideas.filter((i) => typeof i === "string" && i.trim()).map((i) => i.trim().slice(0, 90)).slice(0, 4);
  }

  /** "Frag den Spielleiter": answer a rules question for one player (never changes the game). */
  async askRules(playerId: PlayerId, hero: Creature, question: string): Promise<string> {
    const turn = this.game.mode === "combat" && this.game.active()?.id === hero.id ? this.game.session.battle.combat?.turn : undefined;
    const trigger: DmTrigger = { kind: "rules_question", question, playerId, heroName: hero.name, glossary: glossaryExcerpt(question), hero: heroSummary(hero, turn) };
    try {
      const res = await this.dm.respond(this.ctx(), trigger);
      if (res.answer?.trim()) return res.answer.trim().slice(0, 900);
    } catch {
      // fall back to the glossary
    }
    return glossaryAnswer(question);
  }

  /** Friendly characters make checks in their scene easier, hostile ones harder. */
  private attitudeDc(dc: number, title: string): { dc: number; title: string } {
    const ids = (this.scene.npcs ?? []).map((n) => n.npc);
    const values = ids.map((id) => this.state.attitudes?.[id] ?? 0).filter((v) => v !== 0);
    if (!values.length) return { dc, title };
    const shift = Math.max(-3, Math.min(3, Math.round(values.reduce((a, b) => a + b, 0) / values.length)));
    if (!shift) return { dc, title };
    return { dc: dc - shift, title: `${title} (${shift > 0 ? "leichter" : "schwerer"}: ${shift > 0 ? "man mag euch" : "man misstraut euch"})` };
  }

  /** The look back: highlights from the numbers, and the most memorable idea. */
  private recap(ending: { title: string; kind: string }): Recap {
    const heroes = this.game.recapHeroes();
    const chronicle = (this.state.chronicle ?? []).filter((c) => !c.startsWith("Ereignis:"));
    const bestIdea = chronicle.find((c) => c.includes("großartig")) ?? chronicle.find((c) => c.includes("geschafft")) ?? chronicle[0];
    return {
      story: this.story.title,
      ending: { title: ending.title, kind: ending.kind },
      minutes: Math.round(this.minutesPlayed()),
      heroes,
      highlights: buildHighlights(heroes),
      ...(bestIdea ? { bestIdea: bestIdea.replace(/ → .*$/, "") } : {}),
    };
  }

  private async finish(): Promise<StoryResult> {
    this.finished = true;
    const res = await this.askDm({ kind: "story_end" });
    const ending = this.story.endings.find((e) => e.id === res.choose_ending) ?? pickEnding(this.story, this.state.truth, this.state.flags);
    if (!res.choose_ending) this.game.narrate(ending.text);
    this.state.ending = ending.id;
    const truth = this.story.truths.find((t) => t.id === this.state.truth)!;
    const relevant = this.story.clues.filter((c) => c.truth === truth.id || c.truth === null);
    const result: StoryResult = {
      ending: { id: ending.id, title: ending.title, kind: ending.kind, text: ending.text },
      truth: { id: truth.id, title: truth.title, summary: truth.summary },
      found: this.state.clues.map((id) => {
        const c = this.story.clues.find((x) => x.id === id)!;
        return { text: c.text, falseLead: !!c.falseLeadFor };
      }),
      missed: relevant.filter((c) => !c.falseLeadFor && !this.state.clues.includes(c.id)).map((c) => ({ text: c.text })),
      recap: { ...this.recap(ending), goals: this.game.finalizeGoals(), ...(this.state.finalBlow ? { finalBlow: this.state.finalBlow } : {}) },
    };
    // The saga remembers a friend won over and a foe who got away.
    const allyNpc =
      (this.story.allies ?? []).map((a) => (this.has(a.flag) ? this.story.npcs.find((n) => n.id === a.npc) : undefined)).find(Boolean) ??
      Object.entries(this.state.attitudes ?? {})
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => this.story.npcs.find((n) => n.id === id))
        .find(Boolean);
    result.homeland = {
      heroes: this.heroes().map((h) => h.name),
      ...(allyNpc && ending.kind !== "scheitern" ? { ally: { monster: allyNpc.monster, name: allyNpc.name } } : {}),
      ...(this.finalBoss && !this.finalBossKilled && (ending.kind === "scheitern" || ending.kind === "bittersuess") ? { nemesis: this.finalBoss } : {}),
    };
    const badges = this.game.saveHeroes(this.story.title, { won: ending.kind !== "scheitern", difficulty: this.state.difficulty ?? "normal", ...(this.state.finalBlow ? { finalBlowHeroId: this.state.finalBlow.heroId } : {}) });
    if (badges.length) result.recap.badges = badges;
    this.game.sendRecap(result.recap);
    // No campfire in short adventures: a couple in love still gets their evening.
    this.rendezvous();
    // Home again: the engaged get married – the whole village celebrates.
    if (this.opts.npcs) {
      const weddings = holdWeddings(this.opts.npcs.world, this.heroes().filter((h) => !h.dead).map((h) => h.name));
      for (const wed of weddings) {
        this.game.narrate([
          { text: `🔔 Zurück im Heimatdorf läuten die Glocken: ${wed.hero} und ${wed.name} heiraten! Das ganze Dorf tanzt bis tief in die Nacht.` },
          { npc: wed.name, text: `Jetzt bin ich zu Hause, ${wed.hero}. Bei dir.` },
        ]);
      }
      this.familyAtHome();
      this.opts.npcs.save();
    }
    // Everyone met remembers how it ended – and likes the heroes a bit more if they helped.
    const w = this.opts.npcs;
    if (w && this.metMinds.size) {
      const names = this.heroes().map((h) => h.name);
      const won = ending.kind !== "scheitern";
      for (const mind of this.metMinds.values()) {
        remember(mind, `${names.join(", ")}: „${this.story.title}“ – ${won ? "sie haben es geschafft" : "sie sind gescheitert"} (${ending.title}).`);
        if (won) for (const h of names) changeBond(mind, h, 1);
      }
      w.save();
    }
    this.opts.onEnd?.(result);
    return result;
  }
}

/** At most `sentences` sentences (and never more than about 320 characters). */
export function shorten(text: string, sentences: number): string {
  const parts = text.match(/[^.!?…]+[.!?…]+["“”»«]?\s*|[^.!?…]+$/g) ?? [text];
  let out = parts.slice(0, sentences).join("").trim();
  if (out.length > 320) out = `${out.slice(0, 317).replace(/\s+\S*$/, "")} …`;
  return out;
}
