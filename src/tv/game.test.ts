import { describe, expect, it } from "vitest";
import { scriptedRng, seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import { GameController } from "./game";
import { createSession } from "./session";

function setup(seed = 4, opts: { free?: boolean } = {}) {
  const rng = seededRng(seed);
  const session = createSession(rng, {
    players: [
      { playerId: "p1", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b" } },
      { playerId: "p2", profile: { name: "Ilmarin", classId: "wizard", raceId: "elf", look: defaultLook("wizard", "elf"), color: "#4363d8" } },
    ],
    plan: { path: ["burghof", "gang_gerade", "wachstube"] },
  });
  const sent: { to: string | "all"; event: GameEvent }[] = [];
  const game = new GameController(session, rng, (to, event) => sent.push({ to, event }), (event) => sent.push({ to: "all", event }), { turnBasedExplore: !opts.free });
  game.start();
  const last = (to: string, type: GameEvent["type"]) => [...sent].reverse().find((s) => s.to === to && s.event.type === type)?.event;
  return { game, session, sent, last };
}

describe("free exploration (everyone at the same time)", () => {
  it("lets every hero act without waiting for a turn", () => {
    const { last } = setup(4, { free: true });
    const v1 = last("p1", "state_update");
    const v2 = last("p2", "state_update");
    expect(v1?.type === "state_update" && v1.state.turn.mine && v1.state.turn.free).toBe(true);
    expect(v2?.type === "state_update" && v2.state.turn.mine && v2.state.turn.free).toBe(true);
    expect(v2?.type === "state_update" && v2.state.choices.some((c) => c.id === "end")).toBe(false);
  });

  it("handles moves of different players one after another, none is cut off", () => {
    const { game, last } = setup(4, { free: true });
    const reach = (pid: string) => {
      const v = last(pid, "state_update");
      return v?.type === "state_update" ? v.state.minimap.reachable : [];
    };
    const p1 = game.heroOf("p1")!;
    const p2 = game.heroOf("p2")!;
    const to2 = reach("p2").find((q) => q.x !== p2.pos!.x || q.y !== p2.pos!.y)!;
    game.handle("p2", { kind: "move", to: to2 });
    expect(p2.pos).toEqual(to2);
    const to1 = reach("p1").find((q) => (q.x !== p1.pos!.x || q.y !== p1.pos!.y) && (q.x !== to2.x || q.y !== to2.y))!;
    game.handle("p1", { kind: "move", to: to1 });
    expect(p1.pos).toEqual(to1);
    // p2 can go on right away, with fresh movement.
    const again = reach("p2").find((q) => q.x !== p2.pos!.x || q.y !== p2.pos!.y)!;
    game.handle("p2", { kind: "move", to: again });
    expect(p2.pos).toEqual(again);
  });

  it("queues an action while someone else is rolling and runs it afterwards", async () => {
    const { game, last } = setup(4, { free: true });
    game.handle("p1", { kind: "check", skill: "perception" });
    const roll = last("p1", "request_roll");
    expect(roll).toBeDefined();
    const p2 = game.heroOf("p2")!;
    const v2 = last("p2", "state_update");
    const to = (v2?.type === "state_update" ? v2.state.minimap.reachable : []).find((q) => q.x !== p2.pos!.x || q.y !== p2.pos!.y)!;
    const before = { ...p2.pos! };
    game.handle("p2", { kind: "move", to });
    expect(p2.pos).toEqual(before); // waits
    game.handle("p1", { kind: "roll", rollId: roll!.type === "request_roll" ? roll!.prompt.id : "" });
    await new Promise((r) => setTimeout(r, 5));
    expect(p2.pos).toEqual(to); // done right after the roll
  });
});

describe("game controller", () => {
  it("sends every phone its own view and starts with the first hero", () => {
    const { last } = setup();
    const v1 = last("p1", "state_update");
    const v2 = last("p2", "state_update");
    expect(v1?.type === "state_update" && v1.state.turn.mine).toBe(true);
    expect(v2?.type === "state_update" && v2.state.turn.mine).toBe(false);
    expect(v2?.type === "state_update" && v2.state.turn.activeName).toBe("Brunhild");
  });

  it("hands a hero to a new phone when the old one lost its ID", () => {
    const { game, last } = setup();
    game.reassignPlayer("p1", "neu");
    const v = last("neu", "state_update");
    expect(v?.type === "state_update" && v.state.turn.mine).toBe(true);
    expect(game.heroOf("p1")).toBeUndefined();
    game.handle("neu", { kind: "end_turn" });
    expect(game.active()!.name).toBe("Ilmarin");
  });

  it("only lets the active player act", () => {
    const { game, last } = setup();
    game.handle("p2", { kind: "end_turn" });
    expect(last("p2", "action_error")).toBeDefined();
    expect(game.active()!.name).toBe("Brunhild");
    game.handle("p1", { kind: "end_turn" });
    expect(game.active()!.name).toBe("Ilmarin");
  });

  it("moves to a reachable square and offers only reachable squares", () => {
    const { game, last } = setup();
    const v = last("p1", "state_update");
    if (v?.type !== "state_update") throw new Error("no view");
    const target = v.state.minimap.reachable[0]!;
    game.handle("p1", { kind: "move", to: target });
    expect(game.heroOf("p1")!.pos).toEqual(target);
    game.handle("p1", { kind: "move", to: { x: 999, y: 999 } });
    expect(last("p1", "action_error")).toBeDefined();
  });

  it("asks the phone to roll and publishes the explained result", () => {
    const { game, last, sent } = setup();
    game.handle("p1", { kind: "check", skill: "perception" });
    const req = last("p1", "request_roll");
    expect(req?.type === "request_roll" && req.prompt.sides).toBe(20);
    if (req?.type !== "request_roll") return;
    // Other actions wait until the die is rolled.
    game.handle("p1", { kind: "end_turn" });
    expect(last("p1", "action_error")).toBeDefined();
    game.handle("p1", { kind: "roll", rollId: req.prompt.id });
    const res = sent.reverse().find((s) => s.event.type === "roll_result")?.event;
    expect(res?.type === "roll_result" && res.result.lines.some((l) => /gegen SG 12/.test(l.text))).toBe(true);
  });

  it("marks one recommended action in beginner mode", () => {
    const { last } = setup();
    const v = last("p1", "state_update");
    expect(v?.type === "state_update" && v.state.choices.filter((c) => c.recommended).length).toBeLessThanOrEqual(1);
    expect(v?.type === "state_update" && v.state.choices.find((c) => c.id === "end")?.enabled).toBe(true);
  });

  it("explains why attacks are not possible", () => {
    const { last } = setup();
    const v = last("p1", "state_update");
    if (v?.type !== "state_update") throw new Error();
    const sword = v.state.choices.find((c) => c.id === "attack:longsword")!;
    expect(sword.enabled).toBe(false);
    expect(sword.reason).toMatch(/Gegner/);
  });

  it("opens chests next to the hero", () => {
    const { game, session } = setup();
    const chest = session.map.objects.find((o) => o.kind === "chest")!;
    const hero = game.heroOf("p1")!;
    hero.pos = { x: chest.x - 1, y: chest.y };
    void scriptedRng;
    game.handle("p1", { kind: "interact", objectId: chest.id });
    expect(chest.state).toBe("open");
    const inv = hero.pc!.inventory;
    expect(inv.some((i) => i.itemId === "gold") || (inv.find((i) => i.itemId === "potion-of-healing")?.qty ?? 0) > 1).toBe(true);
  });
});

describe("six players", () => {
  it("gives every hero its own start square", () => {
    const rng = seededRng(2);
    const classes = ["fighter", "paladin", "wizard", "rogue", "cleric", "fighter"];
    const session = createSession(rng, {
      players: classes.map((c, i) => ({ playerId: `p${i}`, profile: { name: `H${i}`, classId: c, raceId: "human", look: defaultLook(c, "human"), color: "#fff" } })),
      plan: { path: ["bruecke", "gang_gerade"] },
    });
    const spots = session.partyIds.map((id) => JSON.stringify(session.battle.creatures[id]!.pos));
    expect(new Set(spots).size).toBe(6);
    expect(spots.every((s) => s !== undefined)).toBe(true);
  });
});

describe("night on the phone map", () => {
  it("shows only what the hero can see and hides enemies in the dark", () => {
    const { game } = setup(4, { free: true });
    const hero = game.heroOf("p1")!; // human fighter: no darkvision
    hero.darkvisionFt = 0;
    game.map.dark = true;
    // No wall torches, braziers or glowing mushrooms here: only the hero's own light counts.
    game.map.overlays = {};
    game.map.objects = game.map.objects.filter((o) => o.kind !== "prop" && o.kind !== "campfire" && o.kind !== "cauldron");
    game.session.battle.darkness = { lights: [] };
    game.spawnNearParty(["goblin"]);
    const goblin = Object.values(game.session.battle.creatures).find((c) => c.monsterId === "goblin")!;
    const view = () => game.viewFor("p1")!.minimap;
    const m = view();
    expect(m.light).toBeDefined();
    expect(m.light!.length).toBe(m.w * m.h);
    expect(m.light).not.toContain("0");
    expect(m.creatures.some((c) => c.id === goblin.id)).toBe(false);
    expect(m.creatures.some((c) => c.me)).toBe(true);
    // A torch in the hand lights the surroundings: the goblin is visible if close enough.
    hero.effects.push({ id: "torch", rounds: 600, sourceId: hero.id });
    const lit = view();
    expect(lit.light).toContain("0");
    const d = Math.max(Math.abs(goblin.pos!.x - hero.pos!.x), Math.abs(goblin.pos!.y - hero.pos!.y));
    expect(lit.creatures.some((c) => c.id === goblin.id)).toBe(d * 5 <= 20);
  });
});

describe("group votes", () => {
  function voteSetup(players = 3) {
    const rng = seededRng(4);
    const names = ["Brunhild", "Ilmarin", "Pip"];
    const session = createSession(rng, {
      players: names.slice(0, players).map((name, i) => ({ playerId: `p${i + 1}`, profile: { name, classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b" } })),
      plan: { path: ["burghof"] },
      noMonsters: true,
    });
    const game = new GameController(session, rng, () => {}, () => {}, { monsterDelayMs: 0 });
    game.start();
    return game;
  }
  const offers = [
    { id: "a", label: "Kämpfen", detail: "" },
    { id: "b", label: "Reden", detail: "", recommended: true },
  ];

  it("waits for everyone and follows the majority, votes may change", async () => {
    const game = voteSetup();
    let result: { id: string; playerId: string } | undefined;
    void game.choose(offers, { vote: true }).then((r) => (result = r));
    game.handle("p1", { kind: "story_choice", choiceId: "b" });
    game.handle("p1", { kind: "story_choice", choiceId: "a" });
    game.handle("p2", { kind: "story_choice", choiceId: "a" });
    await Promise.resolve();
    expect(result).toBeUndefined();
    expect(game.viewFor("p3")!.story).toBeUndefined();
    game.handle("p3", { kind: "story_choice", choiceId: "b" });
    await Promise.resolve();
    expect(result?.id).toBe("a");
    expect(result?.playerId).toBe("p1");
  });

  it("a tie goes to the recommended option", async () => {
    const game = voteSetup(2);
    let result: { id: string } | undefined;
    void game.choose(offers, { vote: true }).then((r) => (result = r));
    game.handle("p1", { kind: "story_choice", choiceId: "a" });
    game.handle("p2", { kind: "story_choice", choiceId: "b" });
    await Promise.resolve();
    expect(result?.id).toBe("b");
  });

  it("a single player decides at once", async () => {
    const game = voteSetup(1);
    let result: { id: string } | undefined;
    void game.choose(offers, { vote: true }).then((r) => (result = r));
    game.handle("p1", { kind: "story_choice", choiceId: "a" });
    await Promise.resolve();
    expect(result?.id).toBe("a");
  });
});

describe("hero book levels", () => {
  it("a hero from the book who wins an adventure goes one level up (to 5 at most)", () => {
    const rng = seededRng(4);
    const legacy = (level: number) => ({ level, gold: 0, potions: 1, gear: { owned: [] }, stories: ["Alt"] });
    const session = createSession(rng, {
      players: [
        { playerId: "p1", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b", legacy: legacy(3) } },
        { playerId: "p2", profile: { name: "Mira", classId: "wizard", raceId: "elf", look: defaultLook("wizard", "elf"), color: "#4363d8", legacy: legacy(5) } },
        { playerId: "p3", profile: { name: "Neu", classId: "rogue", raceId: "human", look: defaultLook("rogue", "human"), color: "#3cb44b" } },
      ],
      plan: { path: ["burghof"] },
      noMonsters: true,
    });
    const sent: { to: string; event: GameEvent }[] = [];
    const game = new GameController(session, rng, (to, event) => sent.push({ to, event }), () => {}, { monsterDelayMs: 0 });
    game.start();
    game.saveHeroes("Neu", { won: true, difficulty: "normal" });
    const level = (pid: string) => {
      const e = sent.find((s) => s.to === pid && s.event.type === "hero_saved")?.event;
      return e?.type === "hero_saved" ? e.hero.legacy.level : undefined;
    };
    expect(level("p1")).toBe(4);
    expect(level("p2")).toBe(5);
    expect(level("p3")).toBe(2);
  });
});

describe("free text: walking and asking", () => {
  it("„Ich gehe zu Ilmarin“ walks next to Ilmarin (as far as the turn allows)", async () => {
    const { game, session } = setup(4);
    const { isWalkable } = await import("../map/walk");
    const { cellIndex } = await import("../shared/map");
    const p1 = game.heroOf("p1")!;
    const p2 = game.heroOf("p2")!;
    const map = session.map;
    // Put Ilmarin a few squares away on a free, explored square.
    let spot: { x: number; y: number } | undefined;
    for (let y = 0; y < map.height && !spot; y++) {
      for (let x = 0; x < map.width && !spot; x++) {
        const d = Math.max(Math.abs(x - p1.pos!.x), Math.abs(y - p1.pos!.y));
        if (d >= 4 && d <= 5 && isWalkable(map, { x, y }) && map.explored[cellIndex(map, x, y)]) spot = { x, y };
      }
    }
    expect(spot).toBeDefined();
    p2.pos = spot!;
    game.broadcast();
    game.handle("p1", { kind: "free_text", text: "Ich gehe zu Ilmarin" });
    expect(Math.max(Math.abs(p1.pos!.x - spot!.x), Math.abs(p1.pos!.y - spot!.y))).toBe(1);
  });
});

describe("easier controls", () => {
  const viewOf = (last: ReturnType<typeof setup>["last"], pid: string) => {
    const v = last(pid, "state_update");
    if (v?.type !== "state_update") throw new Error("no view");
    return v.state;
  };

  it("takes back a quiet step (↩️ Zurück), but not after another action", () => {
    let tested = false;
    for (let k = 0; k < 8 && !tested; k++) {
      const { game, last, session } = setup(4);
      const hero = game.heroOf("p1")!;
      const from = { ...hero.pos! };
      const ft = session.battle.combat?.turn?.movementLeftFt;
      const near = viewOf(last, "p1").minimap.reachable.filter((q) => Math.max(Math.abs(q.x - from.x), Math.abs(q.y - from.y)) === 1);
      const to = near[k];
      if (!to) break;
      game.handle("p1", { kind: "move", to });
      if (!viewOf(last, "p1").turn.canUndo) continue;
      game.handle("p1", { kind: "undo_move" });
      expect(hero.pos).toEqual(from);
      expect(session.battle.combat?.turn?.movementLeftFt).toBe(ft);
      expect(viewOf(last, "p1").turn.canUndo).toBeFalsy();
      // After something else, the step stays.
      game.handle("p1", { kind: "move", to });
      game.handle("p1", { kind: "check", skill: "perception" });
      game.handle("p1", { kind: "undo_move" });
      expect(hero.pos).toEqual(to);
      tested = true;
    }
    expect(tested).toBe(true);
  });

  it("walks to an object further away and names what can be done with it", () => {
    const { game, last } = setup(4);
    const hero = game.heroOf("p1")!;
    const v = viewOf(last, "p1");
    const d = (o: { x: number; y: number }) => Math.max(Math.abs(o.x - hero.pos!.x), Math.abs(o.y - hero.pos!.y));
    const thing = v.minimap.objects.filter((o) => o.use && d(o) > 1).sort((a, b) => d(a) - d(b))[0];
    expect(thing, "an object to use").toBeDefined();
    expect(thing!.name).toBeTruthy();
    const before = d(thing!);
    game.handle("p1", { kind: "go_use", objectId: thing!.id });
    expect(d(thing!)).toBeLessThan(before);
  });
});
