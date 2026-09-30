/**
 * AI settings of this TV. Stored only in this device's localStorage – never in the repo,
 * never sent to phones. "Nur auf eigenen Geräten verwenden."
 */
import { DM_FUNCTION_URL, SUPABASE_ANON_JWT } from "../../net/supabase";
import { aiBlocked, GeminiProvider, GroqProvider, ServerProvider, type LlmProvider, type ProviderId } from "./provider";

export interface AiSettings {
  /** "off" = scripted narrator only. */
  provider: ProviderId | "off";
  keys: Partial<Record<ProviderId, string>>;
  models: Record<ProviderId, string>;
  /** Used when the main model hits its limit (Gemini: Flash-Lite). */
  fallbackModels: Record<ProviderId, string>;
  /** A Gemini key of this TV that steps in when the server's free quota is used up (stored only here). */
  backupKey?: string;
  /** Version 2: the server AI is the standard; "off" and own keys are a choice made on purpose. */
  v?: 2;
}

const KEY = "couch-dungeon.ai";
const CALLS = "couch-dungeon.aiCalls";

/** By default the game master runs on the server (its key never reaches the browser); models changeable in the settings. */
export const DEFAULT_SETTINGS: AiSettings = {
  provider: "server",
  keys: {},
  models: { gemini: "gemini-flash-latest", groq: "llama-3.3-70b-versatile", server: "server" },
  fallbackModels: { gemini: "gemini-flash-lite-latest", groq: "llama-3.1-8b-instant", server: "" },
};

function storage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw) as Partial<AiSettings>;
    return {
      // Settings from before version 2 start on the server AI (stored keys stay, one tap away).
      provider: s.v === 2 ? (s.provider ?? "server") : "server",
      keys: s.keys ?? {},
      models: { ...DEFAULT_SETTINGS.models, ...s.models },
      fallbackModels: { ...DEFAULT_SETTINGS.fallbackModels, ...s.fallbackModels },
      ...(s.backupKey?.trim() ? { backupKey: s.backupKey.trim() } : {}),
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveAiSettings(s: AiSettings): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ ...s, v: 2 }));
  } catch {
    // Storage blocked: settings last for this page only.
  }
}

/** Main and fallback provider for the current settings, or undefined if the AI is off / has no key. */
export function providersFrom(s: AiSettings, room = ""): LlmProvider[] | undefined {
  // (Unit tests may build providers – their network is blocked in the providers themselves.)
  if (s.provider === "off" || aiBlocked(false)) return undefined;
  // The server holds the key itself and does the fallback model.
  if (s.provider === "server") {
    // When the server's quota is used up, this TV's backup key takes over (main model, then Flash-Lite).
    const backup = s.backupKey?.trim();
    return [
      new ServerProvider(DM_FUNCTION_URL, SUPABASE_ANON_JWT, room),
      ...(backup ? [new GeminiProvider(backup, s.models.gemini), new GeminiProvider(backup, s.fallbackModels.gemini)] : []),
    ];
  }
  const key = s.keys[s.provider]?.trim();
  if (!key) return undefined;
  const make = (model: string) => (s.provider === "gemini" ? new GeminiProvider(key, model) : new GroqProvider(key, model));
  const list = [make(s.models[s.provider])];
  const fb = s.fallbackModels[s.provider];
  if (fb && fb !== s.models[s.provider]) list.push(make(fb));
  return list;
}

const today = () => new Date().toISOString().slice(0, 10);

export function aiCallsToday(): number {
  try {
    const c = JSON.parse(storage()?.getItem(CALLS) ?? "null") as { date: string; count: number } | null;
    return c && c.date === today() ? c.count : 0;
  } catch {
    return 0;
  }
}

export function countAiCall(): void {
  try {
    storage()?.setItem(CALLS, JSON.stringify({ date: today(), count: aiCallsToday() + 1 }));
  } catch {
    // ignore
  }
}
