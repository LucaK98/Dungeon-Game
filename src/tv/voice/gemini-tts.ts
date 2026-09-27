/**
 * The storyteller voice: Gemini text-to-speech with a spoken style instruction
 * ("a warm, deep voice like an old storyteller by the fire"). Uses the Gemini key typed in on this TV
 * (sent only to Google, in the header `x-goog-api-key`). Returns raw audio (16-bit PCM, 24 kHz, mono).
 * Lines are cached, so a repeated line costs nothing, and the next lines can be fetched while one plays.
 */
import { hash, kindOf, type Kind } from "./cast";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
export const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const SAMPLE_RATE = 24000;

/** Gemini's prebuilt voices by kind of speaker (they speak German well). */
const VOICES: Record<Kind, string[]> = {
  narrator: ["Gacrux"],
  male: ["Orus", "Iapetus", "Umbriel", "Charon", "Sadaltager", "Alnilam"],
  female: ["Sulafat", "Vindemiatrix", "Achernar", "Despina", "Aoede"],
  child: ["Leda", "Puck"],
  monster: ["Algenib"],
  ghost: ["Enceladus"],
};

const STYLE: Record<Kind, string> = {
  narrator:
    "Du bist ein erfahrener Märchenerzähler, der am Lagerfeuer eine Heldengeschichte erzählt. Lies den folgenden deutschen Text vor: mit warmer, tiefer, ruhiger Stimme, bildhaft und spannend, mit kleinen dramatischen Pausen und leiser werdend bei unheimlichen Stellen. Lies nur den Text vor, ohne etwas hinzuzufügen.",
  male: "Sprich den folgenden deutschen Satz als Figur in einem Fantasy-Abenteuer, lebendig und natürlich, wie ein Schauspieler im Hörspiel. Lies nur den Text vor.",
  female: "Sprich den folgenden deutschen Satz als Frau in einem Fantasy-Abenteuer, lebendig und natürlich, wie eine Schauspielerin im Hörspiel. Lies nur den Text vor.",
  child: "Sprich den folgenden deutschen Satz als aufgewecktes Kind in einem Märchen, hell und neugierig. Lies nur den Text vor.",
  monster: "Sprich den folgenden deutschen Satz als grollendes, bedrohliches Ungeheuer in einem Märchen: tief, rau, langsam und gefährlich. Lies nur den Text vor.",
  ghost: "Flüstere den folgenden deutschen Satz als unheimlicher Geist in einem Märchen: hauchend, langsam und schaurig. Lies nur den Text vor.",
};

export function geminiVoiceFor(name?: string): { voice: string; style: string } {
  const kind = kindOf(name);
  const list = VOICES[kind];
  return { voice: list[(name ? hash(name) : 0) % list.length]!, style: STYLE[kind] };
}

export class TtsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const cache = new Map<string, Promise<Float32Array>>();

/** Audio for a line (from the cache when it was asked for before). */
export function geminiSpeech(key: string, text: string, speaker?: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<Float32Array> {
  const { voice, style } = geminiVoiceFor(speaker);
  const id = `${voice}|${text}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const job = request(key, text, voice, style, fetchFn);
  cache.set(id, job);
  // Failed requests are not kept (they may work later).
  job.catch(() => cache.delete(id));
  // Keep the cache small.
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  return job;
}

async function request(key: string, text: string, voice: string, style: string, fetchFn: typeof fetch): Promise<Float32Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetchFn(`${GEMINI}/models/${TTS_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key.trim() },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${style}\n\n${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new TtsError(res.status, (await res.text()).slice(0, 200));
    const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
    const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!b64) throw new TtsError(0, "Keine Audiodaten.");
    return pcm16ToFloat(b64);
  } finally {
    clearTimeout(timer);
  }
}

/** Base64 16-bit little-endian PCM → floats for the Web Audio API. */
export function pcm16ToFloat(b64: string): Float32Array {
  const bin = atob(b64);
  const n = Math.floor(bin.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

export const GEMINI_SAMPLE_RATE = SAMPLE_RATE;
