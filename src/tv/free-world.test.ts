import { describe, expect, it } from "vitest";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import type { MapObject } from "../shared/map";
import { cellIndex } from "../shared/map";
import { createMonster } from "../engine/creatures";
import { GameController } from "./game";
import { createSession } from "./session";

function setup() {
  const rng = seededRng(7);
  const session = createSession(rng, {
    players: [
      { playerId: "p1", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b" } },
      { playerId: "p2", profile: { name: "Ilmarin", classId: "wizard", raceId: "elf", look: defaultLook("wizard", "elf"), color: "#4363d8" } },
    ],
    plan: { path: ["burghof", "gang_gerade", "wachstube"] },
    noMonsters: true,
  });
  const sent: { to: string; event: GameEvent }[] = [];
  const game = new GameController(session, rng, (to, event) => sent.push({ to, event }), () => {}, { turnBasedExplore: false });
  game.start();
  session.map.explored.fill(true);
  const a = game.heroOf("p1")!;
  const b = game.heroOf("p2")!;
  const floorNear = (p: { x: number; y: number }, taken: { x: number; y: number }[] = []) => {
    for (let r = 1; r < 6; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (session.map.cells[cellIndex(session.map, q.x, q.y)] !== "floor") continue;
          if (Object.values(session.battle.creatures).some((c) => c.pos?.x === q.x && c.pos?.y === q.y) || session.map.objects.some((o) => o.x === q.x && o.y === q.y) || taken.some((t) => t.x === q.x && t.y === q.y)) continue;
          return q;
        }
    throw new Error("no floor");
  };
  const put = (o: Omit<MapObject, "id">) => {
    const obj = { id: `t${session.map.objects.length}`, ...o } as MapObject;
    session.map.objects.push(obj);
    return obj;
  };
  return { game, session, a, b, floorNear, put, sent };
}

describe("free actions change the map", () => {
  it("climbing onto a table makes the hero stand high; walking on ends it", () => {
    const { game, session, a, floorNear, put } = setup();
    const spot = floorNear(a.pos!);
    put({ kind: "prop", prop: "table", x: spot.x, y: spot.y, frame: "table", blocking: true });
    a.pos = floorNear(spot);
    const lines = game.applyEffects([{ kind: "climb" }], a);
    expect(lines.join(" ")).toContain("klettert");
    expect(session.battle.terrain!.high).toContain(`${a.pos.x},${a.pos.y}`);
  });

  it("sets the ground on fire, spills oil, freezes it", () => {
    const { game, session, a } = setup();
    game.applyEffects([{ kind: "ground", target: `${a.pos!.x + 1},${a.pos!.y}`, surface: "oil" }], a);
    expect(Object.values(session.map.surface ?? {}).some((s) => s.kind === "oil")).toBe(true);
    game.applyEffects([{ kind: "ground", target: `${a.pos!.x + 1},${a.pos!.y}`, surface: "fire" }], a);
    expect(Object.values(session.map.surface ?? {}).some((s) => s.kind === "fire")).toBe(true);
  });

  it("rolls a barrel into an enemy (damage, knocked down), smashes and topples things", () => {
    const { game, session, a, floorNear, put } = setup();
    const p = a.pos!;
    // A straight line: hero, barrel, free, goblin.
    let dir = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].find((d) => [1, 2, 3].every((n) => session.map.cells[cellIndex(session.map, p.x + d.x * n, p.y + d.y * n)] === "floor" && !Object.values(session.battle.creatures).some((c) => c.pos?.x === p.x + d.x * n && c.pos?.y === p.y + d.y * n)))!;
    expect(dir).toBeTruthy();
    const barrel = put({ kind: "barrel", x: p.x + dir.x, y: p.y + dir.y, frame: "barrel", blocking: true });
    const gob = createMonster("goblin", "g1");
    gob.pos = { x: p.x + dir.x * 3, y: p.y + dir.y * 3 };
    session.battle.creatures[gob.id] = gob;
    const hp = gob.hp;
    const line = game.applyEffects([{ kind: "object", target: barrel.id, how: "roll", toward: gob.id }], a).join(" ");
    expect(line).toContain("rollt");
    expect(gob.hp).toBeLessThan(hp);
    const table = put({ kind: "prop", prop: "table", ...floorNear(p), frame: "table", blocking: true });
    game.applyEffects([{ kind: "object", target: table.id, how: "topple" }], a);
    expect(table.prop).toBe("table-flipped");
    game.applyEffects([{ kind: "object", target: table.id, how: "smash" }], a);
    expect(table.state).toBe("used");
  });

  it("builds one barricade, sets a trap, lights a torch", () => {
    const { game, session, a } = setup();
    const before = session.map.objects.length;
    game.applyEffects([{ kind: "barricade" }], a);
    expect(session.map.objects.length).toBe(before + 1);
    expect(game.applyEffects([{ kind: "barricade" }], a).join(" ")).toContain("zweite");
    game.applyEffects([{ kind: "set_trap" }], a);
    expect(session.map.objects.some((o) => o.variant === "wire")).toBe(true);
    game.giveItem("torch", 1, a);
    game.applyEffects([{ kind: "light", on: true }], a);
    expect(a.effects.some((e) => e.id === "torch")).toBe(true);
  });

  it("characters follow, show the way and give something only once", () => {
    const { game, session, a, floorNear } = setup();
    const npc = createMonster("commoner", "npc-wirt", { name: "Wirt Otto", side: "neutral" });
    npc.pos = floorNear(a.pos!);
    session.battle.creatures[npc.id] = npc;
    game.applyEffects([{ kind: "npc", target: npc.id, how: "follow" }], a);
    expect(npc.followId).toBe(a.id);
    const gold = () => a.pc!.inventory.find((i) => i.itemId === "gold")?.qty ?? 0;
    const g0 = gold();
    game.applyEffects([{ kind: "npc_gift", target: npc.id, item: "gold" }], a);
    expect(gold()).toBeGreaterThan(g0);
    expect(game.applyEffects([{ kind: "npc_gift", target: npc.id, item: "gold" }], a).join(" ")).toContain("schon");
    expect(game.surroundings(a)!.people!.some((p) => p.id === npc.id)).toBe(true);
  });

  it("in a fight: an enemy changes sides, another runs off, an improvised blow hurts", () => {
    const { game, session, a, floorNear } = setup();
    const g1 = createMonster("goblin", "m1");
    g1.pos = floorNear(a.pos!);
    const g2 = createMonster("goblin", "m2");
    g2.pos = floorNear(a.pos!, [g1.pos]);
    const g3 = createMonster("goblin", "m3");
    g3.pos = floorNear(a.pos!, [g1.pos, g2.pos]);
    for (const g of [g1, g2, g3]) session.battle.creatures[g.id] = g;
    game.applyEffects([{ kind: "turncoat", target: g1.id }], a);
    expect(g1.side).toBe("party");
    game.applyEffects([{ kind: "rout", target: g2.id }], a);
    expect(session.battle.creatures[g2.id]).toBeUndefined();
    const hp = g3.hp;
    game.applyEffects([{ kind: "improvised", target: g3.id }], a);
    expect(g3.hp).toBeLessThan(hp);
  });

  it("throws a potion to a friend and gives one to a friend next to you", () => {
    const { game, a, b, floorNear } = setup();
    game.giveItem("potion-of-healing", 2, a);
    const potions = (h: typeof a) => h.pc!.inventory.find((i) => i.itemId === "potion-of-healing")?.qty ?? 0;
    const pb = potions(b);
    b.pos = floorNear(a.pos!);
    const passed = game.applyEffects([{ kind: "pass_item", target: b.playerId!, item: "trank" }], a);
    expect(passed.join(" ")).toContain("zu");
    expect(potions(b)).toBe(pb + 1);
    b.hp = 1;
    game.applyEffects([{ kind: "feed_potion", target: b.playerId! }], a);
    expect(b.hp).toBeGreaterThan(1);
  });

  it("lets the player take back a free action before the throw", async () => {
    const { game, a, sent } = setup();
    const done = game.check(a, "athletics", 13, "Freie Aktion", { plan: "Das Fass rollt", cancellable: true });
    const ask = [...sent].reverse().find((s) => s.event.type === "request_roll")!.event;
    expect(ask.type === "request_roll" && ask.prompt.plan).toBe("Das Fass rollt");
    game.handle("p1", { kind: "cancel_roll", rollId: ask.type === "request_roll" ? ask.prompt.id : "" });
    expect((await done).cancelled).toBe(true);
  });
});

