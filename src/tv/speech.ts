/**
 * Reading the narration aloud, with a voice per character.
 *
 * Two engines:
 * - "natural": Piper neural voices in the browser (free, downloaded once, see voice/piper.ts);
 * - "browser": the best German voice the browser has (Edge "Natural" voices, Google, …),
 *   with its own pitch and tempo per character.
 * If a natural voice is not ready yet (still downloading) or fails, the browser voice speaks.
 */
import { duckMusic } from "../ui/music";
import { browserStyle, neuralVoice, speakable, sentences, voiceIsFemale, voiceScore } from "./voice/cast";
import { GEMINI_SAMPLE_RATE, geminiSpeech, TtsError } from "./voice/gemini-tts";
import { loadAiSettings } from "../dm/ai/settings";

const KEY = "couch-dungeon.speech";
const ENGINE_KEY = "couch-dungeon.voice-engine";

export type VoiceEngine = "storyteller" | "natural" | "browser";

/** New key: the default got faster, earlier choices start again from the new default. */
const RATE_KEY = "couch-dungeon.speech-rate2";
/** Standard tempo (1 = how the voices speak by themselves, which felt too slow). */
export const DEFAULT_SPEECH_RATE = 1.2;

/** How fast the voices speak (setting): 1 slow … 1.6 very fast. */
export function speechRate(): number {
  try {
    const v = Number(localStorage.getItem(RATE_KEY));
    return v >= 0.6 && v <= 1.8 ? v : DEFAULT_SPEECH_RATE;
  } catch {
    return DEFAULT_SPEECH_RATE;
  }
}

export function setSpeechRate(rate: number): void {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    // ignore
  }
}

export function speechEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSpeechEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
  if (!on) stopSpeaking();
}

export function voiceEngine(): VoiceEngine {
  try {
    const v = localStorage.getItem(ENGINE_KEY);
    if (v === "browser" || v === "natural" || v === "storyteller") return v;
    // Not chosen yet: the storyteller if there is a Gemini key on this TV.
    return geminiKey() ? "storyteller" : "natural";
  } catch {
    return "natural";
  }
}

/** The Gemini key typed in on this TV (for the storyteller voice). */
export function geminiKey(): string | undefined {
  return loadAiSettings().keys.gemini?.trim() || undefined;
}

export function setVoiceEngine(engine: VoiceEngine): void {
  try {
    localStorage.setItem(ENGINE_KEY, engine);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------- browser voices

function germanVoices(): SpeechSynthesisVoice[] {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return voices.filter((v) => voiceScore(v) > 0).sort((a, b) => voiceScore(b) - voiceScore(a));
}

/** The best voice for a speaker among the installed ones (different characters, different voices). */
function browserVoice(name?: string): { voice?: SpeechSynthesisVoice; pitch: number; rate: number } {
  const style = browserStyle(name);
  const all = germanVoices();
  const best = all[0];
  if (!best) return style;
  const topScore = voiceScore(best);
  // Only voices about as good as the best one: never swap a natural voice for a robotic one.
  const good = all.filter((v) => voiceScore(v) >= topScore - 2);
  if (style.kind === "narrator") return { voice: best, pitch: style.pitch, rate: style.rate };
  const wantFemale = style.kind === "female" || style.kind === "child";
  const fitting = good.filter((v) => voiceIsFemale(v.name) === wantFemale);
  const pool = fitting.length ? fitting : good;
  // The narrator's voice only if nothing else fits.
  const others = pool.length > 1 ? pool.filter((v) => v !== best) : pool;
  const voice = others[style.pick % others.length];
  // A matching voice needs less pitch bending (sounds more natural).
  const bend = fitting.length && style.kind !== "monster" && style.kind !== "ghost" ? 0.5 : 1;
  return { ...(voice ? { voice } : {}), pitch: 1 + (style.pitch - 1) * bend, rate: style.rate };
}

function speakBrowser(text: string, name?: string): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    const { voice, pitch, rate } = browserVoice(name);
    if (voice) u.voice = voice;
    u.pitch = pitch;
    u.rate = rate * speechRate();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
    // Some browsers never fire onend: don't block the story.
    setTimeout(finish, 2500 + (text.length * 90) / speechRate());
  });
}

// ---------------------------------------------------------------- natural voices

let audio: AudioContext | undefined;
let current: AudioBufferSourceNode | undefined;
let generation = 0;
/** Voices that failed to load: don't try again this session. */
const broken = new Set<string>();
/** Voices still downloading: the browser voice speaks meanwhile. */
const loading = new Set<string>();
const ready = new Set<string>();

function context(): AudioContext | undefined {
  if (!audio) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;
    audio = new Ctor();
  }
  if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  return audio;
}

function play(ctx: AudioContext, pcm: Float32Array, sampleRate: number): Promise<void> {
  return new Promise((resolve) => {
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    buffer.getChannelData(0).set(pcm);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain).connect(ctx.destination);
    current = src;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (current === src) current = undefined;
      resolve();
    };
    src.onended = finish;
    src.start();
    setTimeout(finish, (pcm.length / sampleRate) * 1000 + 1500);
  });
}

