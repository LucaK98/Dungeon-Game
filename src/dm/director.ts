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
import { SKILL_IDS, type SkillId } from "../shared/rules";

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
}

export interface StoryResult {
  ending: { id: string; title: string; kind: string; text: Narration[] };
  truth: { id: string; title: string; summary: string };
  found: { text: string; falseLead: boolean }[];
  missed: { text: string }[];
}

export interface DirectorOptions {
  duration: Duration;
  truth?: string;
  now?: () => number;
  /** Save point reached ("lang"): store this state. */
  onSave?: (state: StoryState) => void;
  onEnd?: (result: StoryResult) => void;
}

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
  finished = false;

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
    return response;
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
    while (this.state.sceneIndex < this.state.plan.length) {
      const id = this.state.plan[this.state.sceneIndex]!;
      if (this.state.dropped.includes(id)) {
        this.state.sceneIndex++;
        continue;
      }
      const scene = sceneById(this.story, id);
      if (scene.savePoint && this.state.duration === "lang") this.opts.onSave?.(structuredClone(this.state));
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
    this.game.loadMap(map, npcs);
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
        if (step.kind === "explore") await this.game.waitFor(() => this.heroInLastRoom());
        break;
      case "reach":
        await this.game.waitFor(() => (step.target === "exit" ? this.heroInLastRoom() : this.heroNextTo(step.target ?? "")));
        break;
      case "check": {
        const c = step.check!;
        if (c.who === "each") {
          let anySuccess = false;
          for (const hero of this.heroes().filter(isActive)) {
            const r = await this.game.check(hero, c.skill, c.dc, `${c.title}: ${hero.name}`);
            anySuccess ||= r.success;
            this.game.narrate(r.success ? c.success.narration : c.failure.narration);
          }
          const o = anySuccess ? c.success : c.failure;
          result = await this.applyOutcome({ ...o, narration: [] });
        } else {
          const hero = await this.pickRoller(c.skill, c.title);
          const r = await this.game.check(hero, c.skill, c.dc, c.title);
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
    const pick = await this.game.choose(offered.map((c) => ({ id: c.id, label: c.label, detail: c.detail })));
    const choice = offered.find((c) => c.id === pick.id)!;
    const chooser = this.heroOfPlayer(pick.playerId);
    if (choice.check) {
      const hero = chooser && isActive(chooser) ? chooser : await this.pickRoller(choice.check.skill, choice.label);
      const r = await this.game.check(hero, choice.check.skill, choice.check.dc, choice.label);
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

  private async fight(groups: MonsterGroup[], training = false): Promise<"won" | "lost" | "defeat"> {
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
    const { winner, spawned } = await this.game.fight(groups, { training, allies });
    clearInterval(track);
    this.trackHardship();
    if (spawned.some((m) => m.monsterId === "red-dragon-wyrmling" && m.dead)) this.set(["drache_tot"]);
    if (winner === "party") return "won";
    const last = this.state.sceneIndex === this.state.plan.length - 1;
    if (hasBoss && last) {
      this.set(["niederlage_boss"]);
      return "defeat";
    }
    return "lost";
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
    const res = await this.askDm({ kind: "free_text", text, playerId, heroName: hero.name });
    const roll = res.request_roll;
    if (!roll?.skill || !SKILL_IDS.includes(roll.skill as SkillId) || this.finished) return;
    // The DM wants a roll for this idea: the same hero rolls, then the DM tells what follows.
    const skill = roll.skill as SkillId;
    const r = await this.game.check(hero, skill, roll.dc, "Freie Aktion");
    const after = await this.askDm({ kind: "roll_result", text, playerId, heroName: hero.name, skill, dc: roll.dc, total: r.total, success: r.success });
    // A trick in a fight has a real effect – decided by the DM, carried out by the rules.
    const effect = r.success ? after.combat_effect : undefined;
    if (effect?.kind === "distract") this.game.distract(effect.target, hero.name);
    if (effect?.kind === "flee") this.game.enemiesFlee();
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
    };
    this.opts.onEnd?.(result);
    return result;
  }
}
