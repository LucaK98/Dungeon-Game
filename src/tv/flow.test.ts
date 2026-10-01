import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMonster } from "../engine/creatures";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import { cellIndex } from "../shared/map";
import type { PlayerView } from "../shared/view";
import { GameController, type ControllerOptions } from "./game";
import { createSession } from "./session";

function setup(opts: ControllerOptions = {}) {
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
  const game = new GameController(session, rng, (to, event) => sent.push({ to, event }), () => {}, { turnBasedExplore: true, ...opts });
  const turns: string[] = [];
  const told: string[] = [];
  game.on({ turn: (name) => turns.push(name), narration: (lines) => told.push(...lines.map((l) => l.text)) });
  game.start();
  session.map.explored.fill(true);
  const view = (p: string) => [...sent].reverse().find((s) => s.to === p && s.event.type === "state_update")?.event as { state: PlayerView } | undefined;
  const floorNear = (p: { x: number; y: number }) => {
    for (let r = 1; r < 6; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (session.map.cells[cellIndex(session.map, q.x, q.y)] !== "floor") continue;
          if (Object.values(session.battle.creatures).some((c) => c.pos?.x === q.x && c.pos?.y === q.y) || session.map.objects.some((o) => o.x === q.x && o.y === q.y)) continue;
          return q;
        }
    throw new Error("no floor");
  };
  return { game, session, sent, turns, told, view, floorNear };
}

describe("one thing after another", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("after the heroes the world takes its turn: the people nearby one by one, then the next round", async () => {
    const { game, session, turns, view, floorNear } = setup({ worldTurn: true });
    const a = game.heroOf("p1")!;
    const npc = createMonster("commoner", "npc-wirt", { name: "Wirt Otto", side: "neutral" });
    npc.pos = floorNear(a.pos!);
    session.battle.creatures[npc.id] = npc;
    const greeted: string[] = [];
    game.onNpcTurn = (c) => {
      greeted.push(c.name);
      return true;
    };
    let moments = 0;
    game.onWorldMoment = async () => {
      moments++;
    };
    // The people nearby and the world have their place in the turn order, after the heroes.
    expect(game.orderEntries().map((e) => e.name)).toEqual(["Brunhild", "Ilmarin", "Wirt Otto", "🌍 Die Welt"]);
    game.handle("p1", { kind: "end_turn" });
    game.handle("p2", { kind: "end_turn" });
    // The world's turn: nobody can act, the phones show "Die Welt ist dran".
    expect(turns.at(-1)).toBe("🌍 Die Welt");
    expect(view("p1")!.state.turn.mine).toBe(false);
    expect(view("p1")!.state.turn.activeName).toBe("🌍 Die Welt");
    expect(view("p1")!.state.turn.nextUp).toBe(true);
    game.handle("p1", { kind: "move", to: floorNear(a.pos!) });
    expect(game.orderEntries().find((e) => e.id === "world")?.active).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(greeted).toEqual(["Wirt Otto"]);
    expect(turns).toContain("Wirt Otto");
    await vi.advanceTimersByTimeAsync(5000);
    expect(moments).toBe(1);
    // Then the next round starts with the first hero.
    expect(turns.at(-1)).toBe("Brunhild");
    expect(view("p1")!.state.turn.mine).toBe(true);
    expect(session.battle.combat!.round).toBe(2);
  });

  it("the next turn waits a moment – and for the story being told", async () => {
    const { game, turns, view } = setup({ turnGapMs: 900 });
    game.setNarrating(true);
    game.handle("p1", { kind: "end_turn" });
    // Story still told: the move waits, nobody's turn yet.
    expect(turns.at(-1)).toBe("Brunhild");
    game.setNarrating(false);
    game.handle("p1", { kind: "end_turn" });
    expect(view("p2")!.state.turn.mine).toBe(false);
    expect(view("p2")!.state.turn.nextUp).toBe(true);
    expect(view("p2")!.state.turn.activeName).toBe("Brunhild");
    // The story starts again before the pause is over: the turn waits until it is told.
    game.setNarrating(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(turns.at(-1)).toBe("Brunhild");
    game.setNarrating(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(turns.at(-1)).toBe("Ilmarin");
    expect(view("p2")!.state.turn.mine).toBe(true);
  });

  it("the game speed stretches the pauses", async () => {
    const { game, turns } = setup({ turnGapMs: 1000 });
    game.tempo = 1.5;
    game.handle("p1", { kind: "end_turn" });
    await vi.advanceTimersByTimeAsync(1200);
    expect(turns.at(-1)).toBe("Brunhild");
    await vi.advanceTimersByTimeAsync(400);
    expect(turns.at(-1)).toBe("Ilmarin");
  });
});

describe("the game master keeps it short", () => {
  it("only one narrator line per turn is told; what characters say always is", () => {
    const { game, told } = setup();
    game.narrate([{ text: "Die Tür knarrt." }, { text: "Staub rieselt." }], { aside: true });
    game.narrate([{ text: "Ein Windstoß." }, { npc: "Wirt Otto", text: "Wer da?" }], { aside: true });
    expect(told).toEqual(["Die Tür knarrt.", "Wer da?"]);
    expect(game.recentLog(10).map((l) => l.text).join(" ")).toContain("Staub rieselt.");
    // The next turn may tell again.
    game.handle("p1", { kind: "end_turn" });
    game.narrate([{ text: "Schritte im Gang." }], { aside: true });
    expect(told.at(-1)).toBe("Schritte im Gang.");
    // Story lines (not a reaction) are always told.
    game.narrate([{ text: "Kapitel 2" }]);
    expect(told.at(-1)).toBe("Kapitel 2");
  });
});