/** Downloads a voice (once) and gets it ready. Resolves whether it worked. */
export function prepareVoice(name?: string, progress?: (loaded: number, total: number) => void): Promise<boolean> {
  const model = neuralVoice(name).model;
  if (ready.has(model)) return Promise.resolve(true);
  // Asked for on purpose (with progress, from the settings): try again even after a failure.
  if (progress) broken.delete(model);
  if (broken.has(model)) return Promise.resolve(false);
  loading.add(model);
  return import("./voice/piper")
    .then((p) => p.loadModel(model, progress))
    .then(() => {
      ready.add(model);
      return true;
    })
    .catch(() => {
      broken.add(model);
      return false;
    })
    .finally(() => loading.delete(model));
}

async function speakNatural(text: string, name: string | undefined, gen: number): Promise<boolean> {
  const base = neuralVoice(name);
  // Faster speech = shorter sounds (the pitch stays the same).
  const voice = { ...base, lengthScale: base.lengthScale / speechRate() };
  if (broken.has(voice.model)) return false;
  if (!ready.has(voice.model)) {
    // First use: download in the background, the browser voice speaks this line.
    if (!loading.has(voice.model)) void prepareVoice(name);
    return false;
  }
  const ctx = context();
  if (!ctx) return false;
  try {
    const { synthesize } = await import("./voice/piper");
    // Sentence by sentence: the next one is computed while the current one plays.
    const parts = sentences(text);
    let next = synthesize(parts[0]!, voice);
    for (let i = 0; i < parts.length; i++) {
      const { pcm, sampleRate } = await next;
      if (gen !== generation) return true;
      if (i + 1 < parts.length) next = synthesize(parts[i + 1]!, voice);
      await play(ctx, pcm, sampleRate);
      if (gen !== generation) return true;
    }
    return true;
  } catch {
    broken.add(voice.model);
    return false;
  }
}

// ---------------------------------------------------------------- the storyteller (Gemini)

/** After a limit or error, the storyteller rests a while (the other voices speak meanwhile). */
let storytellerPausedUntil = 0;
export let storytellerProblem: string | undefined;

async function speakStoryteller(text: string, name: string | undefined, gen: number): Promise<boolean> {
  const key = geminiKey();
  if (!key || Date.now() < storytellerPausedUntil) return false;
  const ctx = context();
  if (!ctx) return false;
  try {
    const pcm = await geminiSpeech(key, text, name, undefined, speechRate());
    if (gen !== generation) return true;
    await play(ctx, pcm, GEMINI_SAMPLE_RATE);
    storytellerProblem = undefined;
    return true;
  } catch (err) {
    const status = err instanceof TtsError ? err.status : 0;
    storytellerProblem = status === 429 ? "Gratis-Limit der Erzählerstimme erreicht – kurz spricht die Ersatzstimme." : status === 401 || status === 403 ? "Der Gemini-Schlüssel wurde abgelehnt." : status === 404 ? "Das Stimm-Modell gibt es nicht (mehr)." : "Die Erzählerstimme ist gerade nicht erreichbar.";
    storytellerPausedUntil = Date.now() + (status === 429 ? 60_000 : status === 401 || status === 403 || status === 404 ? 3_600_000 : 20_000);
    return false;
  }
}

/** Fetches the storyteller audio for a line that comes next (so it plays without waiting). */
export function prefetchSpeech(text: string, speaker?: string): void {
  if (!speechEnabled() || voiceEngine() !== "storyteller" || Date.now() < storytellerPausedUntil) return;
  const key = geminiKey();
  const clean = speakable(text);
  if (key && clean) void geminiSpeech(key, clean, speaker, undefined, speechRate()).catch(() => undefined);
}

// ---------------------------------------------------------------- public

/** Stops whatever is being said (skip). */
export function stopSpeaking(): void {
  generation++;
  window.speechSynthesis?.cancel();
  try {
    current?.stop();
  } catch {
    // already stopped
  }
  current = undefined;
}

/**
 * Speaks a line; resolves when done (or right away if speech is off).
 * `speaker`: the character's name, or undefined for the narrator.
 */
export async function speak(text: string, speaker?: string): Promise<void> {
  if (!speechEnabled()) return;
  const clean = speakable(text);
  if (!clean) return;
  const gen = ++generation;
  duckMusic(true);
  try {
    const engine = voiceEngine();
    if (engine === "storyteller" && (await speakStoryteller(clean, speaker, gen))) return;
    if (gen !== generation) return;
    if (engine !== "browser" && (await speakNatural(clean, speaker, gen))) return;
    if (gen !== generation) return;
    await speakBrowser(clean, speaker);
  } finally {
    if (gen === generation) duckMusic(false);
  }
}

/** Loads the natural voices early (when a game starts): narrator first, then the characters. */
export function warmUpVoices(): void {
  // The Piper voices are also the storyteller's stand-in (limits, no internet).
  if (!speechEnabled() || voiceEngine() === "browser") return;
  void prepareVoice(undefined).then((ok) => {
    if (ok) void prepareVoice("Frau Holle").then(() => prepareVoice("Hans"));
  });
}
