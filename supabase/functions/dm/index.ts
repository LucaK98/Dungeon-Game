/**
 * Edge Function "dm": the AI game master on the server. The TV sends the prompt, this function
 * calls Gemini with the key stored as a Supabase secret (never in the browser or the repo).
 *
 * Secrets (Supabase dashboard → Edge Functions → Secrets):
 *   GEMINI_API_KEY        required (format "AQ.…" or "AIza…", sent as header x-goog-api-key)
 *   GEMINI_MODEL          optional, default "gemini-flash-latest"
 *   GEMINI_FALLBACK_MODEL optional, default "gemini-flash-lite-latest" (used on rate limits)
 *
 * Small tasks (body.tier = "lite": ideas, rules questions, hints) go to the fallback model first –
 * it is cheaper and good enough for them. Every answer reports its tokens (usage) for the TV's counter.
 *
 * Protection against misuse (the function is reachable with the public anon key):
 * allowed origins, size limits, a small rate limit per room and per instance.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ORIGINS = [/^https:\/\/lucak98\.github\.io$/i, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/, /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/];
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const PER_ROOM = { max: 60, windowMs: 10 * 60_000 };
const PER_INSTANCE = { max: 600, windowMs: 60 * 60_000 };

const calls = new Map<string, number[]>();

function allowed(key: string, limit: { max: number; windowMs: number }): boolean {
  const now = Date.now();
  const list = (calls.get(key) ?? []).filter((t) => now - t < limit.windowMs);
  if (list.length >= limit.max) {
    calls.set(key, list);
    return false;
  }
  list.push(now);
  calls.set(key, list);
  return true;
}

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ORIGINS.some((r) => r.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://lucak98.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function reply(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

/**
 * Little thinking: newer Gemini models think before answering, which costs like answer tokens
 * and makes the game master slower – for telling a story it hardly helps. Gemini 3 and the
 * "-latest" aliases take a level, 2.5 Flash/Flash-Lite a budget (0 = off; Pro needs at least 128),
 * older models none. A model that does not understand it gets the request again without it.
 */
function thinkingFor(model: string): Record<string, unknown> | undefined {
  const m = model.toLowerCase();
  if (/gemini-(1\.|2\.0)/.test(m)) return undefined;
  if (/gemini-2\.5-pro/.test(m)) return { thinkingBudget: 128 };
  if (/gemini-2\.5/.test(m)) return { thinkingBudget: 0 };
  if (/gemini/.test(m)) return { thinkingLevel: "low" };
  return undefined;
}

async function gemini(key: string, model: string, body: { system: string; prompt: string; schema: unknown; maxTokens: number }) {
  const thinking = thinkingFor(model);
  const send = (withThinking: boolean) =>
    fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: body.system }] },
        contents: [{ role: "user", parts: [{ text: body.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: body.schema,
          temperature: 0.9,
          maxOutputTokens: body.maxTokens,
          ...(withThinking && thinking ? { thinkingConfig: thinking } : {}),
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  let res = await send(true);
  let text = await res.text();
  // The model does not know this thinking setting: once more without it.
  if (res.status === 400 && thinking && /think/i.test(text)) {
    res = await send(false);
    text = await res.text();
  }
  if (!res.ok) return { status: res.status, error: text.slice(0, 300) };
  const data = JSON.parse(text) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const out = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  const u = data.usageMetadata;
  const usage = u ? { input: u.promptTokenCount ?? 0, cached: u.cachedContentTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } : undefined;
  return { status: 200, text: out, usage };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "method" }, 405, headers);
  if (origin && !ORIGINS.some((r) => r.test(origin))) return reply({ error: "origin" }, 403, headers);

  let body: { mode?: string; room?: string; system?: string; prompt?: string; schema?: unknown; maxTokens?: number; tier?: string };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "bad_request" }, 400, headers);
  }
  const key = Deno.env.get("GEMINI_API_KEY")?.trim();
  if (body.mode === "ping") return reply({ ok: true, configured: !!key }, 200, headers);
  if (!key) return reply({ error: "not_configured" }, 503, headers);

  const system = String(body.system ?? "").slice(0, 8000);
  const prompt = String(body.prompt ?? "").slice(0, 16000);
  if (!prompt || typeof body.schema !== "object") return reply({ error: "bad_request" }, 400, headers);
  const room = String(body.room ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "none";
  if (!allowed(`room:${room}`, PER_ROOM) || !allowed("instance", PER_INSTANCE)) return reply({ error: "limit" }, 429, headers);

  const maxTokens = Math.min(Math.max(Number(body.maxTokens) || 2048, 128), 4096);
  const main = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
  const small = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-flash-lite-latest";
  const models = body.tier === "lite" ? [small, main] : [main, small];
  let last = { status: 500, error: "no_model" } as { status: number; error?: string; text?: string; usage?: unknown };
  for (const model of models) {
    try {
      last = await gemini(key, model, { system, prompt, schema: body.schema, maxTokens });
    } catch (err) {
      last = { status: 504, error: String(err).slice(0, 200) };
    }
    if (last.status === 200) return reply({ ok: true, model, text: last.text, ...(last.usage ? { usage: last.usage } : {}) }, 200, headers);
    if (last.status !== 429 && last.status < 500) break; // wrong key or bad request: no point in the fallback
  }
  const status = last.status === 429 ? 429 : last.status === 401 || last.status === 403 ? 502 : last.status >= 500 ? 502 : 400;
  return reply({ error: last.status === 429 ? "limit" : last.status === 401 || last.status === 403 ? "auth" : "upstream", detail: last.error }, status, headers);
});
