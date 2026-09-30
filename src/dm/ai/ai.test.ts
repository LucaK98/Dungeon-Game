import { describe, expect, it } from "vitest";
import type { DmContext } from "../../shared/dm";
import type { Story } from "../../shared/story";
import storyJson from "../stories/drachenfels.json";
import { AiDM, coerceAiAnswer } from "./aidm";
import { allowedClues } from "./prompt";
import { GeminiProvider, LlmError, thinkingFor, type LlmProvider } from "./provider";
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

  it("asks for little thinking, fitting to the model", () => {
    expect(thinkingFor("gemini-flash-latest")).toEqual({ thinkingLevel: "low" });
    expect(thinkingFor("gemini-3.1-flash-lite-preview")).toEqual({ thinkingLevel: "low" });
    expect(thinkingFor("gemini-2.5-flash")).toEqual({ thinkingBudget: 0 });
    expect(thinkingFor("gemini-2.5-pro")).toEqual({ thinkingBudget: 128 });
    expect(thinkingFor("gemini-2.0-flash")).toBeUndefined();
  });

  it("sends the thinking setting, and without it if the model does not know it", async () => {
    const bodies: { generationConfig: { thinkingConfig?: unknown } }[] = [];
    const fakeFetch = (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      bodies.push(b);
      if (b.generationConfig.thinkingConfig) return new Response('{"error":{"message":"Thinking level is not supported for this model."}}', { status: 400 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"narration":"Hallo"}' }] } }] }), { status: 200 });
    }) as typeof fetch;
    const out = await new GeminiProvider("k", "gemini-flash-latest", fakeFetch).complete({ system: "s", prompt: "p", schema: {} });
    expect(out).toEqual({ narration: "Hallo" });
    expect(bodies[0]!.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(bodies[1]!.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("reports the rate limit as a limit error", async () => {
    const fakeFetch = (async () => new Response('{"error":{"code":429}}', { status: 429 })) as unknown as typeof fetch;
    const p = new GeminiProvider("k", "m", fakeFetch);
    await expect(p.complete({ system: "", prompt: "", schema: {} })).rejects.toMatchObject({ kind: "limit" });
  });
});

describe("checking AI answers", () => {
  it("keeps what a character remembers, with the character who spoke", () => {
    const free = { kind: "free_text" as const, text: "Ich schenke der Wirtin eine Blume", playerId: "p1", heroName: "Pip" };
    const out = coerceAiAnswer({ narration: "Sie lächelt.", npc_name: "Wirtin Rosa", npc_text: "Oh, wie lieb!", npc_memory: "Pip hat mir eine Blume geschenkt." }, STORY, ctx(), free, { narration: "", next: "await_action" });
    expect(out.npc_memory).toEqual({ name: "Wirtin Rosa", fact: "Pip hat mir eine Blume geschenkt." });
    const none = coerceAiAnswer({ narration: "Nichts.", npc_memory: "ohne Sprecherin" }, STORY, ctx(), free, { narration: "", next: "await_action" });
    expect(none.npc_memory).toBeUndefined();
  });

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

  it("lets this TV's backup key step in when the server is used up or has no key", async () => {
    const calls: string[] = [];
    const server = (kind: LlmError["kind"]): LlmProvider => ({ id: "server", model: "server", complete: async () => (calls.push("server"), Promise.reject(new LlmError(kind, kind))) });
    expect((await new AiDM(STORY, [server("limit"), ok("backup", calls)]).respond(ctx(), scripted)).narration).toBe("backup");
    calls.length = 0;
    const dm = new AiDM(STORY, [server("auth"), ok("backup", calls)]);
    expect((await dm.respond(ctx(), scripted)).narration).toBe("backup");
    // The refused server is not asked again in this game.
    await dm.respond(ctx(), free);
    expect(calls).toEqual(["server", "backup", "backup"]);
  });

  it("builds the server chain with the backup key only when one is set", async () => {
    const { providersFrom, DEFAULT_SETTINGS } = await import("./settings");
    expect(providersFrom({ ...DEFAULT_SETTINGS, provider: "server" }, "R")!.map((p) => p.id)).toEqual(["server"]);
    const chain = providersFrom({ ...DEFAULT_SETTINGS, provider: "server", backupKey: "AQ.test" }, "R");
    expect(chain!.map((p) => p.id)).toEqual(["server", "gemini", "gemini"]);
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

describe("Server provider (Supabase Edge Function)", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("sends the prompt with the public key and returns the parsed answer", async () => {
    let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ ok: true, model: "gemini-flash-latest", text: '{"narration":"Hallo"}' }), { status: 200 });
    }) as typeof fetch;
    const { ServerProvider } = await import("./provider");
    const p = new ServerProvider("https://x.supabase.co/functions/v1/dm", "anon-jwt", "ABCD", fetchFn);
    expect(await p.complete({ system: "s", prompt: "p", schema: { type: "OBJECT" } })).toEqual({ narration: "Hallo" });
    expect(seen!.headers.authorization).toBe("Bearer anon-jwt");
    expect(seen!.body.room).toBe("ABCD");
    expect(JSON.stringify(seen!.body)).not.toContain("AQ.");
  });

  it("maps server errors to limit / missing key", async () => {
    const { ServerProvider } = await import("./provider");
    await expect(new ServerProvider("u", "k", "R", reply(429, { error: "limit" })).complete({ system: "", prompt: "p", schema: {} })).rejects.toMatchObject({ kind: "limit" });
    await expect(new ServerProvider("u", "k", "R", reply(503, { error: "not_configured" })).complete({ system: "", prompt: "p", schema: {} })).rejects.toMatchObject({ kind: "auth" });
    expect(await new ServerProvider("u", "k", "R", reply(200, { ok: true, configured: false })).ping()).toBe(false);
    expect(await new ServerProvider("u", "k", "R", reply(200, { ok: true, configured: true })).ping()).toBe(true);
  });
});

