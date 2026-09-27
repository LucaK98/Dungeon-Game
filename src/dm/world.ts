/**
 * The world between the story steps: while the heroes explore, things happen on their own.
 * - random events with decisions on the phones (see world-events.ts)
 * - story characters greet heroes who come close
 * - time pressure: dawdle too long and there are consequences
 * - the game master speaks up when nobody does anything for a while
 * - enemies can be found asleep or on watch: sneak up, talk, or attack
 */
import { applyDamage, isActive } from "../engine/combat";
import { skillParts, sumParts } from "../engine/core";
import { parseDice, rollDice } from "../engine/dice";
import type { Rng } from "../engine/rng";
import type { Creature } from "../shared/game";
import { cellIndex } from "../shared/map";
import type { Duration, MonsterGroup, Scene, Story } from "../shared/story";
import type { GameController } from "../tv/game";
import { THEMES } from "../map/modules";
import { getGear } from "../data/gear";
import { clockWarning, eventGapSeconds, pickEvent, wanderers, type EventChoice, type EventOutcome, type Place, type WorldEvent } from "./world-events";

export interface WorldHost {
  game: GameController;
  rng: Rng;
  story: Story;
  duration: Duration;
  scene(): Scene;
  now(): number;
  attitude(npcId: string): number;
  fight(groups: MonsterGroup[]): Promise<"won" | "lost" | "defeat">;
  changeGold(amount: number): void;
  remember(entry: string): void;
  /** The game master says something to get things moving (may be empty). */
  nudge(): Promise<void>;
}

/** How long the heroes may take for one goal before the clock warns them (minutes). */
const CLOCK: Record<Duration, number> = { kurz: 4, mittel: 6, lang: 8 };
/** After this long without any action the game master speaks up (seconds). */
const QUIET_S = 75;
/** A decision on the phones stays open this long (seconds). */
const CHOICE_S = 60;

const GREET: Record<"friend" | "neutral" | "foe", string[]> = {
  friend: ["Ah, da seid ihr ja! Kommt nur, kommt!", "Schön, euch zu sehen, Freunde.", "Ihr kommt wie gerufen!"],
  neutral: ["Hm? Wollt ihr etwas von mir?", "Kommt ruhig näher, ich beiße nicht.", "Seid ihr die Fremden, von denen alle reden?", "Na, ihr seht aus, als hättet ihr Fragen."],
  foe: ["Ihr schon wieder …", "Bleibt mir bloß vom Leib!", "Was glotzt ihr so?"],
};

