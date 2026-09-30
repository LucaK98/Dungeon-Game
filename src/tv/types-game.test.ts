import { describe, expect, it } from "vitest";
import { addEffect, hasCondition, hasEffect } from "../engine/combat";
import { createMonster } from "../engine/creatures";
import type { Rng } from "../engine/rng";
import { seededRng } from "../engine/rng";
import { applyElement } from "../engine/types";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import type { DamageResult } from "../shared/game";
import { cellIndex } from "../shared/map";
import { afterHit, soak, turnStart } from "./elements";
import { GameController } from "./game";
import { createSession } from "./session";

/** Always rolls low: every small chance comes true. */
const lucky: Rng = { next: () => 0, int: (min) => min };
const unlucky: Rng = { next: () => 0.99, int: (_min, max) => max };

const hit = (type: DamageResult["lines"][number]["type"], final = 6, note?: DamageResult["lines"][number]["note"]): DamageResult => ({
  lines: [{ type, dice: [final], parts: [], raw: final, final, ...(note ? { note } : {}) }],
  total: final,
  crit: false,
});

function setup(classId = "fighter") {
  const rng = seededRng(7);
  const session = createSession(rng, {
    players: [
      { playerId: "p1", profile: { name: "Brunhild", classId, raceId: "human", look: defaultLook(classId, "human"), color: "#e6194b" } },
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
  const gob = createMonster("goblin", "g1");
  gob.pos = { x: a.pos!.x + 1, y: a.pos!.y };
  session.battle.creatures[gob.id] = gob;
  return { game, session, a, gob, sent };
}

describe("small elemental states", () => {
  it("fire may set a foe burning: 1d4 at the start of its turn, then out", () => {
    const { session, a, gob } = setup();
    const r = afterHit(lucky, session.map, session.battle, a, gob, hit("fire"), true);
    expect(r.lines.map((l) => l.text).join(" ")).toContain("fängt Feuer");
    expect(hasEffect(gob, "burning")).toBe(true);
    const hp = gob.hp;
    const t = turnStart(lucky, gob);
    expect(gob.hp).toBe(hp - 1);
    expect(t.hits[0]?.amount).toBe(1);
    expect(hasEffect(gob, "burning")).toBe(false);
  });

  it("stays rare: no state on an unlucky roll", () => {
    const { session, a, gob } = setup();
    for (const type of ["fire", "cold", "lightning", "poison"] as const) afterHit(unlucky, session.map, session.battle, a, gob, hit(type), true);
    expect(gob.effects.length + gob.conditions.length).toBe(0);
  });

  it("cold chills (−2 squares), lightning shocks (no reaction)", () => {
    const { session, a, gob } = setup();
    session.battle.combat = { round: 1, order: [], turnIndex: 0, turn: {} as never, reactionUsed: {} };
    afterHit(lucky, session.map, session.battle, a, gob, hit("cold"), true);
    expect(hasEffect(gob, "chilled")).toBe(true);
    expect(turnStart(lucky, gob).slowFt).toBe(10);
    afterHit(lucky, session.map, session.battle, a, gob, hit("lightning"), true);
    expect(session.battle.combat.reactionUsed[gob.id]).toBe(true);
  });

  it("wet and then chilled freezes solid – not bosses or big foes", () => {
    const { session, a, gob } = setup();
    addEffect(gob, "wet", 2, "water");
    const r = afterHit(lucky, session.map, session.battle, a, gob, hit("cold"), true);
    expect(r.lines.map((l) => l.text).join(" ")).toContain("friert fest");
    expect(hasCondition(gob, "incapacitated")).toBe(true);
    const ogre = createMonster("ogre", "o");
    ogre.pos = { x: 1, y: 1 };
    addEffect(ogre, "wet", 2, "water");
    afterHit(lucky, session.map, session.battle, a, ogre, hit("cold"), false);
    expect(hasCondition(ogre, "incapacitated")).toBe(false);
    expect(hasEffect(ogre, "chilled")).toBe(true);
  });

  it("water and rain make wet; lightning jumps through the water", () => {
    const { session, a, gob } = setup();
    const m = session.map;
    m.surface ??= {};
    const g2 = createMonster("goblin", "g2");
    g2.pos = { x: gob.pos!.x, y: gob.pos!.y + 1 };
    session.battle.creatures[g2.id] = g2;
    for (const c of [gob, g2]) m.surface[cellIndex(m, c.pos!.x, c.pos!.y)] = { kind: "puddle" };
    expect(soak(m, gob)).toBe(true);
    const hp = g2.hp;
    const r = afterHit(unlucky, m, session.battle, a, gob, hit("lightning", 8), true);
    expect(r.lines.map((l) => l.text).join(" ")).toContain("springt durchs Wasser");
    expect(g2.hp).toBe(Math.max(0, hp - 4));
  });
});

describe("learning strengths and weaknesses", () => {
  const react = (game: GameController, actor: Parameters<GameController["knownTypes"]>[0], targetId: string, dmg: DamageResult) =>
    (game as unknown as { typeReacts: (a: unknown, o: unknown) => { lines: { text: string }[] } }).typeReacts(actor, { ok: true, kind: "attack", actorId: actor.id, cost: "action", attack: { targetId, hit: true, damage: dmg } });

  it("shows nothing until learned; a hit teaches it", () => {
    const { game, a, gob } = setup("rogue");
    expect(game.knownTypes(gob)).toEqual([]);
    const r = react(game, a, gob.id, hit("thunder", 8, "vulnerability"));
    expect(r.lines.map((l) => l.text).join(" ")).toContain("Sehr effektiv");
    expect(game.knownTypes(gob)).toEqual(["💥 Donner ×2"]);
    // Other goblins of the same kind: known too. A Feuergoblin is another kind.
    const other = createMonster("goblin", "g9");
    expect(game.knownTypes(other)).toEqual(["💥 Donner ×2"]);
    const fire = createMonster("goblin", "g8");
    applyElement(fire, "fire");
    expect(game.knownTypes(fire)).toEqual([]);
  });

  it("a fighter's hit reveals everything about the foe", () => {
    const { game, a, gob } = setup("fighter");
    const r = react(game, a, gob.id, hit("slashing", 5));
    expect(r.lines.map((l) => l.text).join(" ")).toContain("durchschaut");
    expect(game.knownTypes(gob).sort()).toEqual(["💥 Donner ×2", "🟢 Gift ×½"].sort());
  });

  it("knowledge can be kept and brought back (bestiary)", () => {
    const { game, a, gob } = setup("rogue");
    react(game, a, gob.id, hit("thunder", 8, "vulnerability"));
    const kept = game.knowledge();
    const next = setup("rogue");
    next.game.setKnowledge(kept);
    expect(next.game.knownTypes(next.gob)).toEqual(["💥 Donner ×2"]);
  });
});
