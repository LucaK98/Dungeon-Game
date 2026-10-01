/**
 * Talks to the language model. Provider-independent: the AI DM only knows `LlmProvider`.
 * The key is typed in on the TV, stays in its localStorage and is sent only to the provider
 * (Gemini: header `x-goog-api-key`, never as a URL parameter). No format check on the key:
 * Gemini keys may start with "AQ." as well as "AIza".
 */

export interface LlmRequest {
  system: string;
  prompt: string;
  /** JSON schema (OpenAPI subset as used by Gemini) the answer must follow. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** "lite": a small task (ideas, rules, a hint) – the smaller, cheaper model is enough. */
  tier?: "lite";
}

/** Tokens of one call: sent, of those reused from the provider's cache (cheaper), and the answer (incl. thinking). */
export interface LlmUsage {
  input: number;
  cached: number;
  output: number;
}

export type LlmErrorKind = "limit" | "timeout" | "auth" | "bad_json" | "network" | "other";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly model: string;
  /** A small, cheap model (tried first for small tasks). */
  readonly lite?: boolean;
  /** What the last successful call used (if the provider reports it). */
  lastUsage?: LlmUsage;
  /** Returns the parsed JSON object (not yet validated). */
  complete(req: LlmRequest): Promise<unknown>;
}

export type ProviderId = "gemini" | "groq" | "server";

type Fetch = typeof fetch;

/**
 * Tests never spend AI credit: automated test runs (Vitest), remote-controlled browsers
 * (Playwright & co. set navigator.webdriver) and pages opened with "noai" in the address
 * get no AI at all – the game runs on its script, the voice is the free browser voice.
 */
export function aiBlocked(inUnitTests = true): boolean {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> }; navigator?: { webdriver?: boolean }; location?: { href?: string } };
  if (inUnitTests && g.process?.env?.VITEST) return true;
  if (g.navigator?.webdriver) return true;
  return /[?&#/]noai\b/i.test(g.location?.href ?? "");
}

/** The real network – refused while AI is blocked (a safety net behind providersFrom). */
const realFetch: Fetch = (...a) => (aiBlocked() ? Promise.reject(new LlmError("network", "Im Testmodus ist die KI aus.")) : fetch(...a));

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (ctrl.signal.aborted) throw new LlmError("timeout", "Keine Antwort in der Zeit.");
    throw new LlmError("network", "Keine Verbindung zum KI-Anbieter.");
  } finally {
    clearTimeout(t);
  }
}

function httpError(status: number, detail: string): LlmError {
  if (status === 429) return new LlmError("limit", "Das Gratis-Limit ist gerade erreicht.");
  if (status === 401 || status === 403) return new LlmError("auth", "Der Schlüssel wurde abgelehnt.");
  if (status === 400 && /api key|API_KEY/i.test(detail)) return new LlmError("auth", "Der Schlüssel wurde abgelehnt.");
  if (status === 404) return new LlmError("other", "Dieses Modell gibt es nicht (mehr). Bitte in den Einstellungen ein anderes wählen.");
  if (status >= 500) return new LlmError("other", "Der KI-Anbieter hat gerade Probleme.");
  return new LlmError("other", `Fehler ${status}: ${detail.slice(0, 160)}`);
}

export function parseJson(text: string): unknown {
  // Some models wrap JSON in ``` fences despite the JSON mode.
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(clean);
  } catch {
    throw new LlmError("bad_json", "Die Antwort war kein gültiges JSON.");
  }
}

