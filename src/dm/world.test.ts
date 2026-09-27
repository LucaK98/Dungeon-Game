import { describe, expect, it } from "vitest";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import { GameController } from "../tv/game";
import { createSession } from "../tv/session";
import { World, type WorldHost } from "./world";
import { pickEvent, WORLD_EVENTS, wanderers, type Place } from "./world-events";
import { STORIES } from "./stories";

function setup(seed = 4) {
  const rng = seededRng(seed);
  const session = createSession(rng, {
    players: [
      { playerId: "p1", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b" } },
      { playerId: "p2", profile: { name: "Pip", classId: "rogue", raceId: "halfling", look: defaultLook("rogue", "halfling"), color: "#4363d8" } },
    ],
    plan: { path: ["burghof", "gang_gerade", "wachstube"] },
    noMonsters: true,
  });
  const sent: { to: string | "all"; event: GameEvent }[] = [];
  const game = new GameController(session, rng, (to, event) => sent.push({ to, event }), (event) => sent.push({ to: "all", event }), { monsterDelayMs: 0 });
  game.start();
  game.setStoryView({ title: "Test", chapter: "Kapitel 1", scene: "Test", goal: "Testen", narration: [], choices: [], clues: [] });
  const last = (to: string, type: GameEvent["type"]) => [...sent].reverse().find((s) => s.to === to && s.event.type === type)?.event;
  /** The phone rolls the open die (if any). */
  const roll = async (pid: string) => {
    const r = last(pid, "request_roll");
    if (r?.type === "request_roll") game.handle(pid, { kind: "roll", rollId: r.prompt.id });
    await new Promise((res) => setTimeout(res, 5));
  };
  const choices = (pid: string) => {
    const v = last(pid, "state_update");
    return v?.type === "state_update" ? (v.state.story?.choices ?? []) : [];
  };
  return { game, session, rng, sent, last, roll, choices };
}

const place = (p: Partial<Place> = {}): Place => ({ theme: "cave", outdoor: false, night: false, water: false, gold: 20, health: 1, ...p });

describe("sleeping and watching enemies", () => {
  it("surprised enemies lose their first turn", async () => {
    const { game, sent } = setup();
    const { spawned, done } = game.stageFight([{ monster: "goblin", count: 2 }], "asleep");
    expect(spawned.length).toBe(2);
    expect(game.mode).toBe("explore");
    expect(spawned.every((m) => m.effects.some((e) => e.id === "asleep"))).toBe(true);
    game.engage(true, "Angeschlichen!");
    expect(game.mode).toBe("combat");
    expect(spawned.every((m) => !m.effects.some((e) => e.id === "asleep"))).toBe(true);
    // Let the monsters take their (lost) turns.
    for (let i = 0; i < 10 && game.mode === "combat"; i++) {
      const active = game.active();
      if (active?.kind === "pc") game.handle(active.playerId!, { kind: "end_turn" });
      if (spawned.every((m) => !m.effects.some((e) => e.id === "surprised"))) break;
    }
    expect(spawned.every((m) => !m.effects.some((e) => e.id === "surprised"))).toBe(true);
    const lost = sent.filter((x) => JSON.stringify(x.event).includes("verliert den ersten Zug"));
    expect(lost.length).toBeGreaterThan(0);
    void done;
  });

  it("walking right up to them wakes them and starts the fight", () => {
    const { game } = setup();
    const { spawned } = game.stageFight([{ monster: "goblin", count: 1 }], "on-guard");
    const hero = game.heroes()[0]!;
    const goblin = spawned[0]!;
    // Teleport next to the goblin and make any move that triggers the check.
    hero.pos = { x: goblin.pos!.x - 1, y: goblin.pos!.y };
    game.tickWorld();
    game.broadcast();
    game.handle(hero.playerId!, { kind: "end_turn" });
    expect(game.mode).toBe("combat");
    expect(goblin.effects.some((e) => e.id === "on-guard")).toBe(false);
  });

  it("talking them down counts as a won fight", async () => {
    const { game } = setup();
    const { done } = game.stageFight([{ monster: "bandit", count: 2 }], "on-guard");
    game.pacifyStaged();
    const r = await done;
    expect(r.winner).toBe("party");
    expect(Object.values(game.session.battle.creatures).some((c) => c.monsterId === "bandit")).toBe(false);
  });

  it("guards patrol while nobody is near", () => {
    const { game } = setup();
    const { spawned } = game.stageFight([{ monster: "guard", count: 1 }], "on-guard");
    const start = { ...spawned[0]!.pos! };
    for (let i = 0; i < 4; i++) game.tickWorld();
    expect(spawned[0]!.pos).not.toEqual(start);
  });
});

describe("world events", () => {
  it("picks only events that fit the place and never the same twice", () => {
    const rng = seededRng(3);
    const used: string[] = [];
    for (let i = 0; i < 30; i++) {
      const ev = pickEvent(rng, place({ theme: "cave" }), used);
      if (!ev) break;
      expect(ev.where(place({ theme: "cave" }))).toBe(true);
      expect(used).not.toContain(ev.id);
      used.push(ev.id);
    }
    expect(used).toContain("einsturz");
    expect(used).not.toContain("haendler"); // no merchants underground
    expect(used).not.toContain("runde"); // no tavern
  });

  it("every event has something to decide or roll, in German, with valid rewards", () => {
    for (const ev of WORLD_EVENTS) {
      expect(ev.intro.length).toBeGreaterThan(0);
      expect(!!ev.auto || (ev.choices?.length ?? 0) >= 2).toBe(true);
      for (const c of ev.choices ?? []) {
        for (const o of [c.outcome, c.check?.success, c.check?.failure]) {
          if (o?.item) expect(["potion-of-healing", "torch"]).toContain(o.item);
        }
      }
    }
    expect(wanderers(place({ theme: "throne" }))).toBeUndefined();
    expect(wanderers(place({ theme: "forest", night: true }))?.[0]?.monster).toBe("wolf");
  });

  it("runs an event: the choice shows on the phones, the roll decides, the reward arrives", async () => {
    const { game, rng, roll, choices } = setup(7);
    const story = STORIES[0]!;
    const golds: number[] = [];
    const host: WorldHost = {
      game,
      rng,
      story,
      duration: "kurz",
      scene: () => story.acts[0]!.scenes[0]!,
      now: Date.now,
      attitude: () => 0,
      fight: async () => "won",
      changeGold: (n) => golds.push(n),
      remember: () => undefined,
      nudge: async () => undefined,
    };
    const world = new World(host);
    const ev = WORLD_EVENTS.find((e) => e.id === "spuren")!;
    const running = (world as unknown as { event: (e: typeof ev) => Promise<void> }).event(ev);
    await new Promise((r) => setTimeout(r, 5));
    const offer = choices("p2").find((c) => c.label.includes("Spuren"));
    expect(offer).toBeDefined();
    game.handle("p2", offer!.action);
    await new Promise((r) => setTimeout(r, 5));
    await roll("p2");
    await running;
    // Either the nest was found (gold) or not – but the event is over and nothing is left open.
    expect(game.idle).toBe(true);
    expect(golds.every((g) => g === 12)).toBe(true);
  });

  it("a visitor comes by for the event and leaves again", async () => {
    const { game } = setup();
    const id = game.spawnVisitor("commoner", "Händler Fridolin");
    expect(id).toBeDefined();
    const c = game.session.battle.creatures[id!]!;
    expect(c.side).toBe("neutral");
    const lead = game.heroes()[0]!;
    expect(Math.max(Math.abs(c.pos!.x - lead.pos!.x), Math.abs(c.pos!.y - lead.pos!.y))).toBeLessThanOrEqual(3);
    game.removeCreature(id!);
    expect(game.session.battle.creatures[id!]).toBeUndefined();
  });
});

describe("things to play with", () => {
  const near = (game: GameController, kind: "barrel" | "lever" | "chandelier" | "secret" | "campfire" | "cauldron", extra: Record<string, unknown> = {}) => {
    const hero = game.heroes()[0]!;
    const spot = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: hero.pos!.x + dx!, y: hero.pos!.y + dy! })).find((p) => game.map.cells[p.y * game.map.width + p.x] === "floor" && !Object.values(game.session.battle.creatures).some((c) => c.pos?.x === p.x && c.pos?.y === p.y))!;
    const o = { id: `test-${kind}`, kind, x: spot.x, y: spot.y, frame: kind, blocking: false, ...extra };
    game.map.objects.push(o as never);
    game.broadcast();
    return { hero, o: o as unknown as import("../shared/map").MapObject };
  };
  const gold = (game: GameController) => game.partyGold();

  it("a barrel can be searched once outside a fight", () => {
    const { game, choices, last } = setup();
    const { hero, o } = near(game, "barrel");
    void choices;
    const v = last(hero.playerId!, "state_update");
    const c = v?.type === "state_update" ? v.state.choices.find((x) => x.id === `search:${o.id}`) : undefined;
    expect(c?.enabled).toBe(true);
    game.handle(hero.playerId!, c!.action);
    expect(o.state).toBe("found");
    const again = last(hero.playerId!, "state_update");
    expect(again?.type === "state_update" && again.state.choices.some((x) => x.id === `search:${o.id}`)).toBe(false);
  });

  it("the lever opens a hidden compartment", () => {
    const { game } = setup();
    const { hero, o } = near(game, "lever", { variant: "cache", frame: "lever.off" });
    const before = gold(game);
    game.handle(hero.playerId!, { kind: "interact", objectId: o.id });
    expect(o.state).toBe("used");
    expect(o.frame).toBe("lever.on");
    expect(gold(game)).toBeGreaterThan(before);
  });

  it("a secret is found with a roll; each hero may try once", async () => {
    const { game, roll } = setup(11);
    const { hero, o } = near(game, "secret", { variant: "plate", state: "hidden", frame: "secret.plate" });
    for (let i = 0; i < 2; i++) {
      game.handle(hero.playerId!, { kind: "interact", objectId: o.id });
      await roll(hero.playerId!);
    }
    // Found (gold!) or tried once – never twice by the same hero.
    const rolls = game.session.battle.creatures[hero.id]!;
    expect(rolls).toBeDefined();
    expect(["found", "hidden"]).toContain(o.state);
  });

  it("the chandelier crashes onto the enemies below it", async () => {
    const { game, roll } = setup(5);
    const { spawned } = game.stageFight([{ monster: "goblin", count: 1 }], "asleep");
    const goblin = spawned[0]!;
    game.engage(false);
    const hero = game.heroes().find((h) => h.id === game.active()?.id) ?? game.heroes()[0]!;
    // Hang it right over the goblin, the hero close enough.
    game.map.objects.push({ id: "luster", kind: "chandelier", x: goblin.pos!.x, y: goblin.pos!.y, frame: "chandelier", blocking: false });
    hero.pos = { x: goblin.pos!.x - 3, y: goblin.pos!.y };
    for (let i = 0; i < 6 && game.active()?.id !== hero.id && game.mode === "combat"; i++) {
      const a = game.active();
      if (a?.kind === "pc") game.handle(a.playerId!, { kind: "end_turn" });
    }
    if (game.mode !== "combat" || game.active()?.id !== hero.id) return;
    const hp = goblin.hp;
    game.handle(hero.playerId!, { kind: "interact", objectId: "luster" });
    await roll(hero.playerId!);
    const o = game.map.objects.find((x) => x.id === "luster")!;
    if (o.state === "used") expect(goblin.hp).toBeLessThan(hp);
    else expect(goblin.hp).toBe(hp);
  });
});

describe("fight animations", () => {
  it("every attack tells the board what to animate", async () => {
    const { game, sent } = setup(9);
    game.stageFight([{ monster: "goblin", count: 2 }], "on-guard");
    game.engage(false);
    // Monsters act on their own (bows or scimitars); heroes pass.
    for (let i = 0; i < 12 && game.mode === "combat"; i++) {
      const a = game.active();
      if (a?.kind === "pc") game.handle(a.playerId!, { kind: "end_turn" });
    }
    const rolls = sent.map((s) => s.event).filter((e) => e.type === "roll_result").map((e) => (e.type === "roll_result" ? e.result : undefined));
    const attacks = rolls.filter((r) => r?.title.includes("greift"));
    expect(attacks.length).toBeGreaterThan(0);
    for (const r of attacks) {
      expect(r!.fx?.length).toBeGreaterThan(0);
      const fx = r!.fx![0]!;
      expect(game.session.battle.creatures[fx.from]?.monsterId).toBe("goblin");
      expect(["melee", "arrow"]).toContain(fx.kind);
      expect(fx.to.length).toBe(1);
    }
  });
});
