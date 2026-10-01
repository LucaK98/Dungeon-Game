import { describe, expect, it } from "vitest";
import { createMonster } from "../engine/creatures";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { DmContext } from "../shared/dm";
import { cellIndex } from "../shared/map";
import { GameController } from "../tv/game";
import { createSession } from "../tv/session";
import { effectFromName, filterEffects } from "./effects";
import { intentOf, scriptedFreeText, scriptedRollResult } from "./free-actions";
import { STUNTS, stuntOf } from "./stunts";

/** One way a player might say each stunt (in a fight or not, as the stunt allows). */
const SAID: Record<string, string> = {
  feint: "Ich mache eine Finte und täusche links an",
  shield_bash: "Ich ramme ihn mit dem Schild",
  sweep: "Ich fege ihm mit dem Stab die Beine weg",
  grapple: "Ich halte ihn fest",
  protect: "Ich stelle mich schützend vor Ilmarin",
  battle_cry: "Ich stoße einen Kampfschrei aus",
  taunt: "Komm her, du Feigling!",
  grab_weapon: "Ich schnapp mir sein Schwert",
  slide: "Ich rutsche unter dem Tisch durch",
  tap_barrel: "Ich steche ein Loch ins Fass",
  rug_pull: "Ich ziehe den Teppich weg",
  redirect: "Ich lenke den Feuerstrahl auf das Ölfass",
  light_blind: "Ich halte ihm die Fackel direkt in die Augen",
  frost_grip: "Ich friere seine Hand am Griff fest",
  illusion: "Ich lasse eine Illusion entstehen",
  mage_hand: "Ich lasse die Münzen zu mir schweben",
  charge: "Ich konzentriere mich und sammle Kraft",
  lie_army: "Die Stadtwache kommt gleich!",
  haggle: "Geht das auch billiger?",
  compliment: "Ich mache der Wirtin ein Kompliment",
  joke: "Ich erzähle einen Witz",
  song: "Ich singe ein Lied",
  rumors: "Was erzählt man sich hier so?",
  promise: "Ich verspreche dir, wir helfen",
  why_fight: "Warum kämpft ihr eigentlich für ihn?",
  apology: "Tut mir leid, das war nicht so gemeint",
  accuse: "Ich weiß, was du getan hast!",
  listen: "Ich lege das Ohr an die Tür und lausche",
  tracks: "Ich suche nach Fußabdrücken und lese die Spuren",
  keyhole: "Ich schaue durchs Schlüsselloch",
  disarm_trap: "Ich entschärfe die Falle",
  meal: "Wir machen eine kurze Rast und essen Proviant",
  fire: "Ich mache ein kleines Feuer",
  rope: "Ich spanne ein Seil über den Abgrund",
  map: "Ich zeichne eine Karte",
  herbs: "Ist der Pilz giftig?",
  inspect: "Ich drehe den Kelch um",
  drink: "Ich trinke etwas Wasser",
  hide_body: "Ich verstecke die Leiche",
  pickpocket: "Ich klaue ihm den Geldbeutel",
  bait: "Ich lege Fleisch als Köder aus",
  play_dead: "Ich stelle mich tot",
  shadows: "Ich schleiche durch die Schatten",
  false_trail: "Ich lege eine falsche Spur",
  sleep_herb: "Ich mische Schlafkraut ins Bier der Wachen",
  boost: "Ich mache Ilmarin eine Räuberleiter",
  toss_friend: "Wirf mich rüber zu Ilmarin!",
  shieldwall: "Schildwall! Wir stellen uns zusammen",
  watch: "Ich halte Wache",
  encourage: "Du schaffst das, Ilmarin!",
  stabilize: "Ich stabilisiere Ilmarin",
  calm: "Ich rede ruhig auf den Wolf ein und beruhige ihn",
  fetch: "Bello, hol das!",
  scout: "Ich schicke meine Katze voraus zum Auskundschaften",
  ride: "Ich steige aufs Pferd",
  dance: "Ich tanze wild",
  call_name: "Hey Gerd!",
  ghost: "Ich tue so, als wäre ich ein Gespenst – buuuh!",
  tickle: "Ich puste ihm Pfeffer in die Nase",
};

