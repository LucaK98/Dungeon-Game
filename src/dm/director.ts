/**
 * Runs a story on the host: scene after scene, step after step.
 * The director owns the rules of the story (flags, clues, fights, endings);
 * the DungeonMaster (scripted or AI) tells it and makes the "creative" decisions.
 */
import { applyDamage, distanceFt, isActive } from "../engine/combat";
import { skillParts, sumParts } from "../engine/core";
import { parseDice, rollDice } from "../engine/dice";
import { nameOf } from "../engine/names";
import type { Rng } from "../engine/rng";
import { generateWithRetries } from "../map/generate";
import type { DmContext, DmResponse, DmTrigger, DungeonMaster } from "../shared/dm";
import type { Creature } from "../shared/game";
import { cellIndex } from "../shared/map";
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
import { assignGoals } from "../shared/goals";
import type { CampOffer } from "../tv/game";

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
}

export interface StoryResult {
  ending: { id: string; title: string; kind: string; text: Narration[] };
  truth: { id: string; title: string; summary: string };
  found: { text: string; falseLead: boolean }[];
  missed: { text: string }[];
  /** Highlights and numbers of the heroes. */
  recap: Recap;
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
    const lines: Narration[] = response.script ?? (response.narration ? [{ text: response.narration }] : []);
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
    }
    return response;
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
    });
  }

  // ---------------------------------------------------------------- main loop

  async run(): Promise<StoryResult | undefined> {
    this.game.narrate(this.state.sceneIndex === 0 ? this.story.intro : [{ text: "Ihr setzt euer Abenteuer fort …" }]);
    // Secret goals: handed out once, kept in the save.
    if (!this.state.goals) {
      const goalRng = seededRng((this.opts.now ?? Date.now)() + 4711);
      this.state.goals = assignGoals(this.heroes().filter((h) => h.playerId).map((h) => ({ id: h.id, classId: h.pc?.classId ?? "" })), (n) => goalRng.int(0, Math.max(0, n - 1)));
      this.game.narrate([{ text: "🤫 Jeder von euch hat auf dem Handy ein geheimes Ziel. Verratet es niemandem – am Ende wird aufgedeckt!", tip: { key: "geheimes_ziel", text: "Dein Ziel steht im Tab „Hinweise“. Schaffst du es, gibt es Bonus-Gold." } }]);
    }
    this.game.setGoals(this.state.goals);
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
      if (actIndex > lastAct && this.opts.camp !== false) await this.campfire();
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
      { id: "potion", icon: "🧪", name: "Heiltrank", detail: "Heilt 2W4 + 2 Trefferpunkte", price: 25, itemId: "potion-of-healing" },
      { id: "torch", icon: "🔥", name: "Fackel", detail: "Licht in dunklen Nächten und Höhlen", price: 1, itemId: "torch" },
    ];
    const taken = new Set<string>();
    for (const h of heroes) {
      if (taken.size >= 2) break;
      const g = getGear(this.game.randomGear(h, campRng) ?? "");
      if (g && !taken.has(g.id)) {
        taken.add(g.id);
        shop.push({ id: `gear:${g.id}`, icon: g.icon, name: g.name, detail: g.detail, price: g.price, gearId: g.id });
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
    this.game.narrate([{ text: "🌅 Der Morgen graut. Weiter geht's!" }]);
  }

  private campTimer: ReturnType<typeof setTimeout> | undefined;
  /** Items used before the current scene began (a "use_item" step counts uses in this scene). */
  private sceneItemUses = 0;

  /** Index of the current scene within the plan without dropped scenes. */
  private activeIndex(): number {
    const active = this.state.plan.filter((s) => !this.state.dropped.includes(s));
    return active.indexOf(this.state.plan[this.state.sceneIndex]!);
  }

  private async playScene(scene: Scene): Promise<"done" | "defeat"> {
    this.scene = scene;
    this.stepId = undefined;
    const { act } = actOf(this.story, scene.id);
    if (act.level && this.game.levelUp(act.level)) {
      this.game.narrate([{ text: `⬆️ Stufenaufstieg! Ihr seid jetzt Stufe ${act.level}: mehr Trefferpunkte und neue Fähigkeiten.`, tip: { key: "stufe", text: "Schaut in den Charakter-Tab: Dort stehen eure neuen Werte." } }]);
    }
    const map = generateWithRetries(this.rng, { path: sceneRooms(scene, this.state.duration) });
    const npcs = (scene.npcs ?? []).map((n) => {
      const npc = this.story.npcs.find((x) => x.id === n.npc)!;
      return { id: npc.id, name: npc.name, monster: npc.monster, room: n.room ?? 0 };
    });
    if (scene.dark) map.dark = true;
    for (const room of map.rooms) {
      const name = scene.roomNames?.[room.moduleId];
      if (name) room.name = name;
    }
    this.game.loadMap(map, npcs);
    this.sceneItemUses = this.game.itemUses;
    this.world?.newScene(this.state.sceneIndex === 0);
    this.lowestHpRatio = 1;
    this.updateView();
    await this.askDm({ kind: "scene_start" });

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

  private async fight(groups: MonsterGroup[], training = false, stealth = true): Promise<"won" | "lost" | "defeat"> {
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
    if (allies.length) this.game.narrate(allies.map((a) => ({ text: `${a.name.replace(" (hilft euch)", "")} stürmt herbei und kämpft an eurer Seite!` })));
    const track = setInterval(() => this.trackHardship(), 500);
    // Ordinary enemies may not have noticed the heroes yet: sneak up, talk, or attack.
    const staged = this.world && stealth && !training && !hasBoss && this.game.idle;
    const { winner, spawned } = staged ? await this.world!.stealthyFight(groups, allies) : await this.game.fight(groups, { training, allies });
    clearInterval(track);
    this.trackHardship();
    if (spawned.some((m) => m.monsterId === "red-dragon-wyrmling" && m.dead)) this.set(["drache_tot"]);
    const kill = this.game.takeBossKill();
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
    const last = this.state.sceneIndex === this.state.plan.length - 1;
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
    const badges = this.game.saveHeroes(this.story.title, { won: ending.kind !== "scheitern", difficulty: this.state.difficulty ?? "normal", ...(this.state.finalBlow ? { finalBlowHeroId: this.state.finalBlow.heroId } : {}) });
    if (badges.length) result.recap.badges = badges;
    this.game.sendRecap(result.recap);
    this.opts.onEnd?.(result);
    return result;
  }
}
