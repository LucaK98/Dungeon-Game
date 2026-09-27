import { describe, expect, it } from "vitest";
import { createMonster, hardenMonster } from "../engine/creatures";
import { seededRng } from "../engine/rng";
import { defaultLook } from "./doll";
import { DIFFICULTIES, DIFFICULTY, type Difficulty } from "./difficulty";
import { glossarEntry } from "../data/help/glossar";
import { GameController } from "../tv/game";
import { createSession } from "../tv/session";

function setup(difficulty: Difficulty) {
  const rng = seededRng(4);
  const session = createSession(rng, {
    players: [
      { playerId: "p1", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b" } },
      { playerId: "p2", profile: { name: "Pip", classId: "rogue", raceId: "halfling", look: defaultLook("rogue", "halfling"), color: "#4363d8" } },
    ],
    plan: { path: ["burghof", "gang_gerade", "wachstube"] },
    noMonsters: true,
    difficulty,
  });
  const game = new GameController(session, rng, () => {}, () => {}, { monsterDelayMs: 0 });
  game.difficulty = difficulty;
  game.start();
  return { game };
}

const potions = (game: GameController) => game.heroes().map((h) => h.pc!.inventory.find((i) => i.itemId === "potion-of-healing")?.qty ?? 0);

describe("difficulty", () => {
  it("normal is exactly the rulebook", () => {
    const plain = createMonster("goblin", "a");
    const same = createMonster("goblin", "b");
    hardenMonster(same, DIFFICULTY.normal);
    expect(same.maxHp).toBe(plain.maxHp);
    expect(same.attacks).toEqual(plain.attacks);
  });

  it("changes monsters openly (a 'Schwierigkeit' line in the breakdown)", () => {
    const hard = createMonster("goblin", "a");
    hardenMonster(hard, DIFFICULTY.toedlich);
    const base = createMonster("goblin", "b");
    expect(hard.maxHp).toBe(Math.round(base.maxHp * 1.6));
    expect(hard.hp).toBe(hard.maxHp);
    expect(hard.attacks[0]!.toHit.find((p) => p.label === "Schwierigkeit")?.value).toBe(2);
    expect(hard.attacks[0]!.damageBonus.find((p) => p.label === "Schwierigkeit")?.value).toBe(1);
    const easy = createMonster("goblin", "c");
    hardenMonster(easy, DIFFICULTY.leicht);
    expect(easy.maxHp).toBeLessThan(base.maxHp);
    expect(easy.attacks[0]!.toHit.find((p) => p.label === "Schwierigkeit")?.value).toBe(-1);
    expect(glossarEntry("schwierigkeit")).toBeDefined();
  });

  it("moves the target number of checks, never below 5", () => {
    expect(setup("leicht").game.sg(12)).toBe(10);
    expect(setup("normal").game.sg(12)).toBe(12);
    expect(setup("schwer").game.sg(12)).toBe(13);
    expect(setup("toedlich").game.sg(12)).toBe(14);
    expect(setup("leicht").game.sg(5)).toBe(5);
  });

  it("gives healing potions by level", () => {
    expect(potions(setup("leicht").game)).toEqual([2, 2]);
    expect(potions(setup("normal").game)).toEqual([1, 1]);
    expect(potions(setup("toedlich").game)).toEqual([0, 0]);
  });

  it("brings one more of the rank and file on hard levels, but not to the training fight or the boss", () => {
    const count = (d: Difficulty, groups: Parameters<GameController["fight"]>[0], training = false) => {
      const { game } = setup(d);
      void game.fight(groups, { training });
      return Object.values(game.battle.creatures).filter((c) => c.side === "enemy").length;
    };
    expect(count("normal", [{ monster: "goblin", count: 2 }])).toBe(2);
    expect(count("schwer", [{ monster: "goblin", count: 2 }])).toBe(3);
    expect(count("schwer", [{ monster: "goblin", count: 2 }], true)).toBe(2);
    expect(count("schwer", [{ monster: "ogre", count: 1, boss: true }])).toBe(1);
    // Hard: the boss fight stays as it is; deadly: one more goblin next to the boss.
    expect(count("schwer", [{ monster: "ogre", count: 1, boss: true }, { monster: "goblin", count: 2 }])).toBe(3);
    expect(count("toedlich", [{ monster: "ogre", count: 1, boss: true }, { monster: "goblin", count: 2 }])).toBe(4);
  });

  it("has a text and points for every level", () => {
    for (const d of DIFFICULTIES) expect(DIFFICULTY[d].points.length).toBeGreaterThan(0);
  });
});
