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

const KEY = "couch-dungeon.speech";
const ENGINE_KEY = "couch-dungeon.voice-engine";

export type VoiceEngine = "natural" | "browser";

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
    return localStorage.getItem(ENGINE_KEY) === "browser" ? "browser" : "natural";
  } catch {
    return "natural";
  }
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
    u.rate = rate;
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
    setTimeout(finish, 2500 + text.length * 90);
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
  const voice = neuralVoice(name);
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
    if (voiceEngine() === "natural" && (await speakNatural(clean, speaker, gen))) return;
    if (gen !== generation) return;
    await speakBrowser(clean, speaker);
  } finally {
    if (gen === generation) duckMusic(false);
  }
}

/** Loads the natural voices early (when a game starts): narrator first, then the characters. */
export function warmUpVoices(): void {
  if (!speechEnabled() || voiceEngine() !== "natural") return;
  void prepareVoice(undefined).then((ok) => {
    if (ok) void prepareVoice("Frau Holle").then(() => prepareVoice("Hans"));
  });
}