/** Gemini's usageMetadata → tokens (thinking counts like answer tokens). */
export function geminiUsage(u: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined): LlmUsage | undefined {
  if (!u) return undefined;
  return { input: u.promptTokenCount ?? 0, cached: u.cachedContentTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
}

export class GeminiProvider implements LlmProvider {
  readonly id = "gemini" as const;
  lastUsage?: LlmUsage;
  get lite(): boolean {
    return /lite/i.test(this.model);
  }
  constructor(
    private key: string,
    readonly model: string,
    private fetchFn: Fetch = realFetch,
    private timeoutMs = 20000,
  ) {}

  private headers(): HeadersInit {
    return { "content-type": "application/json", "x-goog-api-key": this.key.trim() };
  }

  async complete(req: LlmRequest): Promise<unknown> {
    const model = this.model.replace(/^models\//, "");
    const thinking = thinkingFor(model);
    const body = (withThinking: boolean) => ({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: req.schema,
        temperature: 0.9,
        maxOutputTokens: req.maxTokens ?? 2048,
        ...(withThinking && thinking ? { thinkingConfig: thinking } : {}),
      },
    });
    return withTimeout(this.timeoutMs, async (signal) => {
      const send = (withThinking: boolean) =>
        this.fetchFn(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body(withThinking)),
          signal,
        });
      let res = await send(true);
      let text = await res.text();
      // The model does not know this thinking setting: once more without it.
      if (res.status === 400 && thinking && /think/i.test(text)) {
        res = await send(false);
        text = await res.text();
      }
      if (!res.ok) throw httpError(res.status, text);
      const data = JSON.parse(text) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; usageMetadata?: Parameters<typeof geminiUsage>[0] };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const out = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
      this.lastUsage = geminiUsage(data.usageMetadata);
      if (!out) throw new LlmError("bad_json", "Leere Antwort.");
      return parseJson(out);
    });
  }

  /** Models this key may use for text generation (for the settings page). */
  async listModels(): Promise<string[]> {
    return withTimeout(this.timeoutMs, async (signal) => {
      const res = await this.fetchFn(`${GEMINI}/models?pageSize=200`, { headers: this.headers(), signal });
      const text = await res.text();
      if (!res.ok) throw httpError(res.status, text);
      const data = JSON.parse(text) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      return (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/i.test(m.name))
        .map((m) => m.name.replace(/^models\//, ""));
    });
  }
}

/**
 * The AI on the server (Supabase Edge Function "dm", see supabase/functions/dm). The Gemini key
 * lives there as a secret; the TV only sends the prompt. The function also does the Flash-Lite fallback.
 */
/**
 * Little thinking: newer Gemini models think before answering, which costs like answer tokens
 * and makes the game master slower – for telling a story it hardly helps. Gemini 3 and the
 * "-latest" aliases take a level, 2.5 Flash/Flash-Lite a budget (0 = off; Pro needs at least 128),
 * older models none. A model that does not understand it gets the request again without it.
 */
export function thinkingFor(model: string): Record<string, unknown> | undefined {
  const m = model.toLowerCase();
  if (/gemini-(1\.|2\.0)/.test(m)) return undefined;
  if (/gemini-2\.5-pro/.test(m)) return { thinkingBudget: 128 };
  if (/gemini-2\.5/.test(m)) return { thinkingBudget: 0 };
  if (/gemini/.test(m)) return { thinkingLevel: "low" };
  return undefined;
}

export class ServerProvider implements LlmProvider {
  readonly id = "server" as const;
  readonly model = "server";
  lastUsage?: LlmUsage;
  constructor(
    private url: string,
    private anonKey: string,
    private room: string,
    private fetchFn: Fetch = realFetch,
    private timeoutMs = 25000,
  ) {}

  private async call(body: Record<string, unknown>, signal: AbortSignal): Promise<{ ok?: boolean; text?: string; configured?: boolean; error?: string; usage?: LlmUsage }> {
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: this.anonKey, authorization: `Bearer ${this.anonKey}` },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    let data: { ok?: boolean; text?: string; configured?: boolean; error?: string; usage?: LlmUsage } = {};
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON (gateway error)
    }
    if (res.ok) return data;
    if (res.status === 429 || data.error === "limit") throw new LlmError("limit", "Das KI-Limit ist gerade erreicht.");
    if (data.error === "not_configured") throw new LlmError("auth", "Auf dem Server ist noch kein Gemini-Schlüssel hinterlegt.");
    if (data.error === "auth") throw new LlmError("auth", "Der Gemini-Schlüssel auf dem Server wurde abgelehnt.");
    if (res.status === 401 || res.status === 403) throw new LlmError("auth", "Der Server hat die Anfrage abgelehnt.");
    throw new LlmError("other", "Der KI-Server hat gerade Probleme.");
  }

  async complete(req: LlmRequest): Promise<unknown> {
    return withTimeout(this.timeoutMs, async (signal) => {
      const data = await this.call({ mode: "complete", room: this.room, system: req.system, prompt: req.prompt, schema: req.schema, maxTokens: req.maxTokens ?? 2048, ...(req.tier ? { tier: req.tier } : {}) }, signal);
      this.lastUsage = data.usage;
      if (!data.text) throw new LlmError("bad_json", "Leere Antwort.");
      return parseJson(data.text);
    });
  }

  /** Is the function reachable, and is a key stored there? */
  async ping(): Promise<boolean> {
    return withTimeout(this.timeoutMs, async (signal) => !!(await this.call({ mode: "ping" }, signal)).configured);
  }
}

/** Groq (OpenAI-compatible, also has a free tier) as a stand-in when Gemini is at its limit. */
export class GroqProvider implements LlmProvider {
  readonly id = "groq" as const;
  lastUsage?: LlmUsage;
  get lite(): boolean {
    return /instant|8b/i.test(this.model);
  }
  constructor(
    private key: string,
    readonly model: string,
    private fetchFn: Fetch = realFetch,
    private timeoutMs = 20000,
  ) {}

  async complete(req: LlmRequest): Promise<unknown> {
    return withTimeout(this.timeoutMs, async (signal) => {
      const res = await this.fetchFn("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.key.trim()}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.9,
          max_tokens: req.maxTokens ?? 1024,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${req.system}\n\nAntworte nur mit JSON nach diesem Schema:\n${JSON.stringify(req.schema)}` },
            { role: "user", content: req.prompt },
          ],
        }),
        signal,
      });
      const text = await res.text();
      if (!res.ok) throw httpError(res.status, text);
      const data = JSON.parse(text) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } };
      if (data.usage) this.lastUsage = { input: data.usage.prompt_tokens ?? 0, cached: data.usage.prompt_tokens_details?.cached_tokens ?? 0, output: data.usage.completion_tokens ?? 0 };
      const out = data.choices?.[0]?.message?.content;
      if (!out) throw new LlmError("bad_json", "Leere Antwort.");
      return parseJson(out);
    });
  }

  async listModels(): Promise<string[]> {
    return withTimeout(this.timeoutMs, async (signal) => {
      const res = await this.fetchFn("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${this.key.trim()}` }, signal });
      const text = await res.text();
      if (!res.ok) throw httpError(res.status, text);
      return ((JSON.parse(text) as { data?: { id: string }[] }).data ?? []).map((m) => m.id);
    });
  }
}
