import { describe, expect, it } from "vitest";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import type { MapObject } from "../shared/map";
import { cellIndex } from "../shared/map";
import { GameController } from "./game";
import { createSession } from "./session";

function setup() {
  const rng = seededRng(4);
  const session = createSession(rng, {
    players: [{ playerId: "p1", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b" } }],
    plan: { path: ["wirtshaus", "gang_gerade", "wachstube"] },
    noMonsters: true,
  });
  const sent: { to: string | "all"; event: GameEvent }[] = [];
  const game = new GameController(session, rng, (to, event) => sent.push({ to, event }), (event) => sent.push({ to: "all", event }), { monsterDelayMs: 0 });
  game.start();
  const hero = game.heroOf("p1")!;
  const choices = () => {
    game.broadcast();
    const v = [...sent].reverse().find((s) => s.to === "p1" && s.event.type === "state_update")?.event;
    return v?.type === "state_update" ? v.state.choices : [];
  };
  /** Puts a prop right next to the hero (on a free floor square). */
  let made = 0;
  const place = (o: Omit<MapObject, "id">): MapObject => {
    const obj = { id: `test-${++made}`, ...o } as MapObject;
    session.map.objects = session.map.objects.filter((x) => !(x.x === o.x && x.y === o.y));
    session.map.objects.push(obj);
    return obj;
  };
  return { game, session, hero, choices, place, sent };
}

describe("props on the map", () => {
  it("a table can be flipped for full cover", () => {
    const { game, hero, choices, place } = setup();
    const t = place({ kind: "prop", prop: "table", x: hero.pos!.x + 1, y: hero.pos!.y, frame: "table", blocking: true, uses: 3 });
    const flip = choices().find((c) => c.id === `flip:${t.id}`);
    expect(flip?.enabled).toBe(true);
    game.handle("p1", flip!.action);
    expect(t.prop).toBe("table-flipped");
    game.broadcast();
    expect(game.session.battle.terrain?.cover[`${t.x},${t.y}`]).toBe(5);
  });

  it("crates can be smashed, and a torch sets hay on fire", () => {
    const { game, session, hero, choices, place } = setup();
    const crate = place({ kind: "prop", prop: "crate", x: hero.pos!.x + 1, y: hero.pos!.y, frame: "crate", blocking: true });
    game.handle("p1", choices().find((c) => c.id === `smash:${crate.id}`)!.action);
    expect(crate.state).toBe("used");
    expect(crate.blocking).toBe(false);
    const hay = place({ kind: "prop", prop: "hay", x: hero.pos!.x - 1, y: hero.pos!.y, frame: "hay", blocking: false });
    // Only with fire at hand.
    const torches = hero.pc!.inventory.filter((i) => i.itemId === "torch");
    hero.pc!.inventory = hero.pc!.inventory.filter((i) => i.itemId !== "torch");
    expect(choices().some((c) => c.id === `ignite:${hay.id}`)).toBe(false);
    hero.pc!.inventory.push(...(torches.length ? torches : [{ itemId: "torch", qty: 1 }]));
    game.handle("p1", choices().find((c) => c.id === `ignite:${hay.id}`)!.action);
    expect(session.map.surface?.[cellIndex(session.map, hay.x, hay.y)]?.kind).toBe("fire");
    expect(game.session.battle.terrain?.hazard).toContain(`${hay.x},${hay.y}`);
  });

  it("praying at an altar blesses the hero in the next fight", () => {
    const { game, hero, choices, place } = setup();
    const altar = place({ kind: "altar", x: hero.pos!.x + 1, y: hero.pos!.y, frame: "altar", blocking: true });
    const pray = choices().find((c) => c.id === `pray:${altar.id}`);
    expect(pray).toBeDefined();
    // Roll until the prayer is heard (each hero may try once per place, so reset between tries).
    for (let i = 0; i < 20 && !hero.effects.some((e) => e.id === "bless"); i++) {
      (game as unknown as { triedObject: Set<string> }).triedObject.clear();
      game.handle("p1", pray!.action);
      const pending = (game as unknown as { pending?: { prompt: { id: string } } }).pending;
      if (pending) game.handle("p1", { kind: "roll", rollId: pending.prompt.id });
      if ((game as unknown as { boons: Map<string, string> }).boons.size) break;
    }
    expect((game as unknown as { boons: Map<string, string> }).boons.get(hero.id)).toBe("bless");
    game.spawnNearParty(["goblin"]);
    expect(game.mode).toBe("combat");
    expect(hero.effects.some((e) => e.id === "bless")).toBe(true);
  });
});