describe("bigger ideas", () => {
  it("breaks a wall into a new passage (once per map) and brings a ceiling down on foes", () => {
    const { game, session, a, floorNear } = setup();
    const m = session.map;
    // Stand next to an inner wall.
    let spot: { x: number; y: number } | undefined;
    for (let i = 0; i < m.cells.length && !spot; i++) {
      const x = i % m.width, y = Math.floor(i / m.width);
      if (m.cells[i] !== "floor" || Object.values(session.battle.creatures).some((c) => c.pos?.x === x && c.pos?.y === y)) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const q = { x: x + dx!, y: y + dy! }; return q.x > 0 && q.y > 0 && q.x < m.width - 1 && q.y < m.height - 1 && m.cells[cellIndex(m, q.x, q.y)] === "wall"; })) spot = { x, y };
    }
    a.pos = spot!;
    const walls = m.cells.filter((c) => c === "wall").length;
    expect(game.applyEffects([{ kind: "wall_break" }], a).join(" ")).toContain("Wand");
    expect(m.cells.filter((c) => c === "wall").length).toBeLessThan(walls);
    expect(game.applyEffects([{ kind: "wall_break" }], a).join(" ")).toContain("halten");
    const gob = createMonster("goblin", "g9");
    gob.pos = floorNear(a.pos);
    session.battle.creatures[gob.id] = gob;
    const hp = gob.hp;
    game.applyEffects([{ kind: "collapse", target: gob.id }], a);
    expect(gob.hp).toBeLessThan(hp);
  });

  it("jumps across, and jumps down on a foe from high up", () => {
    const { game, session, a, floorNear } = setup();
    const far = floorNear(floorNear(floorNear(a.pos!)));
    const before = { ...a.pos! };
    game.applyEffects([{ kind: "leap", target: `${far.x},${far.y}` }], a);
    expect(a.pos).not.toEqual(before);
    const gob = createMonster("goblin", "g8");
    gob.pos = floorNear(a.pos!);
    session.battle.creatures[gob.id] = gob;
    expect(game.applyEffects([{ kind: "pounce", target: gob.id }], a).join(" ")).toContain("erhöht");
    a.effects.push({ id: "elevated", rounds: 3, sourceId: a.id });
    const hp = gob.hp;
    game.applyEffects([{ kind: "pounce", target: gob.id }], a);
    expect(gob.hp).toBeLessThan(hp);
  });

  it("a stone lures waiting guards away; noise wakes them; a disguise walks past", () => {
    const { game, session, a } = setup();
    const { spawned } = game.stageFight([{ monster: "goblin", count: 1, name: "Wache" }], "on-guard");
    const g = spawned[0]!;
    game.applyEffects([{ kind: "noise", how: "lure", target: `${g.pos!.x + 3},${g.pos!.y}` }], a);
    expect(g.effects.some((e) => e.id === "distracted")).toBe(true);
    game.applyEffects([{ kind: "disguise" }], a);
    expect(a.effects.some((e) => e.id === "disguised")).toBe(true);
    game.applyEffects([{ kind: "noise", how: "loud" }], a);
    expect(game.hasStagedFight).toBe(false);
    expect(session.battle.creatures[g.id]).toBeTruthy();
  });

  it("characters run errands (once) and beaten foes talk", () => {
    const { game, session, a, b, floorNear } = setup();
    const npc = createMonster("commoner", "npc-heiler", { name: "Heilerin Anna", side: "neutral" });
    npc.pos = floorNear(a.pos!);
    session.battle.creatures[npc.id] = npc;
    b.hp = 1;
    game.applyEffects([{ kind: "errand", target: npc.id, how: "heal" }], a);
    expect(b.hp).toBeGreaterThan(1);
    expect(game.applyEffects([{ kind: "errand", target: npc.id, how: "info" }], a).join(" ")).toContain("schon");
    const prisoner = createMonster("bandit", "m5", { name: "Räuber 5", side: "neutral" });
    prisoner.pos = floorNear(a.pos!, [npc.pos]);
    session.battle.creatures[prisoner.id] = prisoner;
    session.map.objects.push({ id: "trapX", kind: "trap", x: 1, y: 1, frame: "trap.plate", blocking: false, state: "hidden" });
    game.applyEffects([{ kind: "interrogate", target: prisoner.id }], a);
    expect(session.map.objects.find((o) => o.id === "trapX")!.state).toBe("found");
  });

  it("disarms, breaks a shield, and hurls a goblin at another", () => {
    const { game, session, a, floorNear } = setup();
    a.abilities.STR = 16;
    const g1 = createMonster("goblin", "m1");
    g1.pos = floorNear(a.pos!);
    const g2 = createMonster("goblin", "m2");
    g2.pos = floorNear(a.pos!, [g1.pos]);
    for (const g of [g1, g2]) session.battle.creatures[g.id] = g;
    game.applyEffects([{ kind: "disarm", target: g1.id, what: "weapon" }], a);
    expect(g1.effects.some((e) => e.id === "hampered")).toBe(true);
    game.applyEffects([{ kind: "disarm", target: g2.id, what: "shield" }], a);
    expect(g2.baseAc.some((p) => p.label === "Schild zerbrochen")).toBe(true);
    const line = game.applyEffects([{ kind: "hurl", target: g1.id, toward: g2.id }], a).join(" ");
    expect(line).toContain("schleudert");
    game.applyEffects([{ kind: "feud", target: g2.id, other: g1.id }], a);
    expect(g2.effects.find((e) => e.id === "feud")?.sourceId).toBe(g1.id);
  });

  it("chain reactions: a burning barrel bursts; water puts fire out", () => {
    const { game, session, a, floorNear, put } = setup();
    const spot = floorNear(a.pos!);
    const barrel = put({ kind: "barrel", x: spot.x, y: spot.y, frame: "barrel", blocking: true });
    const line = game.applyEffects([{ kind: "object", target: barrel.id, how: "ignite" }], a).join(" ");
    expect(line).toContain("platzt");
    const fires = Object.values(session.map.surface ?? {}).filter((s) => s.kind === "fire").length;
    expect(fires).toBeGreaterThan(1);
    const douse = game.applyEffects([{ kind: "ground", target: `${spot.x},${spot.y}`, surface: "puddle" }], a).join(" ");
    expect(douse).toContain("Feuer aus");
  });
});

