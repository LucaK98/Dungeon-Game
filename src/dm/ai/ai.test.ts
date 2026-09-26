import { describe, expect, it } from "vitest";
import type { DmContext } from "../../shared/dm";
import type { Story } from "../../shared/story";
import storyJson from "../stories/drachenfels.json";
import { AiDM, coerceAiAnswer } from "./aidm";
import { allowedClues } from "./prompt";
import { GeminiProvider, LlmError, type LlmProvider } from "./provider";
import { sceneById } from "../planner";

const STORY = storyJson as unknown as Story;
// A scene that has clue slots.
const SCENE = STORY.acts.flatMap((a) => a.scenes).find((s) => (s.clues ?? []).length)!;

function ctx(truth = STORY.truths[0]!.id): DmContext {
  return {
    storyId: STORY.id, duration: "kurz", truth, sceneId: SCENE.id, sceneIndex: 1, sceneCount: 5,
    players: [{ id: "p1", name: "Brunhild", classId: "fighter", hp: 12, maxHp: 12 }],
    flags: [], cluesFound: [], twistRevealed: false, minutesPlayed: 10, minutesPlanned: 20, hardship: 0, eventsUsed: [],
  };
}
const free = { kind: "free_text" as const, text: "Ich suche nach Spuren", playerId: "p1", heroName: "Brunhild" };

describe("Gemini provider", () => {
  it("sends the key only in the x-goog-api-key header and accepts AQ. keys", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    let body: { generationConfig: { responseMimeType: string } } | undefined;
    const fakeFetch = (async (u: string, init: RequestInit) => {
      url = u;
      headers = init.headers as Record<string, string>;
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "…", thought: true }, { text: '{"narration":"Hallo"}' }] } }] }), { status: 200 });
    }) as typeof fetch;
    const p = new GeminiProvider("AQ.test-key-123", "gemini-flash-latest", fakeFetch);
    const out = await p.complete({ system: "s", prompt: "p", schema: { type: "OBJECT" } });
    expect(out).toEqual({ narration: "Hallo" });
    expect(headers["x-goog-api-key"]).toBe("AQ.test-key-123");
    expect(url).not.toContain("key=");
    expect(url).not.toContain("AQ.");
    expect(url).toContain("/models/gemini-flash-latest:generateContent");
    expect(body!.generationConfig.responseMimeType).toBe("application/json");
  });

  it("reports the rate limit as a limit error", async () => {
    const fakeFetch = (async () => new Response('{"error":{"code":429}}', { status: 429 })) as unknown as typeof fetch;
    const p = new GeminiProvider("k", "m", fakeFetch);
    await expect(p.complete({ system: "", prompt: "", schema: {} })).rejects.toMatchObject({ kind: "limit" });
  });
});

describe("checking AI answers", () => {
  it("maps a roll request and drops clues that are not allowed", () => {
    const out = coerceAiAnswer({ narration: "Du tastest die Wand ab.", roll_skill: "investigation", roll_dc: 13, reveal_clue: "wahrheit_verraten" }, STORY, ctx(), free, { narration: "", next: "await_action" });
    expect(out.request_roll).toMatchObject({ playerId: "p1", skill: "investigation", dc: 13, ability: "INT" });
    expect(out.reveal_clue).toBeUndefined();
  });

  it("never reveals a clue of another truth", () => {
    const [t1, t2] = STORY.truths;
    const mine = allowedClues(STORY, SCENE, ctx(t1!.id)).map((c) => c.id);
    const other = allowedClues(STORY, SCENE, ctx(t2!.id)).map((c) => c.id).filter((id) => !mine.includes(id));
    for (const id of other) {
      const out = coerceAiAnswer({ narration: "x", reveal_clue: id }, STORY, ctx(t1!.id), free, { narration: "", next: "await_action" });
      expect(out.reveal_clue).toBeUndefined();
    }
    if (mine[0]) {
      const ok = coerceAiAnswer({ narration: "x", reveal_clue: mine[0] }, STORY, ctx(t1!.id), free, { narration: "", next: "await_action" });
      expect(ok.reveal_clue).toBe(mine[0]);
    }
  });

  it("rejects answers without text", () => {
    expect(() => coerceAiAnswer({ narration: "" }, STORY, ctx(), free, { narration: "", next: "await_action" })).toThrow(LlmError);
  });
});

describe("AiDM", () => {
  const scripted = { kind: "scene_start" as const };
  const ok = (text: string, calls: string[]): LlmProvider => ({ id: "gemini", model: text, complete: async () => (calls.push(text), { narration: text }) });
  const failing = (kind: LlmError["kind"], calls: string[], model = "flash"): LlmProvider => ({ id: "gemini", model, complete: async () => (calls.push(model), Promise.reject(new LlmError(kind, kind))) });

  it("uses the fallback model when the main one is at its limit", async () => {
    const calls: string[] = [];
    const dm = new AiDM(STORY, [failing("limit", calls), ok("lite", calls)]);
    const res = await dm.respond(ctx(), scripted);
    expect(res.narration).toBe("lite");
    expect(calls).toEqual(["flash", "lite"]);
  });

  it("falls back to the script, pauses and does not hammer the API during the pause", async () => {
    const calls: string[] = [];
    let now = 0;
    const status: string[] = [];
    const dm = new AiDM(STORY, [failing("limit", calls)], { now: () => now, cooldownMs: 60_000, onStatus: (s) => status.push(s.kind) });
    const res = await dm.respond(ctx(), scripted);
    expect(res.narration).toBe(SCENE.travel ?? "");
    expect(status).toEqual(["thinking", "pause"]);
    await dm.respond(ctx(), free);
    expect(calls).toHaveLength(1);
    now = 61_000;
    await dm.respond(ctx(), free);
    expect(calls).toHaveLength(2);
  });

  it("asks once more after a broken answer", async () => {
    let n = 0;
    const p: LlmProvider = { id: "gemini", model: "m", complete: async () => (++n === 1 ? { oops: 1 } : { narration: "Zweiter Versuch" }) };
    const res = await new AiDM(STORY, [p]).respond(ctx(), scripted);
    expect(res.narration).toBe("Zweiter Versuch");
    expect(n).toBe(2);
  });

  it("does not call the AI for ordinary steps", async () => {
    const calls: string[] = [];
    const dm = new AiDM(STORY, [ok("x", calls)]);
    await dm.respond({ ...ctx(), stepId: sceneById(STORY, SCENE.id).steps[0]!.id }, { kind: "step_start" });
    await dm.respond(ctx(), { kind: "scene_end" });
    expect(calls).toEqual([]);
  });
});
