import { describe, expect, it } from "vitest";
import { scriptedRng, seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import { GameController } from "./game";
import { createSession } from "./session";

function setup(seed = 4) {
  const rng = seededRng(seed);
  const session = createSession(rng, {
    players: [
      { playerId: "p1", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b" } },
      { playerId: "p2", profile: { name: "Ilmarin", classId: "wizard", raceId: "elf", look: defaultLook("wizard", "elf"), color: "#4363d8" } },
    ],
    plan: { path: ["burghof", "gang_gerade", "wachstube"] },
  });
  const sent: { to: string | "all"; event: GameEvent }[] = [];
  const game = new GameController(session, rng, (to, event) => sent.push({ to, event }), (event) => sent.push({ to: "all", event }));
  game.start();
  const last = (to: string, type: GameEvent["type"]) => [...sent].reverse().find((s) => s.to === to && s.event.type === type)?.event;
  return { game, session, sent, last };
}

describe("game controller", () => {
  it("sends every phone its own view and starts with the first hero", () => {
    const { last } = setup();
    const v1 = last("p1", "state_update");
    const v2 = last("p2", "state_update");
    expect(v1?.type === "state_update" && v1.state.turn.mine).toBe(true);
    expect(v2?.type === "state_update" && v2.state.turn.mine).toBe(false);
    expect(v2?.type === "state_update" && v2.state.turn.activeName).toBe("Brunhild");
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