describe("tests never spend AI credit", () => {
  it("the real network is closed in test runs", async () => {
    const { aiBlocked, ServerProvider } = await import("./provider");
    expect(aiBlocked()).toBe(true);
    const p = new ServerProvider("https://example.invalid/functions/v1/dm", "anon", "ROOM");
    await expect(p.complete({ system: "s", prompt: "p", schema: {} })).rejects.toMatchObject({ kind: "network" });
  });

  it("no AI with \"noai\" in the address or in a remote-controlled browser", async () => {
    const { aiBlocked } = await import("./provider");
    const g = globalThis as { location?: unknown; navigator?: unknown };
    const saved = { location: g.location, navigator: g.navigator };
    try {
      Object.defineProperty(globalThis, "location", { value: { href: "https://lucak98.github.io/Dungeon-Game/#/tv?noai" }, configurable: true });
      expect(aiBlocked(false)).toBe(true);
      Object.defineProperty(globalThis, "location", { value: { href: "https://lucak98.github.io/Dungeon-Game/#/tv" }, configurable: true });
      expect(aiBlocked(false)).toBe(false);
      Object.defineProperty(globalThis, "navigator", { value: { webdriver: true }, configurable: true });
      expect(aiBlocked(false)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "location", { value: saved.location, configurable: true });
      Object.defineProperty(globalThis, "navigator", { value: saved.navigator, configurable: true });
    }
  });
});

describe("the server AI is the standard", () => {
  const withStorage = async (stored: unknown, run: (mod: typeof import("./settings")) => void) => {
    const data = new Map<string, string>();
    if (stored !== undefined) data.set("couch-dungeon.ai", JSON.stringify(stored));
    const fake = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const g = globalThis as { localStorage?: unknown };
    const saved = g.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true });
    try {
      run(await import("./settings"));
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: saved, configurable: true });
    }
    return data;
  };

  it("a new device starts on the server AI", async () => {
    await withStorage(undefined, (m) => expect(m.loadAiSettings().provider).toBe("server"));
  });

  it("old settings (script or own key) move to the server AI, keys stay", async () => {
    await withStorage({ provider: "off", keys: {} }, (m) => expect(m.loadAiSettings().provider).toBe("server"));
    await withStorage({ provider: "gemini", keys: { gemini: "AQ.test" } }, (m) => {
      const s = m.loadAiSettings();
      expect(s.provider).toBe("server");
      expect(s.keys.gemini).toBe("AQ.test");
    });
  });

  it("a choice made on purpose stays (script or own key)", async () => {
    const data = await withStorage(undefined, (m) => m.saveAiSettings({ ...m.DEFAULT_SETTINGS, provider: "off" }));
    const saved = JSON.parse(data.get("couch-dungeon.ai")!);
    await withStorage(saved, (m) => expect(m.loadAiSettings().provider).toBe("off"));
    await withStorage({ ...saved, provider: "groq" }, (m) => expect(m.loadAiSettings().provider).toBe("groq"));
  });
});
