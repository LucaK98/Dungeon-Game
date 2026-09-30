import { describe, expect, it } from "vitest";
import { attackReasons } from "../engine/attack";
import { armorClass } from "../engine/combat";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { DmContext, DmTrigger } from "../shared/dm";
import type { Story } from "../shared/story";
import { GameController } from "../tv/game";
import { createSession } from "../tv/session";
import { coerceAiAnswer } from "./ai/aidm";
import { filterEffects, rollAllowance } from "./effects";
import { ScriptedDM } from "./scripted";
import storyJson from "./stories/drachenfels.json";

const STORY = storyJson as unknown as Story;

async function gameInFight(groups: { monster: string; count: number; boss?: boolean; name?: string }[], players = 2) {
  const rng = seededRng(5);
  const heroes = [
    { playerId: "p1", profile: { name: "Pip", classId: "rogue", raceId: "halfling", look: defaultLook("rogue", "halfling"), color: "#fff" } },
    { playerId: "p2", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#f00" } },
  ].slice(0, players);
  const session = createSession(rng, { players: heroes, plan: { path: ["waldweg"] }, noMonsters: true });
  const game = new GameController(session, rng, () => {}, () => {}, { monsterDelayMs: 0 });
  game.start();
  const done = groups.length ? game.fight(groups) : Promise.resolve({ winner: "party" as const, spawned: [] });
  await new Promise((r) => setTimeout(r, 0));
  return { game, done, hero: game.heroes()[0]!, friend: game.heroes()[1] };
}

function ctx(combat?: DmContext["combat"], extra: Partial<DmContext> = {}): DmContext {
  return {
    storyId: STORY.id, duration: "kurz", truth: "A", sceneId: "raeuber", sceneIndex: 1, sceneCount: 6,
    players: [{ id: "p1", name: "Pip", classId: "rogue", hp: 8, maxHp: 8 }, { id: "p2", name: "Brunhild", classId: "fighter", hp: 5, maxHp: 12 }],
    flags: [], cluesFound: [], twistRevealed: false, minutesPlayed: 5, minutesPlanned: 20, hardship: 0, eventsUsed: [],
    gold: 30,
    ...(combat ? { combat } : {}),
    ...extra,
  };
}
const roll = (total: number, dc = 13, text = "Trick"): Extract<DmTrigger, { kind: "roll_result" }> => ({ kind: "roll_result", text, playerId: "p1", heroName: "Pip", skill: "deception", dc, total, success: total >= dc });
const free = (text: string): Extract<DmTrigger, { kind: "free_text" }> => ({ kind: "free_text", text, playerId: "p1", heroName: "Pip" });
const bandits = { enemies: [{ id: "m1", name: "Räuber 1", hp: 11, maxHp: 11, boss: false }, { id: "m2", name: "Räuber 2", hp: 11, maxHp: 11, boss: false }] };
const withBoss = { enemies: [...bandits.enemies, { id: "m3", name: "Hauptmann", hp: 65, maxHp: 65, boss: true }] };

describe("effect toolbox (rules)", () => {
  it("lets ordinary enemies flee, but never with a boss", async () => {
    const { game, done } = await gameInFight([{ monster: "bandit", count: 3, name: "Räuber" }]);
    expect(game.applyEffects([{ kind: "flee" }], game.heroes()[0]!)).toHaveLength(1);
    expect(game.mode).toBe("explore");
    expect((await done).winner).toBe("party");
    game.destroy();
    const boss = await gameInFight([{ monster: "bandit-captain", count: 1, boss: true, name: "Hauptmann" }, { monster: "bandit", count: 1, name: "Räuber" }]);
    expect(boss.game.enemiesFlee()).toEqual([]);
    expect(boss.game.mode).toBe("combat");
    boss.game.destroy();
  });

  it("bribes cost gold and end the fight when nobody is left", async () => {
    const { game, done, hero } = await gameInFight([{ monster: "bandit", count: 3, name: "Räuber" }]);
    const n = game.enemiesInFight().length;
    game.giveItem("gold", 100, hero);
    const before = game.partyGold();
    const lines = game.applyEffects([{ kind: "pacify", target: "all", how: "bestechen" }], hero);
    expect(lines[0]).toContain("Gold");
    expect(game.partyGold()).toBe(before - n * 5);
    expect(game.mode).toBe("explore");
    expect((await done).winner).toBe("party");
    game.destroy();
  });

  it("charmed enemies stop fighting; bosses can't be charmed", async () => {
    const { game, hero } = await gameInFight([{ monster: "bandit-captain", count: 1, boss: true, name: "Hauptmann" }, { monster: "bandit", count: 1, name: "Räuber" }]);
    const [boss, minion] = [game.enemiesInFight().find((e) => e.boss)!, game.enemiesInFight().find((e) => !e.boss)!];
    game.applyEffects([{ kind: "pacify", target: boss.id, how: "betoeren" }], hero);
    expect(game.enemiesInFight().some((e) => e.id === boss.id)).toBe(true);
    game.applyEffects([{ kind: "pacify", target: minion.id, how: "betoeren" }], hero);
    expect(game.enemiesInFight().map((e) => e.id)).toEqual([boss.id]);
    expect(game.session.battle.creatures[minion.id]!.side).toBe("neutral");
    game.destroy();
  });

  it("distract, prone, hamper, help and cover change the rolls", async () => {
    const { game, hero, friend } = await gameInFight([{ monster: "bandit", count: 3, name: "Räuber" }]);
    const [a, b] = game.enemiesInFight();
    const battle = game.session.battle;
    const ca = battle.creatures[a!.id]!;
    const cb = battle.creatures[b!.id]!;
    game.applyEffects([{ kind: "distract", target: a!.id }], hero);
    expect(attackReasons(battle, friend!, ca, friend!.attacks[0]!).some((r) => r.glossarKey === "abgelenkt" && r.effect === "advantage")).toBe(true);
    game.applyEffects([{ kind: "hamper", target: b!.id }], hero);
    expect(attackReasons(battle, cb, hero, cb.attacks[0]!).some((r) => r.glossarKey === "behindert" && r.effect === "disadvantage")).toBe(true);
    game.applyEffects([{ kind: "prone", target: b!.id }], hero);
    expect(cb.conditions.some((c) => c.id === "prone")).toBe(true);
    game.applyEffects([{ kind: "help", target: friend!.playerId! }], hero);
    expect(attackReasons(battle, friend!, cb, friend!.attacks[0]!).some((r) => r.glossarKey === "helfen")).toBe(true);
    const ac = armorClass(hero);
    game.applyEffects([{ kind: "cover" }], hero);
    expect(armorClass(hero)).toBe(ac + 2);
    game.destroy();
  });

  it("the surroundings deal rolled damage", async () => {
    const { game, hero } = await gameInFight([{ monster: "bandit", count: 3, name: "Räuber" }]);
    const t = game.enemiesInFight()[0]!;
    const lines = game.applyEffects([{ kind: "hazard", target: t.id, severity: "schwer" }], hero);
    expect(lines[0]).toMatch(/Schaden/);
    expect(game.session.battle.creatures[t.id]!.hp).toBeLessThan(t.hp);
    game.destroy();
  });

  it("outside a fight: finds are limited, first aid heals once per scene", async () => {
    const { game, hero, friend } = await gameInFight([]);
    const potions = () => hero.pc!.inventory.find((i) => i.itemId === "potion-of-healing")?.qty ?? 0;
    const p0 = potions();
    game.applyEffects([{ kind: "find", item: "trank" }], hero);
    game.applyEffects([{ kind: "find", item: "trank" }], hero);
    game.applyEffects([{ kind: "find", item: "trank" }], hero);
    expect(potions()).toBe(p0 + 2);
    friend!.hp = 1;
    game.applyEffects([{ kind: "first_aid", target: friend!.playerId! }], hero);
    const healed = friend!.hp;
    expect(healed).toBeGreaterThan(1);
    game.applyEffects([{ kind: "first_aid", target: friend!.playerId! }], hero);
    expect(friend!.hp).toBe(healed);
    game.destroy();
  });

  it("'yes, but' costs a few hit points, never knocks out", async () => {
    const { game, hero } = await gameInFight([]);
    hero.hp = 2;
    game.applyEffects([{ kind: "cost" }], hero);
    expect(hero.hp).toBe(1);
    game.destroy();
  });

  it("a free action in a fight uses up the action", async () => {
    const { game } = await gameInFight([{ monster: "bandit", count: 3, name: "Räuber" }]);
    let active = game.active()!;
    for (let i = 0; i < 10 && !active.playerId; i++) {
      await new Promise((r) => setTimeout(r, 5));
      active = game.active()!;
    }
    if (active.playerId) {
      game.handle(active.playerId, { kind: "free_text", text: "Ich rufe laut" });
      expect(game.session.battle.combat!.turn.actions).toBe(0);
    }
    game.destroy();
  });
});

describe("degrees of success", () => {
  it("allows 1 effect, 2 on a big success, a price on a near miss, a setback on a clear miss", () => {
    expect(rollAllowance(roll(13))).toEqual({ max: 1, cost: false });
    expect(rollAllowance(roll(18))).toEqual({ max: 2, cost: false });
    expect(rollAllowance(roll(11))).toEqual({ max: 1, cost: true });
    expect(rollAllowance(roll(9))).toEqual({ max: 1, cost: false });
    const c = ctx(bandits);
    const two = [{ kind: "distract" as const, target: "m1" }, { kind: "prone" as const, target: "m2" }];
    expect(filterEffects(two, c, roll(18))).toHaveLength(2);
    expect(filterEffects(two, c, roll(14))).toHaveLength(1);
    expect(filterEffects(two, c, roll(12))).toEqual([{ kind: "distract", target: "m1" }, { kind: "cost" }]);
    // Clear miss: good effects are dropped, only a setback is allowed.
    expect(filterEffects(two, c, roll(5))).toEqual([]);
    expect(filterEffects([{ kind: "distract", target: "m1" }, { kind: "exposed" }], c, roll(5))).toEqual([{ kind: "exposed" }]);
    // …and setbacks never happen on a success.
    expect(filterEffects([{ kind: "exposed" }], c, roll(15))).toEqual([]);
    // Without a roll only helping and cover.
    expect(filterEffects([{ kind: "flee" }, { kind: "cover" }], c, free("x"))).toEqual([{ kind: "cover" }]);
    // Fight effects only in a fight.
    expect(filterEffects([{ kind: "distract", target: "m1" }], ctx(), roll(15))).toEqual([]);
    expect(filterEffects([{ kind: "flee" }], ctx(withBoss), roll(15))).toEqual([]);
  });
});

describe("free actions (scripted narrator)", () => {
  const dm = new ScriptedDM(STORY);
  it("a plain attack that reaches the narrator (nobody in reach) gets no roll and no effects", async () => {
    const res = await dm.respond(ctx(bandits), free("Ich greife Räuber 1 an"));
    expect(res.request_roll).toBeUndefined();
    expect(res.effects).toBeUndefined();
    expect(res.narration).toContain("Reichweite");
  });

  it("understands bribing, charming, scaring, pushing, sand and barrels", async () => {
    const cases: [string, string, string][] = [
      ["Ich biete den Räubern Gold an", "persuasion", "pacify"],
      ["Ich mache Räuber 2 schöne Augen", "persuasion", "pacify"],
      ["Ich brülle sie an und verjage sie", "intimidation", "flee"],
      ["Ich stoße Räuber 1 um", "athletics", "prone"],
      ["Ich werfe Räuber 2 Sand in die Augen", "sleight-of-hand", "hamper"],
      ["Ich rolle ein Fass auf Räuber 1", "athletics", "hazard"],
    ];
    for (const [text, skill, kind] of cases) {
      const first = await dm.respond(ctx(bandits), free(text));
      expect(first.request_roll?.skill, text).toBe(skill);
      const after = await dm.respond(ctx(bandits), { ...roll(16, 12, text), skill });
      expect(after.effects?.[0]?.kind, text).toBe(kind);
    }
    const charm = await dm.respond(ctx(bandits), { ...roll(16, 12, "Ich mache Räuber 2 schöne Augen"), skill: "persuasion" });
    expect(charm.effects?.[0]).toEqual({ kind: "pacify", target: "m2", how: "betoeren" });
  });

  it("helping and cover work without a roll", async () => {
    const help = await dm.respond(ctx(bandits), free("Ich helfe Brunhild"));
    expect(help.effects).toEqual([{ kind: "help", target: "p2" }]);
    const cover = await dm.respond(ctx(bandits), free("Ich gehe hinter dem Fass in Deckung"));
    expect(cover.effects).toEqual([{ kind: "cover" }]);
  });

  it("outside a fight: search, first aid, suggestions", async () => {
    const search = await dm.respond(ctx(), free("Ich durchsuche die Kisten"));
    expect(search.request_roll?.skill).toBe("investigation");
    const found = await dm.respond(ctx(), { ...roll(18, 12, "Ich durchsuche die Kisten"), skill: "investigation" });
    expect(found.effects?.[0]).toEqual({ kind: "find", item: "trank" });
    const aid = await dm.respond(ctx(), { ...roll(12, 10, "Ich verbinde die Wunden"), skill: "medicine" });
    expect(aid.effects?.[0]).toEqual({ kind: "first_aid", target: "p2" });
    const ideas = await dm.respond(ctx(bandits), { kind: "suggest", playerId: "p1", heroName: "Pip" });
    expect(ideas.ideas!.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a bribe without enough gold", async () => {
    const res = await dm.respond(ctx(bandits, { gold: 2 }), free("Ich biete Gold an"));
    expect(res.request_roll).toBeUndefined();
    expect(res.narration).toContain("nicht genug Gold");
  });
});

describe("free actions (AI answers are checked)", () => {
  const base = { narration: "", next: "await_action" as const };
  it("maps named effects and rejects what is not allowed", () => {
    const ok = coerceAiAnswer({ narration: "Sie nehmen das Gold.", effects: [{ name: "bestechen", target: "alle" }] }, STORY, ctx(bandits), roll(15), base);
    expect(ok.effects).toEqual([{ kind: "pacify", target: "all", how: "bestechen" }]);
    const boss = coerceAiAnswer({ narration: "Er ist betört.", effects: [{ name: "betoeren", target: "m3" }] }, STORY, ctx(withBoss), roll(15), base);
    expect(boss.effects).toBeUndefined();
    const poor = coerceAiAnswer({ narration: "x", effects: [{ name: "bestechen", target: "alle" }] }, STORY, ctx(bandits, { gold: 3 }), roll(15), base);
    expect(poor.effects).toBeUndefined();
    const noRoll = coerceAiAnswer({ narration: "x", effects: [{ name: "flucht" }] }, STORY, ctx(bandits), free("Ich brülle"), base);
    expect(noRoll.effects).toBeUndefined();
    const hazard = coerceAiAnswer({ narration: "Der Kronleuchter kracht herab!", effects: [{ name: "umgebung", target: "m1", severity: "schwer" }] }, STORY, ctx(bandits), roll(15), base);
    expect(hazard.effects).toEqual([{ kind: "hazard", target: "m1", severity: "schwer" }]);
  });

  it("takes npc attitude changes only for real characters and small steps", () => {
    const ok = coerceAiAnswer({ narration: "x", npc_attitude: { npc: "brakk", change: 1 } }, STORY, ctx(), roll(15), base);
    expect(ok.npc_attitude).toEqual({ npc: "brakk", change: 1 });
    const big = coerceAiAnswer({ narration: "x", npc_attitude: { npc: "brakk", change: 5 } }, STORY, ctx(), roll(15), base);
    expect(big.npc_attitude).toBeUndefined();
    const fake = coerceAiAnswer({ narration: "x", npc_attitude: { npc: "niemand", change: 1 } }, STORY, ctx(), roll(15), base);
    expect(fake.npc_attitude).toBeUndefined();
  });

  it("returns ideas for the idea button", () => {
    const res = coerceAiAnswer({ ideas: ["Ich schmeichle dem Oger", "Ich werfe Brot über die Brücke", "Ich singe ein Lied", "a", "b"] }, STORY, ctx(), { kind: "suggest", playerId: "p1", heroName: "Pip" }, base);
    expect(res.ideas).toHaveLength(4);
  });
});

describe("setbacks: something always happens", () => {
  it("the rules carry out every setback", async () => {
    const { game, hero } = await gameInFight([{ monster: "bandit", count: 3, name: "Räuber" }]);
    const battle = game.session.battle;
    const enemy = battle.creatures[game.enemiesInFight()[0]!.id]!;
    game.applyEffects([{ kind: "exposed" }], hero);
    expect(attackReasons(battle, enemy, hero, enemy.attacks[0]!).some((r) => r.glossarKey === "abgelenkt")).toBe(true);
    game.applyEffects([{ kind: "fumble" }], hero);
    expect(attackReasons(battle, hero, enemy, hero.attacks[0]!).some((r) => r.glossarKey === "behindert")).toBe(true);
    game.applyEffects([{ kind: "enrage", target: enemy.id }], hero);
    expect(attackReasons(battle, enemy, hero, enemy.attacks[0]!).some((r) => r.glossarKey === "wuetend" && r.effect === "advantage")).toBe(true);
    game.applyEffects([{ kind: "fall" }], hero);
    expect(hero.conditions.some((c) => c.id === "prone")).toBe(true);
    game.giveItem("gold", 10, hero);
    const gold = game.partyGold();
    game.applyEffects([{ kind: "lose_gold" }], hero);
    expect(game.partyGold()).toBeLessThan(gold);
    hero.hp = 3;
    game.applyEffects([{ kind: "hurt", severity: "mittel" }], hero);
    expect(hero.hp).toBeGreaterThanOrEqual(1);
    expect(hero.hp).toBeLessThan(3);
    game.destroy();
  });

  it("the scripted narrator picks a fitting setback for a clear miss", async () => {
    const dm = new ScriptedDM(STORY);
    const cases: [string, string, string][] = [
      ["Ich stoße Räuber 1 um", "athletics", "fall"],
      ["Ich werfe Räuber 2 Sand in die Augen", "sleight-of-hand", "fumble"],
      ["Ich biete den Räubern Gold an", "persuasion", "lose_gold"],
      ["Ich brülle sie an und verjage sie", "intimidation", "enrage"],
      ["Ich mache Räuber 2 schöne Augen", "persuasion", "exposed"],
    ];
    for (const [text, skill, kind] of cases) {
      const res = await dm.respond(ctx(bandits), { ...roll(4, 13, text), skill });
      expect(res.effects?.[0]?.kind, text).toBe(kind);
      expect(res.narration).toMatch(/schief/);
    }
    const search = await dm.respond(ctx(), { ...roll(3, 12, "Ich durchsuche die Kisten"), skill: "investigation" });
    expect(search.effects?.[0]).toEqual({ kind: "hurt", severity: "leicht" });
  });

  it("the AI may only use setbacks on a clear miss", () => {
    const base = { narration: "", next: "await_action" as const };
    const miss = coerceAiAnswer({ narration: "Der Räuber lacht!", effects: [{ name: "wuetend", target: "m1" }, { name: "bestechen", target: "alle" }] }, STORY, ctx(bandits), roll(4), base);
    expect(miss.effects).toEqual([{ kind: "enrage", target: "m1" }]);
    const win = coerceAiAnswer({ narration: "x", effects: [{ name: "wuetend", target: "m1" }] }, STORY, ctx(bandits), roll(15), base);
    expect(win.effects).toBeUndefined();
  });
});

describe("shortcuts and the 'yes, and' rule", () => {
  it("allows a shortcut only after a clean success on a hard roll, and only where there is an obstacle", () => {
    const around = ctx(undefined, { bypass: "an den Wachen vorbeikommen" });
    expect(filterEffects([{ kind: "bypass" }], around, roll(16, 15))).toEqual([{ kind: "bypass" }]);
    // Too easy a roll, a miss, or no obstacle: no shortcut.
    expect(filterEffects([{ kind: "bypass" }], around, roll(16, 13))).toEqual([]);
    expect(filterEffects([{ kind: "bypass" }], around, roll(14, 15))).toEqual([]);
    expect(filterEffects([{ kind: "bypass" }], ctx(), roll(18, 15))).toEqual([]);
  });

  it("without AI, sneaking past asks for a hard roll, and any other idea gets a roll instead of 'nothing happens'", async () => {
    const dm = new ScriptedDM(STORY);
    const sneak = await dm.respond(ctx(undefined, { bypass: "vorbeikommen" }), free("Ich schleiche mich an den Wachen vorbei"));
    expect(sneak.request_roll).toMatchObject({ skill: "stealth", dc: 15 });
    const odd = await dm.respond(ctx(), free("Ich klopfe dreimal an die alte Standuhr"));
    expect(odd.request_roll?.dc).toBe(13);
    const after = await dm.respond(ctx(), { ...roll(15, 13, "Ich klopfe dreimal an die alte Standuhr"), skill: "investigation" });
    expect(after.effects).toEqual([{ kind: "reveal" }]);
  });
});

describe("the bigger toolbox", () => {
  const room = { name: "Schankraum", objects: ["Fässer"], things: [{ id: "o7", name: "Fässer" }, { id: "o8", name: "Tisch" }], people: [{ id: "npc-wirt", name: "Wirt Otto" }] };

  it("walking there always happens (even on a clear miss); a turncoat needs a hard roll", () => {
    const c = ctx(bandits, { room });
    expect(filterEffects([{ kind: "move_to", target: "o7" }, { kind: "object", target: "o7", how: "roll", toward: "m1" }], c, roll(5, 13))).toEqual([{ kind: "move_to", target: "o7" }]);
    expect(filterEffects([{ kind: "move_to", target: "o7" }, { kind: "object", target: "o7", how: "roll", toward: "m1" }], c, roll(15, 13))).toHaveLength(2);
    expect(filterEffects([{ kind: "turncoat", target: "m1" }], c, roll(15, 13))).toEqual([]);
    expect(filterEffects([{ kind: "turncoat", target: "m1" }], c, roll(16, 15))).toEqual([{ kind: "turncoat", target: "m1" }]);
    // Before the roll only free and no-roll steps.
    expect(filterEffects([{ kind: "move_to", target: "o7" }, { kind: "climb" }], c, free("Ich renne hin und klettere hoch"))).toEqual([{ kind: "move_to", target: "o7" }]);
  });

  it("without AI: barrels roll, characters come along, potions are given – with a plan on the phone", async () => {
    const dm = new ScriptedDM(STORY);
    const c = ctx(bandits, { room });
    const ask = await dm.respond(c, free("Ich rolle das Fass auf Räuber 1"));
    expect(ask.request_roll?.skill).toBe("athletics");
    expect(ask.plan).toContain("rollt");
    const after = await dm.respond(c, { ...roll(16, 13, "Ich rolle das Fass auf Räuber 1"), skill: "athletics" });
    expect(after.effects).toEqual([{ kind: "object", target: "o7", how: "roll", toward: "m1" }]);
    const calm = ctx(undefined, { room });
    const follow = await dm.respond(calm, { ...roll(15, 12, "Wirt Otto, komm mit uns!"), skill: "persuasion" });
    expect(follow.effects).toEqual([{ kind: "npc", target: "npc-wirt", how: "follow" }]);
    const feed = await dm.respond(ctx(undefined, { room, players: [{ id: "p1", name: "Pip", classId: "rogue", hp: 5, maxHp: 10 }, { id: "p2", name: "Brunhild", classId: "fighter", hp: 1, maxHp: 12 }] }), free("Ich flöße Brunhild meinen Heiltrank ein"));
    expect(feed.effects).toEqual([{ kind: "move_to", target: "p2" }, { kind: "feed_potion", target: "p2" }]);
  });
});

describe("even more ideas without AI", () => {
  it("asks back when an idea is too vague, and knows the new tricks", async () => {
    const dm = new ScriptedDM(STORY);
    const vague = await dm.respond(ctx(), free("Ich mache was"));
    expect(vague.ask_back).toBeTruthy();
    expect(vague.request_roll).toBeUndefined();
    const feud = await dm.respond(ctx(bandits), { ...roll(15, 13, "Räuber 1, Räuber 2 will dich verraten!"), skill: "deception" });
    expect(feud.effects?.[0]).toMatchObject({ kind: "feud", target: "m1", other: "m2" });
    const wall = await dm.respond(ctx(), free("Ich ramme die morsche Wand ein"));
    expect(wall.request_roll?.dc).toBe(15);
    const ideas = await dm.respond(ctx(bandits, { room: { name: "Keller", objects: [], things: [{ id: "o1", name: "Fässer" }] } }), { kind: "suggest", playerId: "p1", heroName: "Pip" });
    expect(ideas.ideas?.join(" ")).toContain("Fass");
  });
});