describe("stunts are found by what players write", () => {
  it("every stunt has a sentence that finds it", () => {
    for (const st of STUNTS) {
      const said = SAID[st.id];
      expect(said, st.id).toBeTruthy();
      const fighting = st.combat === true;
      expect(stuntOf(said!, fighting)?.id, `${st.id}: „${said}“`).toBe(st.id);
    }
  });

  it("does not take over everyday sentences or the old ideas", () => {
    for (const s of ["Ich bin bereit", "Ich drehe mich um", "Ich spanne ein Seil als Stolperfalle", "Ich durchsuche die Kiste", "Ich gehe zur Tür"]) {
      expect(stuntOf(s, false), s).toBeUndefined();
      expect(stuntOf(s, true), s).toBeUndefined();
    }
    expect(intentOf("Ich werfe ihm Sand in die Augen", true)?.intent).toBe("blind");
    expect(stuntOf("Ich werfe ihm Sand in die Augen", true)).toBeUndefined();
  });

  it("the AI only gets the stunts the idea is about (small request)", () => {
    const ctx = { players: [], combat: { enemies: [{ id: "g1", name: "Goblin", hp: 7, maxHp: 7 }] } } as unknown as DmContext;
    const free = { kind: "free_text" as const, text: "Ich ramme ihn mit dem Schild", playerId: "p1", heroName: "Brunhild" };
    const roll = { kind: "roll_result" as const, text: free.text, playerId: "p1", heroName: "Brunhild", skill: "athletics", dc: 13, total: 15, success: true };
    expect(effectFromName("schildstoss", "g1", ctx)).toEqual({ kind: "stunt", id: "shield_bash", target: "g1" });
    expect(filterEffects([{ kind: "stunt", id: "shield_bash", target: "g1" }], ctx, roll)).toEqual([{ kind: "stunt", id: "shield_bash", target: "g1" }]);
    // Before the roll a stunt that needs one does nothing yet; one without a roll does.
    expect(filterEffects([{ kind: "stunt", id: "shield_bash", target: "g1" }], ctx, free)).toEqual([]);
    expect(filterEffects([{ kind: "stunt", id: "charge" }], ctx, { ...free, text: "Ich sammle Kraft" })).toEqual([{ kind: "stunt", id: "charge" }]);
  });

  it("without AI: a roll first, then the stunt (or its setback)", () => {
    const ctx = { players: [{ id: "p1", name: "Brunhild", classId: "fighter", hp: 12, maxHp: 12 }], combat: { enemies: [{ id: "g1", name: "Goblin", hp: 7, maxHp: 7 }] } } as unknown as DmContext;
    const first = scriptedFreeText(ctx, { kind: "free_text", text: "Ich fege ihm die Beine weg", playerId: "p1", heroName: "Brunhild" })!;
    expect(first.request_roll?.skill).toBe("athletics");
    expect(first.plan).toContain("Boden");
    const won = scriptedRollResult(ctx, { kind: "roll_result", text: "Ich fege ihm die Beine weg", playerId: "p1", heroName: "Brunhild", skill: "athletics", dc: 12, total: 15, success: true });
    expect(won.effects).toEqual([{ kind: "stunt", id: "sweep", target: "g1" }]);
    const lost = scriptedRollResult(ctx, { kind: "roll_result", text: "Ich fege ihm die Beine weg", playerId: "p1", heroName: "Brunhild", skill: "athletics", dc: 12, total: 3, success: false });
    expect(lost.effects).toEqual([{ kind: "fall" }]);
  });
});