export class World {
  private nextEventAt = 0;
  private stepStartedAt = 0;
  private warnings = 0;
  private lastNudgeAt = 0;
  private used: string[] = [];
  private greeted = new Set<string>();
  /** First scene: no events and no time pressure. */
  private gentle = false;
  private running: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private host: WorldHost) {}

  private get game(): GameController {
    return this.host.game;
  }

  /** A new scene: greetings start over, the first event comes after a while. */
  newScene(firstOfStory = false): void {
    this.greeted.clear();
    this.gentle = firstOfStory;
    // The very first scene teaches the basics: no surprises there yet.
    this.nextEventAt = firstOfStory ? Number.POSITIVE_INFINITY : this.host.now() + eventGapSeconds(this.host.rng, this.game.heroes().length) * 1000;
  }

  /** Lets the world run while the story waits for the heroes (reach/explore steps). */
  async roam<T>(wait: Promise<T>): Promise<T> {
    this.stepStartedAt = this.host.now();
    this.warnings = 0;
    this.lastNudgeAt = this.host.now();
    this.timer = setInterval(() => this.tick(), 1000);
    try {
      return await wait;
    } finally {
      clearInterval(this.timer);
      this.timer = undefined;
      // A running event finishes before the story moves on.
      await this.running;
    }
  }

  private tick(): void {
    if (this.running || !this.game.idle) return;
    const now = this.host.now();
    this.greetings();
    const clock = CLOCK[this.host.duration] * 60000;
    if (!this.gentle && now - this.stepStartedAt > clock * (this.warnings + 1)) {
      this.warnings++;
      this.run(this.warnings === 1 ? Promise.resolve(this.game.narrate([clockWarning(this.place())])) : this.lateConsequence());
      return;
    }
    if (now >= this.nextEventAt) {
      this.nextEventAt = now + eventGapSeconds(this.host.rng, this.game.heroes().length) * 1000;
      const ev = pickEvent(this.host.rng, this.place(), this.used);
      if (ev) {
        this.used.push(ev.id);
        this.run(this.event(ev));
        return;
      }
    }
    const quiet = Math.min(now - this.game.lastActionAt, now - this.lastNudgeAt);
    if (quiet > QUIET_S * 1000) {
      this.lastNudgeAt = now;
      this.run(this.host.nudge());
    }
  }

  private run(p: Promise<void>): void {
    this.running = p.catch(() => undefined).finally(() => (this.running = undefined));
  }

  // ---------------------------------------------------------------- place

  private lead(): Creature | undefined {
    return this.game.heroes().find((h) => isActive(h) && h.pos);
  }

  place(): Place {
    const map = this.game.map;
    const lead = this.lead();
    const roomIndex = lead?.pos ? (map.roomOf[cellIndex(map, lead.pos.x, lead.pos.y)] ?? -1) : -1;
    const room = map.rooms[roomIndex >= 0 ? roomIndex : 0]!;
    const heroes = this.game.heroes().filter((h) => h.pos && !h.dead);
    const water = heroes.some((h) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (["water", "deep"].includes(map.cells[cellIndex(map, h.pos!.x + dx, h.pos!.y + dy)] ?? "")) return true;
      return false;
    });
    return {
      theme: room.theme,
      outdoor: THEMES[room.theme].outdoor,
      night: !!map.dark,
      water,
      gold: this.game.partyGold(),
      health: heroes.length ? Math.min(...heroes.map((h) => (h.maxHp ? h.hp / h.maxHp : 1))) : 1,
    };
  }

  // ---------------------------------------------------------------- greetings

  private greetings(): void {
    const map = this.game.map;
    const heroes = this.game.heroes().filter((h) => h.pos && !h.dead);
    for (const c of Object.values(this.game.session.battle.creatures)) {
      if (!c.id.startsWith("npc-") || c.side !== "neutral" || !c.pos || this.greeted.has(c.id)) continue;
      if (!map.explored[cellIndex(map, c.pos.x, c.pos.y)]) continue;
      const near = heroes.some((h) => Math.max(Math.abs(h.pos!.x - c.pos!.x), Math.abs(h.pos!.y - c.pos!.y)) <= 3);
      if (!near) continue;
      this.greeted.add(c.id);
      const att = this.host.attitude(c.id.slice(4));
      const pool = GREET[att >= 1 ? "friend" : att <= -1 ? "foe" : "neutral"];
      this.game.narrate([{ npc: c.name, text: pool[this.host.rng.int(0, pool.length - 1)]! }]);
      return;
    }
  }

  // ---------------------------------------------------------------- time pressure

  private async lateConsequence(): Promise<void> {
    const place = this.place();
    const groups = wanderers(place);
    if (groups && place.health > 0.4) {
      this.game.narrate([{ text: "⏳ Ihr habt zu lange gebraucht. Etwas hat eure Spur aufgenommen …" }]);
      await this.host.fight(groups);
      return;
    }
    this.game.narrate([{ text: "⏳ Kälte und Erschöpfung zehren an euch. Weiter, bevor es schlimmer wird!" }]);
    this.apply({ narration: [], hurtAll: "1d4" }, undefined);
  }

  // ---------------------------------------------------------------- events

  private async event(ev: WorldEvent): Promise<void> {
    const game = this.game;
    const lead = this.lead();
    game.narrate([{ text: `✨ ${ev.title}`, tip: { key: "ereignis", text: "Ein Ereignis! Schaut auf eure Handys: Wer zuerst tippt, entscheidet." } }, ...ev.intro]);
    const visitor = ev.visitor ? game.spawnVisitor(ev.visitor.monster, ev.visitor.name, lead) : undefined;
    if (ev.fx) game.fx(ev.fx, lead?.pos);
    try {
      if (ev.auto) {
        const heroes = game.heroes().filter(isActive);
        const who = ev.auto.who === "each" ? heroes : [heroes[this.host.rng.int(0, heroes.length - 1)]!].filter(Boolean);
        for (const h of who) {
          const r = await game.check(h, ev.auto.skill, ev.auto.dc, ev.title);
          await this.apply(r.success ? ev.auto.success : ev.auto.failure, h);
        }
        this.host.remember(`Ereignis: ${ev.title}`);
        return;
      }
      const choices = this.withFights(ev).filter((c) => !c.cost || game.partyGold() >= c.cost);
      if (!choices.length) return;
      const expire = setTimeout(() => game.cancelChoice(), CHOICE_S * 1000);
      const pick = await game.choose(choices.map((c) => ({ id: `event:${c.id}`, label: c.label, detail: c.detail })));
      clearTimeout(expire);
      const choice = choices.find((c) => `event:${c.id}` === pick.id);
      if (!choice) {
        game.narrate([{ text: "Der Moment ist vorbei." }]);
        return;
      }
      const hero = game.heroes().find((h) => h.playerId === pick.playerId && isActive(h)) ?? lead;
      if (choice.cost) this.host.changeGold(-choice.cost);
      this.host.remember(`Ereignis: ${ev.title} – ${hero?.name ?? "die Gruppe"}: ${choice.label.replace(/^\S+\s/, "")}`);
      if (choice.check && hero) {
        const r = await game.check(hero, choice.check.skill, choice.check.dc, choice.label.replace(/^\S+\s/, ""));
        await this.apply(r.success ? choice.check.success : choice.check.failure, hero);
      } else if (choice.outcome) await this.apply(choice.outcome, hero);
    } finally {
      if (visitor) setTimeout(() => game.removeCreature(visitor), 4000);
    }
  }

  /** Wandering monsters: fighting (or failing to hide) starts a fight that fits the place. */
  private withFights(ev: WorldEvent): EventChoice[] {
    const choices = ev.choices ?? [];
    if (ev.id === "waffenhaendler") {
      // Two pieces the group does not have yet, that someone can use.
      const offers: EventChoice[] = [];
      const heroes = this.game.heroes();
      for (let i = 0; i < 6 && offers.length < 2; i++) {
        const id = this.game.randomGear(heroes[i % heroes.length]);
        const g = id ? getGear(id) : undefined;
        if (!g || offers.some((o) => o.id === g.id)) continue;
        offers.push({ id: g.id, label: `${g.icon} ${g.name} (${g.price} Gold)`, detail: g.detail, cost: g.price, outcome: { narration: [{ npc: "Schmiedin Ortrud", text: "Möge es euch gute Dienste leisten!" }], gear: g.id } });
      }
      return [...offers, ...choices];
    }
    if (ev.id !== "wandernde_monster") return choices;
    const groups = wanderers(this.place()) ?? [];
    return choices.map((c) =>
      c.id === "kampf"
        ? { ...c, outcome: { ...c.outcome!, fight: groups } }
        : c.check
          ? { ...c, check: { ...c.check, failure: { ...c.check.failure, fight: groups } } }
          : c,
    );
  }

  private async apply(o: EventOutcome, hero: Creature | undefined): Promise<void> {
    const game = this.game;
    const rng = this.host.rng;
    game.narrate(o.narration);
    if (o.gold) this.host.changeGold(o.gold);
    if (o.item && hero) game.giveItem(o.item, 1, hero);
    if (o.gear && hero) game.grantGear(hero, o.gear, "Gekauft");
    if (o.tempHp && hero) hero.tempHp = Math.max(hero.tempHp, o.tempHp);
    if (o.healAll) for (const h of game.heroes()) if (!h.dead) h.hp = Math.min(h.maxHp, h.hp + rollDice(rng, parseDice(o.healAll)).total);
    const hurt = (h: Creature, dice: string) => {
      const d = rollDice(rng, parseDice(dice)).total;
      // Events hurt, but never knock anyone out.
      applyDamage(rng, h, Math.max(0, Math.min(d, h.hp - 1)));
    };
    if (o.hurt && hero) hurt(hero, o.hurt);
    if (o.hurtAll) for (const h of game.heroes().filter(isActive)) hurt(h, o.hurtAll);
    if (o.fx) game.fx(o.fx, hero?.pos);
    game.broadcast();
    if (o.fight?.length) await this.host.fight(o.fight);
  }

  // ---------------------------------------------------------------- sleeping and watching enemies

  /**
   * The monsters of a fight step have not noticed the heroes: the group decides whether to
   * attack, sneak up (surprise) or talk. Returns the fight's result like GameController.fight.
   */
  async stealthyFight(groups: MonsterGroup[], allies: { monster: string; name: string }[]): Promise<{ winner: "party" | "enemy"; spawned: Creature[] }> {
    const game = this.game;
    const rng = this.host.rng;
    const state = rng.next() < 0.5 ? "asleep" : "on-guard";
    const { spawned, done } = game.stageFight(groups, state, { allies });
    if (!spawned.length) return done;
    const names = describe(spawned);
    const many = spawned.length > 1;
    game.narrate([
      state === "asleep"
        ? { text: `💤 ${names} ${many ? "schlafen" : "schläft"} und ${many ? "haben" : "hat"} euch noch nicht bemerkt.`, tip: { key: "ueberrascht", text: "Schleicht ihr euch an und es gelingt, sind die Gegner überrascht: Ihr dürft zuerst zuschlagen." } }
        : { text: `👀 ${names} ${many ? "halten" : "hält"} Wache, ${many ? "haben" : "hat"} euch aber noch nicht entdeckt.`, tip: { key: "ueberrascht", text: "Kommt ihnen nicht zu nah – sonst entdecken sie euch sofort." } },
    ]);
    const dc = state === "asleep" ? 10 : 13;
    const canTalk = spawned.every((m) => m.creatureType === "humanoid");
    const options = [
      { id: "stealth:attack", label: "⚔️ Angreifen!", detail: "Der Kampf beginnt sofort." },
      { id: "stealth:sneak", label: "🤫 Anschleichen", detail: `Heimlichkeit SG ${dc}: Gelingt es, sind die Gegner überrascht.` },
      ...(canTalk && state === "on-guard" ? [{ id: "stealth:talk", label: "🗣️ Ansprechen", detail: "Überzeugen SG 15: Vielleicht lassen sie euch ziehen." }] : []),
    ];
    const expire = setTimeout(() => game.engage(false, "⏳ Ihr habt zu lange gezögert – sie haben euch entdeckt!"), 45000);
    const pick = await game.choose(options);
    clearTimeout(expire);
    if (!game.hasStagedFight) return done;
    const chooser = game.heroes().find((h) => h.playerId === pick.playerId && isActive(h));
    if (pick.id === "stealth:sneak") {
      // The best sneak goes first.
      const heroes = game.heroes().filter(isActive);
      const best = heroes.sort((a, b) => sumParts(skillParts(b, "stealth")) - sumParts(skillParts(a, "stealth")))[0] ?? chooser;
      if (best) {
        game.narrate([{ text: `${best.name} schleicht voran …` }]);
        const r = await game.check(best, "stealth", dc, "Anschleichen");
        game.engage(r.success, r.success ? "🤫 Angeschlichen! Die Gegner sind überrascht." : "Ein Geräusch – entdeckt! Der Kampf beginnt.");
      } else game.engage(false);
    } else if (pick.id === "stealth:talk" && chooser) {
      const r = await game.check(chooser, "persuasion", 15, "Ansprechen");
      if (!game.hasStagedFight) return done;
      if (r.success) {
        game.narrate([{ text: `Nach ein paar ruhigen Worten nicken ${names} und lassen euch ziehen.` }]);
        game.pacifyStaged();
      } else game.engage(false, "Sie lassen nicht mit sich reden – zu den Waffen!");
    } else game.engage(false);
    return done;
  }

  /**
   * Before the boss fight: the boss has not noticed the heroes yet. They get a moment to prepare –
   * pour oil, set tripwires, flip tables, drink potions, take position – then strike when everyone is ready.
   * Walking too close wakes the boss early.
   */
  async ambushFight(groups: MonsterGroup[], allies: { monster: string; name: string }[], seconds = 150): Promise<{ winner: "party" | "enemy"; spawned: Creature[] }> {
    const game = this.game;
    const { spawned, done } = game.stageFight(groups, "asleep", { allies });
    if (!spawned.length) return done;
    const boss = spawned.find((m) => game.isBoss(m.id)) ?? spawned[0]!;
    game.narrate([
      {
        text: `🤫 ${boss.name} hat euch noch nicht bemerkt. Ihr habt einen Moment, um einen Hinterhalt vorzubereiten!`,
        tip: { key: "hinterhalt", text: "Gießt Öl aus, spannt Stolperdrähte, werft Tische als Deckung um, trinkt Tränke, stellt euch auf erhöhte Plätze. Kommt dem Gegner nicht zu nah! Wenn alle bereit sind: „Losschlagen!“." },
      },
    ]);
    game.banner({ icon: "🤫", title: "Hinterhalt vorbereiten", text: `${boss.name} ahnt nichts – bereitet euch vor. Nicht zu nah herangehen!` });
    const expire = setTimeout(() => game.engage(false, "⏳ Genug gewartet – der Gegner wittert euch! Der Kampf beginnt."), seconds * 1000);
    await game.choose([{ id: "ambush:go", label: "⚔️ Bereit – losschlagen!", detail: "Stimmt ab, wenn alles vorbereitet ist." }], { vote: true });
    clearTimeout(expire);
    game.banner(undefined);
    if (game.hasStagedFight) game.engage(false, "⚔️ Der Hinterhalt ist gestellt – jetzt!");
    return done;
  }
}

function describe(spawned: Creature[]): string {
  const names = [...new Set(spawned.map((m) => m.name.replace(/ \d+$/, "")))];
  if (spawned.length === 1) return spawned[0]!.name;
  return names.length === 1 ? `${spawned.length} × ${names[0]}` : names.join(" und ");
}

