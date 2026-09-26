import { describe, expect, it } from "vitest";
import { attackReasons } from "../engine/attack";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { DmContext } from "../shared/dm";
import type { Story } from "../shared/story";
import { GameController } from "../tv/game";
import { createSession } from "../tv/session";
import { coerceAiAnswer } from "./ai/aidm";
import { ScriptedDM } from "./scripted";
import storyJson from "./stories/drachenfels.json";

const STORY = storyJson as unknown as Story;

async function gameInFight(groups: { monster: string; count: number; boss?: boolean; name?: string }[]) {
  const rng = seededRng(5);
  const session = createSession(rng, {
    players: [{ playerId: "p1", profile: { name: "Pip", classId: "rogue", raceId: "halfling", look: defaultLook("rogue", "halfling"), color: "#fff" } }],
    plan: { path: ["waldweg"] },
    noMonsters: true,
  });
  const game = new GameController(session, rng, () => {}, () => {}, { monsterDelayMs: 0 });
  game.start();
  const done = game.fight(groups);
  await new Promise((r) => setTimeout(r, 0));
  return { game, done };
}

function ctx(combat?: DmContext["combat"]): DmContext {
  return {
    storyId: STORY.id, duration: "kurz", truth: "A", sceneId: "raeuber", sceneIndex: 1, sceneCount: 6,
    players: [{ id: "p1", name: "Pip", classId: "rogue", hp: 8, maxHp: 8 }],
    flags: [], cluesFound: [], twistRevealed: false, minutesPlayed: 5, minutesPlanned: 20, hardship: 0, eventsUsed: [],
    ...(combat ? { combat } : {}),
  };
}

describe("tricks in a fight", () => {
  it("lets ordinary enemies flee and ends the fight", async () => {
    const { game, done } = await gameInFight([{ monster: "bandit", count: 3, name: "Räuber" }]);
    expect(game.mode).toBe("combat");
    const enemies = game.enemiesInFight().length;
    expect(enemies).toBeGreaterThan(1);
    expect(game.enemiesFlee()).toHaveLength(enemies);
    expect(game.mode).toBe("explore");
    expect((await done).winner).toBe("party");
    game.destroy();
  });

  it("never makes a boss flee", async () => {
    const { game } = await gameInFight([{ monster: "bandit-captain", count: 1, boss: true, name: "Hauptmann" }, { monster: "bandit", count: 1, name: "Räuber" }]);
    expect(game.enemiesFlee()).toEqual([]);
    expect(game.mode).toBe("combat");
    game.destroy();
  });

  it("gives advantage on the next attack against a distracted enemy", async () => {
    const { game } = await gameInFight([{ monster: "bandit", count: 1, name: "Räuber" }]);
    const enemy = game.enemiesInFight()[0]!;
    const hero = game.heroes()[0]!;
    const creature = game.session.battle.creatures[enemy.id]!;
    expect(game.distract(enemy.id, "Pip")).toBe(true);
    const reasons = attackReasons(game.session.battle, hero, creature, hero.attacks[0]!);
    expect(reasons.some((r) => r.glossarKey === "abgelenkt" && r.effect === "advantage")).toBe(true);
    game.destroy();
  });
});

describe("free actions in a fight (scripted narrator)", () => {
  const dm = new ScriptedDM(STORY);
  const bandits = { enemies: [{ id: "m1", name: "Räuber 1", hp: 11, maxHp: 11, boss: false }] };
  const free = (text: string) => ({ kind: "free_text" as const, text, playerId: "p1", heroName: "Pip" });

  it("points plain attacks to the attack button instead of inventing a hit", async () => {
    const res = await dm.respond(ctx(bandits), free("Ich greife Räuber 1 an"));
    expect(res.request_roll).toBeUndefined();
    expect(res.combat_effect).toBeUndefined();
    expect(res.narration).toContain("Angreifen");
  });

  it("asks for a roll for a trick and applies a real effect on success", async () => {
    const res = await dm.respond(ctx(bandits), free("Ich werfe ihm Sand in die Augen und lenke ihn ab"));
    expect(res.request_roll?.skill).toBe("deception");
    const ok = await dm.respond(ctx(bandits), { kind: "roll_result", text: "", playerId: "p1", heroName: "Pip", skill: "deception", dc: 13, total: 15, success: true });
    expect(ok.combat_effect).toEqual({ kind: "distract", target: "m1" });
    const scare = await dm.respond(ctx(bandits), { kind: "roll_result", text: "", playerId: "p1", heroName: "Pip", skill: "intimidation", dc: 13, total: 15, success: true });
    expect(scare.combat_effect).toEqual({ kind: "flee" });
    const fail = await dm.respond(ctx(bandits), { kind: "roll_result", text: "", playerId: "p1", heroName: "Pip", skill: "intimidation", dc: 13, total: 5, success: false });
    expect(fail.combat_effect).toBeUndefined();
  });
});

describe("free actions in a fight (AI answers are checked)", () => {
  const roll = (success: boolean) => ({ kind: "roll_result" as const, text: "", playerId: "p1", heroName: "Pip", skill: "intimidation", dc: 13, total: success ? 16 : 4, success });
  const base = { narration: "", next: "await_action" as const };

  it("only allows flight without a boss and only after a successful roll", () => {
    const bandits = { enemies: [{ id: "m1", name: "Räuber", hp: 11, maxHp: 11, boss: false }] };
    const withBoss = { enemies: [...bandits.enemies, { id: "m2", name: "Hauptmann", hp: 65, maxHp: 65, boss: true }] };
    expect(coerceAiAnswer({ narration: "Sie rennen!", combat_effect: "flucht" }, STORY, ctx(bandits), roll(true), base).combat_effect).toEqual({ kind: "flee" });
    expect(coerceAiAnswer({ narration: "Sie rennen!", combat_effect: "flucht" }, STORY, ctx(withBoss), roll(true), base).combat_effect).toBeUndefined();
    expect(coerceAiAnswer({ narration: "Sie rennen!", combat_effect: "flucht" }, STORY, ctx(bandits), roll(false), base).combat_effect).toBeUndefined();
    expect(coerceAiAnswer({ narration: "Abgelenkt!", combat_effect: "ablenken", combat_target: "m2" }, STORY, ctx(withBoss), roll(true), base).combat_effect).toEqual({ kind: "distract", target: "m2" });
  });
});