function setup() {
  const rng = seededRng(5);
  const session = createSession(rng, {
    players: [
      { playerId: "p1", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#e6194b" } },
      { playerId: "p2", profile: { name: "Ilmarin", classId: "wizard", raceId: "elf", look: defaultLook("wizard", "elf"), color: "#4363d8" } },
    ],
    plan: { path: ["burghof", "gang_gerade", "wachstube"] },
    noMonsters: true,
  });
  const game = new GameController(session, rng, () => {}, () => {}, { monsterDelayMs: 0, turnBasedExplore: true });
  game.start();
  session.map.explored.fill(true);
  const a = game.heroOf("p1")!;
  const b = game.heroOf("p2")!;
  b.pos = { x: a.pos!.x, y: a.pos!.y + 1 };
  return { game, session, a, b };
}

describe("stunts in the game", () => {
  it("every stunt does something (or says why not) – in and out of a fight, without errors", () => {
    for (const st of STUNTS) {
      for (const fight of [false, true]) {
        if (st.combat !== "both" && st.combat !== fight) continue;
        const { game, session, a, b } = setup();
        const wirt = createMonster("commoner", "npc-wirt", { name: "Wirt Otto", side: "neutral" });
        wirt.pos = { x: a.pos!.x + 1, y: a.pos!.y };
        session.battle.creatures[wirt.id] = wirt;
        let target: string | undefined = st.target === "hero" ? b.id : st.target === "person" ? wirt.id : undefined;
        if (fight) {
          game.spawnNearParty(["goblin", "wolf"]);
          const foe = Object.values(session.battle.creatures).find((c) => c.side === "enemy")!;
          if (st.target === "enemy") target = foe.id;
          if (st.id === "shield_bash" || st.id === "grapple") foe.pos = { x: a.pos!.x - 1, y: a.pos!.y };
        }
        const lines = game.applyEffects([{ kind: "stunt", id: st.id, ...(target ? { target } : {}) }], a);
        expect(lines.join(" "), `${st.id} (${fight ? "Kampf" : "Erkunden"})`).not.toBe("");
      }
    }
  });

  it("a few rules up close: taunt, protect, haggle, watch, meal once per place", () => {
    const { game, session, a, b } = setup();
    // Haggling: the next purchase is cheaper.
    game.applyEffects([{ kind: "stunt", id: "haggle" }], a);
    expect((game as unknown as { priceFor: (h: unknown, p: number) => number }).priceFor(a, 10)).toBe(8);
    // Watch: the world's next danger is warded off once.
    game.applyEffects([{ kind: "stunt", id: "watch" }], a);
    expect(game.useWorldShield()).toBe(true);
    expect(game.useWorldShield()).toBe(false);
    // A meal: once per place.
    b.hp = 1;
    game.applyEffects([{ kind: "stunt", id: "meal" }], a);
    expect(b.hp).toBeGreaterThan(1);
    expect(game.applyEffects([{ kind: "stunt", id: "meal" }], a).join(" ")).toContain("schon gerastet");
    // Protect: cover for the friend.
    game.spawnNearParty(["goblin"]);
    game.applyEffects([{ kind: "stunt", id: "protect", target: b.id }], a);
    expect(b.effects.some((e) => e.id === "cover")).toBe(true);
    // Taunt: the foe is marked to go for the taunter.
    const g = Object.values(session.battle.creatures).find((c) => c.side === "enemy")!;
    game.applyEffects([{ kind: "stunt", id: "taunt", target: g.id }], a);
    expect(g.effects.find((e) => e.id === "taunted")?.sourceId).toBe(a.id);
    void cellIndex;
  });
});

describe("by accident (ups!)", () => {
  const chance = GameController.MISHAP_CHANCE as { clean: number; close: number };
  it("sometimes an action sets off something else – and it fits the action", () => {
    const keep = { ...chance };
    chance.clean = 1;
    chance.close = 1;
    try {
      // A fire: sparks fly.
      const { game, session, a } = setup();
      const lines = game.applyEffects([{ kind: "stunt", id: "fire" }], a);
      const text = lines.join(" ");
      expect(text).toMatch(/Ups!|Zufall!/);
      if (/Funken/.test(text)) expect(Object.values(session.map.surface ?? {}).some((x) => x.kind === "fire")).toBe(true);
      // Singing near sleeping foes wakes them.
      const s2 = setup();
      s2.game.stageFight([{ monster: "goblin", count: 2 }], "asleep");
      s2.game.applyEffects([{ kind: "stunt", id: "song" }], s2.a);
      expect(s2.game.mode).toBe("combat");
      // A lucky find on the tracks.
      const s3 = setup();
      const before = s3.a.pc!.inventory.find((i) => i.itemId === "gold")?.qty ?? 0;
      expect(s3.game.applyEffects([{ kind: "stunt", id: "tracks" }], s3.a).join(" ")).toContain("Zufall!");
      expect(s3.a.pc!.inventory.find((i) => i.itemId === "gold")!.qty).toBeGreaterThan(before);
    } finally {
      Object.assign(chance, keep);
    }
  });

  it("never with no chance, and only for actions that have accidents", () => {
    const keep = { ...chance };
    chance.clean = 0;
    chance.close = 0;
    try {
      const { game, a } = setup();
      expect(game.applyEffects([{ kind: "stunt", id: "fire" }], a).join(" ")).not.toMatch(/Ups!|Zufall!/);
    } finally {
      Object.assign(chance, keep);
    }
    chance.clean = 1;
    try {
      const { game, a } = setup();
      // Keeping watch has no accident.
      expect(game.applyEffects([{ kind: "stunt", id: "watch" }], a).join(" ")).not.toMatch(/Ups!|Zufall!/);
    } finally {
      Object.assign(chance, keep);
    }
  });
});
