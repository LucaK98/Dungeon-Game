import { describe, expect, it } from "vitest";
import { glossarForQuestion } from "../data/help/glossar";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import type { Story } from "../shared/story";
import { GameController } from "../tv/game";
import { createSession } from "../tv/session";
import { coerceAiAnswer } from "./ai/aidm";
import { glossaryAnswer, glossaryExcerpt } from "./rules-help";
import { ScriptedDM } from "./scripted";
import storyJson from "./stories/drachenfels.json";

const STORY = storyJson as unknown as Story;

describe("Frag den Spielleiter", () => {
  it("finds the matching glossary entries for a question in plain words", () => {
    expect(glossarForQuestion("Was bringt Deckung?")[0]!.key).toBe("deckung");
    expect(glossarForQuestion("Wie funktioniert Vorteil?")[0]!.key).toBe("vorteil");
    expect(glossarForQuestion("Wann kann ich eine Bonusaktion machen?").map((g) => g.key)).toContain("bonusaktion");
    expect(glossaryAnswer("Was bringt Deckung?")).toMatch(/Deckung/);
    expect(glossaryAnswer("xyzzy")).toMatch(/nichts/);
  });

  it("answers without AI from the glossary", async () => {
    const q = "Was bringt Deckung?";
    const res = await new ScriptedDM(STORY).respond(
      { storyId: STORY.id, duration: "kurz", truth: "A", sceneId: "bruecke", sceneIndex: 1, sceneCount: 6, players: [], flags: [], cluesFound: [], twistRevealed: false, minutesPlayed: 0, minutesPlanned: 0, hardship: 0, eventsUsed: [] },
      { kind: "rules_question", question: q, playerId: "p1", heroName: "Pip", glossary: glossaryExcerpt(q), hero: "Pip" },
    );
    expect(res.answer).toMatch(/Rüstungsklasse/);
  });

  it("sends the answer only to the phone that asked", async () => {
    const rng = seededRng(3);
    const session = createSession(rng, {
      players: [
        { playerId: "p1", profile: { name: "Pip", classId: "rogue", raceId: "halfling", look: defaultLook("rogue", "halfling"), color: "#fff" } },
        { playerId: "p2", profile: { name: "Brunhild", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#f00" } },
      ],
      plan: { path: ["burghof"] },
      noMonsters: true,
    });
    const sent: { to: string; e: GameEvent }[] = [];
    const game = new GameController(session, rng, (to, e) => sent.push({ to, e }), () => {});
    game.start();
    game.handle("p2", { kind: "ask_rules", question: "Was ist Vorteil?" });
    await new Promise((r) => setTimeout(r, 10));
    const answers = sent.filter((s) => s.e.type === "rules_answer");
    expect(answers).toHaveLength(1);
    expect(answers[0]!.to).toBe("p2");
    game.destroy();
  });

  it("takes the AI's answer and rejects an empty one", () => {
    const ctx = { storyId: STORY.id, duration: "kurz" as const, truth: "A", sceneId: "bruecke", sceneIndex: 1, sceneCount: 6, players: [], flags: [], cluesFound: [], twistRevealed: false, minutesPlayed: 0, minutesPlanned: 0, hardship: 0, eventsUsed: [] };
    const trigger = { kind: "rules_question" as const, question: "Was ist Vorteil?", playerId: "p1", heroName: "Pip", glossary: [], hero: "Pip" };
    expect(coerceAiAnswer({ answer: "Du würfelst zweimal und nimmst den besseren Wurf." }, STORY, ctx, trigger, { narration: "", next: "await_action" }).answer).toMatch(/zweimal/);
    expect(() => coerceAiAnswer({ answer: "" }, STORY, ctx, trigger, { narration: "", next: "await_action" })).toThrow();
  });
});
