import { describe, expect, it } from "vitest";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { Creature } from "../shared/game";
import { GameController } from "./game";
import { createSession } from "./session";

function setup() {
  const rng = seededRng(4);
  const session = createSession(rng, {
    players: [{ playerId: "p1", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b" } }],
    plan: { path: ["burghof", "gang_gerade", "wachstube"] },
  });
  const game = new GameController(session, rng, () => {}, () => {}, {});
  game.start();
  // The pacing helpers are private: reach them for this test only.
  return game as unknown as { sameKind(a?: Creature, b?: Creature): boolean; monsterDelay(c?: Creature, phase?: "before" | "after"): number; bossIds: Set<string> };
}

const foe = (id: string, monsterId: string) => ({ id, name: id, kind: "monster", side: "enemy", monsterId }) as unknown as Creature;

describe("faster enemy turns", () => {
  it("treats foes of the same kind as one group, but never bosses", () => {
    const g = setup();
    const a = foe("g1", "goblin");
    const b = foe("g2", "goblin");
    expect(g.sameKind(a, b)).toBe(true);
    expect(g.sameKind(a, a)).toBe(false);
    expect(g.sameKind(a, foe("w1", "wolf"))).toBe(false);
    g.bossIds.add("g2");
    expect(g.sameKind(a, b)).toBe(false);
  });

  it("gives bosses the long pause and minions a short one", () => {
    const g = setup();
    const minion = foe("g1", "goblin");
    const boss = foe("b1", "ogre");
    g.bossIds.add("b1");
    expect(g.monsterDelay(boss)).toBeGreaterThan(g.monsterDelay(minion));
    expect(g.monsterDelay(minion)).toBeLessThanOrEqual(1200);
  });
});

describe("spotlight guard in the game", () => {
  it("gives a hero who did nothing for three rounds a hook, once", () => {
    const g = setup() as unknown as { spotlight(people: Creature[]): void; worldRounds: number; spotlights: number; lastDid: Map<string, number> };
    g.worldRounds = 2;
    g.spotlight([]);
    expect(g.spotlights).toBe(0);
    g.worldRounds = 3;
    g.spotlight([]);
    expect(g.spotlights).toBe(1);
    g.spotlight([]);
    expect(g.spotlights).toBe(1);
  });
});

describe("evening report in the game", () => {
  it("counts a fight with its rounds and lost life", () => {
    const g = setup() as unknown as GameController;
    const finish = () => (g as unknown as { checkWinner(): boolean }).checkWinner();
    g.spawnNearParty(["goblin"]);
    expect(g.mode).toBe("combat");
    const hero = g.heroes()[0]!;
    hero.hp = Math.floor(hero.maxHp / 2);
    for (const c of Object.values(g.session.battle.creatures)) if (c.side === "enemy") c.hp = 0;
    finish();
    const stats = g.eveningStats();
    expect(stats.fights).toHaveLength(1);
    expect(stats.fights[0]!.won).toBe(true);
    expect(stats.fights[0]!.hpLost).toBeGreaterThan(0.3);
  });
});
