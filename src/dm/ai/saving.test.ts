import { describe, expect, it } from "vitest";
import type { DmContext, DmTrigger } from "../../shared/dm";
import type { Story } from "../../shared/story";
import storyJson from "../stories/drachenfels.json";
import { glossaryDirect } from "../rules-help";
import { AiDM, coerceAiAnswer } from "./aidm";
import { buildPrompt, responseSchema } from "./prompt";
import { geminiUsage, type LlmProvider, type LlmRequest } from "./provider";
import { budgetState } from "./settings";

const STORY = storyJson as unknown as Story;
const SCENE = STORY.acts.flatMap((a) => a.scenes).find((s) => (s.npcs ?? []).length)!;
const NPC = STORY.npcs.find((n) => n.id === SCENE.npcs![0]!.npc)!;

function ctx(extra: Partial<DmContext> = {}): DmContext {
  return {
    storyId: STORY.id, duration: "kurz", truth: STORY.truths[0]!.id, sceneId: SCENE.id, sceneIndex: 1, sceneCount: 5,
    players: [{ id: "p1", name: "Brunhild", classId: "fighter", hp: 12, maxHp: 12 }],
    flags: [], cluesFound: [], twistRevealed: false, minutesPlayed: 10, minutesPlanned: 20, hardship: 0, eventsUsed: [],
    ...extra,
  };
}
const free: DmTrigger = { kind: "free_text", text: "Ich suche nach Spuren", playerId: "p1", heroName: "Brunhild" };
const suggest: DmTrigger = { kind: "suggest", playerId: "p1", heroName: "Brunhild" };

function recorder(id: string, lite: boolean, answer: Record<string, unknown> = { narration: "Hallo", ideas: ["Ich schaue mich um"] }) {
  const seen: { model: string; req: LlmRequest }[] = [];
  const p: LlmProvider = {
    id: "gemini",
    model: id,
    lite,
    lastUsage: { input: 1200, cached: 900, output: 80 },
    complete: async (req) => (seen.push({ model: id, req }), answer),
  };
  return { p, seen };
}

describe("the AI spends less", () => {
  it("only a hero's own idea gets the toolbox (effects) – ideas and scene starts do not", () => {
    expect(JSON.stringify(responseSchema(STORY, ctx(), free))).toContain("effects");
    expect(JSON.stringify(responseSchema(STORY, ctx(), suggest))).not.toContain("effects");
    expect(buildPrompt(STORY, ctx(), suggest, { narration: "", next: "await_action" })).not.toContain("EFFEKTE");
    expect(buildPrompt(STORY, ctx(), { kind: "scene_start" }, { narration: "", next: "await_action" })).not.toContain("EFFEKTE");
  });

  it("rules questions do not carry the story's secret; minds only of the people who are here", () => {
    const rules: DmTrigger = { kind: "rules_question", question: "Kann ich noch angreifen?", playerId: "p1", heroName: "Brunhild", glossary: [], hero: "Brunhild" };
    expect(buildPrompt(STORY, ctx(), rules, { narration: "", next: "await_action" })).not.toContain("GEHEIME WAHRHEIT");
    const minds = [`${NPC.name} (Frau): mutig.`, "Fremder Ferdinand (Mann): weit weg."];
    const p = buildPrompt(STORY, ctx({ minds }), free, { narration: "", next: "await_action" });
    expect(p).toContain(NPC.name + " (Frau)");
    expect(p).not.toContain("Fremder Ferdinand");
    // Named in the idea: that one comes along.
    const named = buildPrompt(STORY, ctx({ minds }), { ...free, text: "Ich rufe nach Ferdinand" } as DmTrigger, { narration: "", next: "await_action" });
    expect(named).toContain("Fremder Ferdinand");
  });

  it("small tasks go to the small model first (and say so to the server); usage is reported", async () => {
    const main = recorder("flash", false);
    const small = recorder("flash-lite", true);
    const used: number[] = [];
    const dm = new AiDM(STORY, [main.p, small.p], { onUsage: (u) => used.push(u.input) });
    await dm.respond(ctx(), suggest);
    expect(small.seen.length).toBe(1);
    expect(small.seen[0]!.req.tier).toBe("lite");
    expect(main.seen.length).toBe(0);
    await dm.respond(ctx(), free);
    expect(main.seen.length).toBe(1);
    expect(main.seen[0]!.req.tier).toBeUndefined();
    expect(used).toEqual([1200, 1200]);
  });

  it("the saving brake: from 80 % only important moments, at 100 % the script", async () => {
    expect(budgetState("small", 10)).toBe("full");
    expect(budgetState("small", 80)).toBe("important");
    expect(budgetState("small", 100)).toBe("none");
    expect(budgetState("open", 9999)).toBe("full");
    const main = recorder("flash", false);
    let state: "full" | "important" | "none" = "important";
    const dm = new AiDM(STORY, [main.p], { budget: () => state });
    await dm.respond(ctx(), suggest);
    expect(main.seen.length).toBe(0);
    await dm.respond(ctx(), free);
    expect(main.seen.length).toBe(1);
    state = "none";
    await dm.respond(ctx(), free);
    expect(main.seen.length).toBe(1);
  });

  it("the scene start fills a store: greetings only for people who are here, a few quiet moments", () => {
    const raw = {
      narration: "Ihr tretet ein.",
      gruesse: [{ name: NPC.name, text: "„Na endlich!“" }, { name: "Niemand", text: "Huhu" }],
      momente: ["Irgendwo klappert ein Fensterladen.", "Jemand flüstert von einem Drachen.", "Ein Hund bellt.", "zu viel"],
    };
    const out = coerceAiAnswer(raw, STORY, ctx(), { kind: "scene_start" }, { narration: "", next: "await_action" });
    expect(out.pack?.greetings).toEqual([{ name: NPC.name, text: "Na endlich!" }]);
    expect(out.pack?.moments.length).toBe(3);
    expect(JSON.stringify(responseSchema(STORY, ctx(), { kind: "scene_start" }))).toContain("momente");
  });

  it("Gemini's usage numbers include the thinking", () => {
    expect(geminiUsage({ promptTokenCount: 3000, cachedContentTokenCount: 2000, candidatesTokenCount: 100, thoughtsTokenCount: 50 })).toEqual({ input: 3000, cached: 2000, output: 150 });
  });

  it("a plain 'Was ist …?' is answered from the rule book; questions about the own turn are not", () => {
    expect(glossaryDirect("Was ist Vorteil?")).toMatch(/Vorteil/);
    expect(glossaryDirect("Kann ich noch angreifen?")).toBeUndefined();
    expect(glossaryDirect("Was bringt mir Vorteil gerade?")).toBeUndefined();
  });
});
