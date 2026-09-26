/**
 * AI settings of this TV. Stored only in this device's localStorage – never in the repo,
 * never sent to phones. "Nur auf eigenen Geräten verwenden."
 */
import { GeminiProvider, GroqProvider, type LlmProvider, type ProviderId } from "./provider";

export interface AiSettings {
  /** "off" = scripted narrator only. */
  provider: ProviderId | "off";
  keys: Partial<Record<ProviderId, string>>;
  models: Record<ProviderId, string>;
  /** Used when the main model hits its limit (Gemini: Flash-Lite). */
  fallbackModels: Record<ProviderId, string>;
}

const KEY = "couch-dungeon.ai";
const CALLS = "couch-dungeon.aiCalls";

/** Aliases that follow Google's current free Flash models; changeable in the settings. */
export const DEFAULT_SETTINGS: AiSettings = {
  provider: "off",
  keys: {},
  models: { gemini: "gemini-flash-latest", groq: "llama-3.3-70b-versatile" },
  fallbackModels: { gemini: "gemini-flash-lite-latest", groq: "llama-3.1-8b-instant" },
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
      provider: s.provider ?? "off",
      keys: s.keys ?? {},
      models: { ...DEFAULT_SETTINGS.models, ...s.models },
      fallbackModels: { ...DEFAULT_SETTINGS.fallbackModels, ...s.fallbackModels },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveAiSettings(s: AiSettings): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: settings last for this page only.
  }
}

/** Main and fallback provider for the current settings, or undefined if the AI is off / has no key. */
export function providersFrom(s: AiSettings): LlmProvider[] | undefined {
  if (s.provider === "off") return undefined;
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
