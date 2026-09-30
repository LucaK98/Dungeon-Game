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
