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

describe("brewing and tinkering", () => {
  it("brews from ingredients at any time and the tools work", () => {
    const { game, session, hero, choices } = setup();
    hero.pc!.inventory.push({ itemId: "heilkraut", qty: 3 }, { itemId: "spinnenseide", qty: 3 }, { itemId: "oelflasche", qty: 1 });
    const potions = () => hero.pc!.inventory.find((i) => i.itemId === "potion-of-healing")?.qty ?? 0;
    const before = potions();
    game.handle("p1", { kind: "craft", recipe: "heiltrank" });
    expect(potions()).toBe(before + 1);
    expect(hero.pc!.inventory.find((i) => i.itemId === "heilkraut")?.qty).toBe(1);
    // Not enough herbs left for a second one.
    game.handle("p1", { kind: "craft", recipe: "heiltrank" });
    expect(potions()).toBe(before + 1);
    game.handle("p1", { kind: "craft", recipe: "stolperdraht" });
    game.handle("p1", { kind: "craft", recipe: "brandflasche" });
    expect(hero.pc!.inventory.some((i) => i.itemId === "stolperdraht")).toBe(true);
    expect(hero.pc!.inventory.some((i) => i.itemId === "brandflasche")).toBe(true);
    // A tripwire on the hero's square becomes a snare for enemies.
    game.handle("p1", choices().find((c) => c.id === "item:stolperdraht")!.action);
    game.broadcast();
    expect(session.battle.terrain?.snares).toContain(`${hero.pos!.x},${hero.pos!.y}`);
  });
});

describe("companions", () => {
  it("a stray dog is tamed with a bone, follows, fights on the heroes' side, stays across maps and can die", async () => {
    const { createMonster } = await import("../engine/creatures");
    const { sanitizeLegacy } = await import("../shared/herobook");
    const { game, session, hero, choices } = setup();
    const dog = createMonster("mastiff", "wild-test", { name: "streunender Hund", side: "neutral" });
    dog.wild = "dog";
    dog.pos = { x: hero.pos!.x + 1, y: hero.pos!.y };
    session.battle.creatures[dog.id] = dog;
    // Without a bone: not possible.
    expect(choices().find((c) => c.id === `tame:${dog.id}`)?.enabled).toBe(false);
    let pet;
    for (let i = 0; i < 30 && !pet; i++) {
      hero.pc!.inventory.push({ itemId: "knochen", qty: 1 });
      game.handle("p1", choices().find((c) => c.id === `tame:${dog.id}`)!.action);
      const pending = (game as unknown as { pending?: { prompt: { id: string } } }).pending;
      if (pending) game.handle("p1", { kind: "roll", rollId: pending.prompt.id });
      pet = game.companionOf(hero);
    }
    expect(pet).toBeDefined();
    expect(pet!.side).toBe("party");
    expect(pet!.companion!.ownerId).toBe(hero.id);
    expect(session.battle.creatures[dog.id]).toBeUndefined();
    // New map: comes along and stands beside the hero.
    game.loadMap(session.map, []);
    expect(game.companionOf(hero)?.id).toBe(pet!.id);
    expect(Math.max(Math.abs(pet!.pos!.x - hero.pos!.x), Math.abs(pet!.pos!.y - hero.pos!.y))).toBeLessThanOrEqual(2);
    // In a fight it has its own turn.
    game.spawnNearParty(["goblin"]);
    expect(session.battle.combat?.order.some((o) => o.creatureId === pet!.id)).toBe(true);
    // Hero book keeps it …
    const saved: unknown[] = [];
    (game as unknown as { sendTo: (to: string, e: { type: string; hero?: unknown }) => void }).sendTo = (_to, e) => e.type === "hero_saved" && saved.push(e.hero);
    game.saveHeroes("Test", { won: true, difficulty: "normal" });
    const legacy = sanitizeLegacy((saved[0] as { legacy: unknown }).legacy);
    expect(legacy?.companion?.name).toBe(pet!.name);
    // … but a fallen companion is gone for good.
    pet!.hp = 0;
    pet!.dead = true;
    game.broadcast();
    expect(game.recentLog(20).some((l) => l.text.includes("ist gefallen"))).toBe(true);
    saved.length = 0;
    game.saveHeroes("Test", { won: true, difficulty: "normal" });
    expect(sanitizeLegacy((saved[0] as { legacy: unknown }).legacy)?.companion).toBeUndefined();
  });
});

describe("monsters use the room", () => {
  it("an ogre hurls a crate, a goblin ducks behind a table", async () => {
    const { createMonster } = await import("../engine/creatures");
    const { game, session, hero, place } = setup();
    const trick = (m: import("../shared/game").Creature) => (game as unknown as { monsterTrick: (m: unknown) => boolean }).monsterTrick(m);
    const ogre = createMonster("ogre", "ogre-test");
    ogre.pos = { x: hero.pos!.x + 4, y: hero.pos!.y };
    session.battle.creatures[ogre.id] = ogre;
    // Nothing else to grab around the ogre.
    session.map.objects = session.map.objects.filter((o) => Math.max(Math.abs(o.x - ogre.pos!.x), Math.abs(o.y - ogre.pos!.y)) > 2);
    const crate = place({ kind: "prop", prop: "crate", x: ogre.pos.x - 1, y: ogre.pos.y, frame: "crate", blocking: true });
    let thrown = false;
    for (let i = 0; i < 20 && !thrown; i++) thrown = trick(ogre);
    expect(thrown).toBe(true);
    expect(crate.state).toBe("used");
    const goblin = createMonster("goblin", "gob-test");
    goblin.pos = { x: hero.pos!.x + 4, y: hero.pos!.y + 2 };
    session.battle.creatures[goblin.id] = goblin;
    session.map.objects = session.map.objects.filter((o) => Math.max(Math.abs(o.x - goblin.pos!.x), Math.abs(o.y - goblin.pos!.y)) > 1);
    const table = place({ kind: "prop", prop: "table", x: goblin.pos.x + 1, y: goblin.pos.y, frame: "table", blocking: true });
    // The crate may have knocked the hero out: back on their feet for the next part.
    hero.hp = hero.maxHp;
    hero.conditions = [];
    for (let i = 0; i < 20 && table.prop === "table"; i++) trick(goblin);
    expect(table.prop).toBe("table-flipped");
  });
});

describe("boss arenas", () => {
  it("the ceiling cracks as the ogre weakens: warnings first, rocks next round", () => {
    const { game, session, hero } = setup();
    // A sturdy test hero, so the fight lasts.
    hero.maxHp = hero.hp = 500;
    void game.fight([{ monster: "ogre", count: 1, boss: true, name: "Grummelbauch" }]);
    expect(game.mode).toBe("combat");
    const ogre = Object.values(session.battle.creatures).find((c) => c.monsterId === "ogre")!;
    const tick = () => (game as unknown as { arenaTick: () => void }).arenaTick();
    tick();
    expect(Object.values(session.map.surface ?? {}).some((s) => s.kind === "warn")).toBe(false);
    ogre.hp = Math.floor(ogre.maxHp / 2);
    tick();
    const warned = Object.entries(session.map.surface ?? {}).filter(([, s]) => s.kind === "warn").map(([k]) => Number(k));
    expect(warned.length).toBeGreaterThan(0);
    expect(session.battle.terrain?.hazard.length).toBeGreaterThan(0);
    tick();
    for (const i of warned) expect(session.map.objects.some((o) => o.prop === "rubble" && o.y * session.map.width + o.x === i)).toBe(true);
  });
});