describe("round four", () => {
  const fightWith = (monsters: string[]) => {
    const env = setup();
    const { session, a, floorNear } = env;
    const taken: { x: number; y: number }[] = [];
    const foes = monsters.map((m, i) => {
      const c = createMonster(m, `m${i + 1}`);
      c.pos = floorNear(a.pos!, taken);
      taken.push(c.pos);
      session.battle.creatures[c.id] = c;
      return c;
    });
    return { ...env, foes };
  };

  it("bees sting, beasts run off, rats join the fight", () => {
    const { game, a, foes, session } = fightWith(["goblin", "wolf"]);
    game.spawnNearParty([]);
    const [g, w] = foes;
    const hp = g!.hp;
    game.applyEffects([{ kind: "animals", how: "bees", target: g!.id }], a);
    expect(g!.hp).toBeLessThan(hp);
    game.applyEffects([{ kind: "animals", how: "scare", target: w!.id }], a);
    expect(session.battle.creatures[w!.id]).toBeUndefined();
  });

  it("a shove throws a foe into the fire", () => {
    const { game, a, foes, session } = fightWith(["goblin"]);
    const g = foes[0]!;
    const p = a.pos!;
    const free = (x: number, y: number) => session.map.cells[cellIndex(session.map, x, y)] === "floor" && !Object.values(session.battle.creatures).some((c) => c !== g && c.pos?.x === x && c.pos?.y === y);
    const dir = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].find((d) => [1, 2, 3].every((n) => free(p.x + d.x * n, p.y + d.y * n)))!;
    g.pos = { x: p.x + dir.x, y: p.y + dir.y };
    session.map.surface ??= {};
    for (const n of [2, 3]) session.map.surface[cellIndex(session.map, p.x + dir.x * n, p.y + dir.y * n)] = { kind: "fire", turns: 3 };
    const hp = g.hp;
    const line = game.applyEffects([{ kind: "shove", target: g.id }], a).join(" ");
    expect(line).toContain("Feuer");
    expect(g.pos).toEqual({ x: p.x + dir.x * 3, y: p.y + dir.y * 3 });
    expect(g.hp).toBeLessThan(hp);
  });

  it("finds a weak spot (advantage for everybody) and a combo pays extra", () => {
    const { game, a, b, foes } = fightWith(["ogre"]);
    const o = foes[0]!;
    expect(game.applyEffects([{ kind: "weakness", target: o.id }], a).join(" ")).toContain("wackeliges Knie");
    expect(o.effects.some((e) => e.id === "weakspot")).toBe(true);
    // A sets the ogre up, B's hit becomes a combo.
    game.applyEffects([{ kind: "distract", target: o.id }], a);
    const setups = (game as unknown as { setups: Map<string, { heroId: string }> }).setups;
    expect(setups.get(o.id)?.heroId).toBe(a.id);
    (game as unknown as { mode: string }).mode = "combat";
    const hp = o.hp;
    const r = { id: "x", creatureId: b.id, title: "Angriff", sides: 20, dice: [15], kept: 15, lines: [], hits: [{ targetId: o.id, amount: 3 }] };
    (game as unknown as { combo(r: unknown): void }).combo(r);
    expect(o.hp).toBeLessThan(hp);
    expect(r.lines.map((l: { text: string }) => l.text).join(" ")).toContain("Kombo");
  });

  it("prisoners: take along, hand over for a reward, or let go (remembered)", () => {
    const { game, a, session, floorNear } = setup();
    const spared: string[] = [];
    game.onSpared = (name) => spared.push(name);
    const mk = (id: string) => {
      const c = createMonster("bandit", id, { name: `Räuber ${id}`, side: "neutral" });
      c.pos = floorNear(a.pos!, Object.values(session.battle.creatures).flatMap((x) => (x.pos ? [x.pos] : [])));
      c.captive = true;
      session.battle.creatures[c.id] = c;
      return c;
    };
    const p1 = mk("m7");
    game.applyEffects([{ kind: "captive", target: p1.id, how: "take" }], a);
    expect(p1.followId).toBe(a.id);
    const gold = a.pc!.inventory.find((i) => i.itemId === "gold")?.qty ?? 0;
    const p2 = mk("m8");
    game.applyEffects([{ kind: "captive", target: p2.id, how: "hand_over" }], a);
    expect(a.pc!.inventory.find((i) => i.itemId === "gold")!.qty).toBe(gold + 8);
    const p3 = mk("m9");
    game.applyEffects([{ kind: "captive", target: p3.id, how: "free" }], a);
    expect(spared).toEqual(["Räuber m9"]);
  });

  it("frost turns water into an ice bridge – only with frost magic", () => {
    const { game, session, a, b } = setup();
    const water = cellIndex(session.map, a.pos!.x + 1, a.pos!.y);
    session.map.cells[water] = "deep";
    expect(game.applyEffects([{ kind: "ice_bridge", target: `${a.pos!.x + 1},${a.pos!.y}` }], a).join(" ")).toContain("Frostmagie");
    b.pc!.spells = [...b.pc!.spells, "ray-of-frost"];
    b.pos = { ...a.pos! };
    game.applyEffects([{ kind: "ice_bridge", target: `${a.pos!.x + 1},${a.pos!.y}` }], b);
    expect(session.map.cells[water]).toBe("water");
    expect(session.map.surface![water]!.kind).toBe("ice");
  });
});
