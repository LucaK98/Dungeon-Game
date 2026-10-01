/**
 * Background music, composed and played live with the Web Audio API (no files, no licences).
 *
 * Every mood has its key, tempo, chord progression and instruments; the melody is made from a
 * few short motifs that repeat and vary (A A B A), so it sounds like a tune and not like noise.
 * Moods cross-fade; while the narrator speaks, the music gets quieter.
 */

export type Mood = "wild" | "halls" | "town" | "night" | "fight" | "boss" | "silent";

const KEY = "couch-dungeon.music";

export function musicEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setMusicEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
  if (!on) stopMusic();
  else if (wanted) setMood(wanted);
}

interface Style {
  bpm: number;
  /** Root note (MIDI). */
  root: number;
  /** Scale steps (semitones from the root). */
  scale: number[];
  /** Chords as scale degrees (0-based), one per bar. */
  chords: number[];
  lead: "flute" | "bell" | "pluck" | "strings" | "brass" | "none";
  bass: "drone" | "walk" | "ostinato" | "pulse";
  drums: "none" | "soft" | "march" | "battle";
  /** How busy the melody is (0…1). */
  density: number;
  volume: number;
}

const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];

const STYLES: Record<Exclude<Mood, "silent">, Style> = {
  wild: { bpm: 84, root: 50, scale: DORIAN, chords: [0, 6, 3, 4], lead: "flute", bass: "drone", drums: "none", density: 0.45, volume: 0.5 },
  halls: { bpm: 72, root: 45, scale: MINOR, chords: [0, 5, 3, 4], lead: "strings", bass: "drone", drums: "none", density: 0.35, volume: 0.45 },
  town: { bpm: 108, root: 55, scale: MAJOR, chords: [0, 3, 4, 0], lead: "pluck", bass: "walk", drums: "soft", density: 0.6, volume: 0.45 },
  night: { bpm: 64, root: 45, scale: PHRYGIAN, chords: [0, 1, 0, 6], lead: "bell", bass: "drone", drums: "none", density: 0.25, volume: 0.45 },
  fight: { bpm: 138, root: 40, scale: HARMONIC, chords: [0, 5, 6, 4], lead: "strings", bass: "ostinato", drums: "battle", density: 0.55, volume: 0.5 },
  boss: { bpm: 120, root: 38, scale: PHRYGIAN, chords: [0, 1, 5, 4], lead: "brass", bass: "pulse", drums: "battle", density: 0.4, volume: 0.55 },
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Small seeded random numbers: the same mood always starts with the same tune. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One bar of melody: 16 sixteenth steps, each a scale degree or null (rest). */
export type Motif = (number | null)[];

/** Makes a few motifs for a style; a phrase plays them as A A B A. */
export function composeMotifs(style: Style, seed: number): Motif[] {
  const r = rng(seed);
  const motifs: Motif[] = [];
  for (let m = 0; m < 3; m++) {
    const bar: Motif = Array<number | null>(16).fill(null);
    let degree = Math.floor(r() * 5);
    for (let step = 0; step < 16; step += r() < 0.3 ? 4 : 2) {
      // Notes land more often on the strong beats.
      const strong = step % 4 === 0;
      if (r() < style.density + (strong ? 0.25 : -0.1)) {
        degree = Math.max(-2, Math.min(9, degree + [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)]!));
        bar[step] = degree;
      }
    }
    if (!bar.some((n) => n !== null)) bar[0] = 0;
    motifs.push(bar);
  }
  return motifs;
}

// ---------------------------------------------------------------- engine

let ctx: AudioContext | undefined;
let out: GainNode | undefined;
let noise: AudioBuffer | undefined;
let wanted: Mood | undefined;
let playing: { mood: Mood; gain: GainNode; timer: ReturnType<typeof setInterval> } | undefined;
let duck = 1;

function audio(): AudioContext | undefined {
  if (!musicEnabled()) return undefined;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;
    ctx = new Ctor();
    out = ctx.createGain();
    out.gain.value = 0.16;
    out.connect(ctx.destination);
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx.state === "running" ? ctx : undefined;
}

function voice(a: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, kind: Style["lead"] | "bass" | "pad", vol: number): void {
  const g = a.createGain();
  const o = a.createOscillator();
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  let attack = 0.01;
  let release = dur;
  switch (kind) {
    case "flute":
      o.type = "sine";
      attack = 0.06;
      f.frequency.value = 3000;
      // Gentle vibrato.
      {
        const lfo = a.createOscillator();
        const lg = a.createGain();
        lfo.frequency.value = 5.5;
        lg.gain.value = freq * 0.006;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.1);
      }
      break;
    case "bell":
      o.type = "sine";
      release = dur * 2.5;
      f.frequency.value = 5000;
      break;
    case "pluck":
      o.type = "triangle";
      release = Math.min(dur, 0.35);
      f.frequency.value = 2400;
      break;
    case "strings":
      o.type = "sawtooth";
      attack = 0.04;
      f.frequency.value = 1400;
      break;
    case "brass":
      o.type = "sawtooth";
      attack = 0.05;
      f.frequency.setValueAtTime(500, t);
      f.frequency.linearRampToValueAtTime(1500, t + 0.12);
      break;
    case "bass":
      o.type = "triangle";
      f.frequency.value = 600;
      break;
    case "pad":
      o.type = "sine";
      attack = 0.6;
      f.frequency.value = 1200;
      break;
    default:
      return;
  }
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.02, release));
  o.connect(f).connect(g).connect(dest);
  o.start(t);
  o.stop(t + release + 0.1);
}

function drum(a: AudioContext, dest: AudioNode, t: number, kind: "kick" | "snare" | "hat" | "tom", vol: number): void {
  if (kind === "kick" || kind === "tom") {
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.setValueAtTime(kind === "kick" ? 120 : 180, t);
    o.frequency.exponentialRampToValueAtTime(kind === "kick" ? 40 : 90, t + 0.15);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.3);
    return;
  }
  const src = a.createBufferSource();
  src.buffer = noise!;
  const f = a.createBiquadFilter();
  f.type = kind === "hat" ? "highpass" : "bandpass";
  f.frequency.value = kind === "hat" ? 7000 : 1800;
  const g = a.createGain();
  g.gain.setValueAtTime(vol * (kind === "hat" ? 0.35 : 0.7), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "hat" ? 0.04 : 0.16));
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5, 0.2);
}

function start(mood: Exclude<Mood, "silent">): void {
  const a = audio();
  if (!a || !out) return;
  const style = STYLES[mood];
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, a.currentTime);
  // Comes up slowly while the old music fades out underneath (a soft cross-fade, no hard cut).
  gain.gain.exponentialRampToValueAtTime(style.volume * duck, a.currentTime + 3);
  gain.connect(out);
  const stepDur = 60 / style.bpm / 4;
  let seed = mood.length * 97 + 11;
  let motifs = composeMotifs(style, seed);
  let step = 0;
  let next = a.currentTime + 0.1;
  const note = (degree: number, octave = 0) => {
    const n = style.scale.length;
    const oct = Math.floor(degree / n);
    const idx = ((degree % n) + n) % n;
    return style.root + 12 * (oct + octave) + style.scale[idx]!;
  };
  const schedule = () => {
    while (next < a.currentTime + 0.35) {
      const bar = Math.floor(step / 16);
      const inBar = step % 16;
      const chord = style.chords[bar % style.chords.length]!;
      const phrase = Math.floor(bar / 4);
      // A A B A, then new motifs every few phrases.
      const which = [0, 0, 1, 0][bar % 4]!;
      if (inBar === 0 && bar % 16 === 0 && bar > 0) motifs = composeMotifs(style, ++seed);
      const motif = motifs[phrase % 5 === 4 ? 2 : which]!;
      // Pad: the chord, held for the bar.
      if (inBar === 0) {
        for (const d of [0, 2, 4]) voice(a, gain, hz(note(chord + d, 1)), next, stepDur * 16, "pad", 0.05);
      }
      // Bass.
      const b = hz(note(chord, -1));
      if (style.bass === "drone" && inBar === 0) voice(a, gain, b, next, stepDur * 16, "bass", 0.12);
      if (style.bass === "walk" && inBar % 4 === 0) voice(a, gain, hz(note(chord + [0, 2, 4, 2][inBar / 4]!, -1)), next, stepDur * 3, "bass", 0.14);
      if (style.bass === "ostinato" && inBar % 2 === 0) voice(a, gain, inBar % 8 === 6 ? hz(note(chord + 4, -1)) : b, next, stepDur * 1.5, "bass", 0.16);
      if (style.bass === "pulse" && inBar % 4 === 0) voice(a, gain, b, next, stepDur * 3.5, "bass", 0.2);
      // Lead melody (an octave up over the chord).
      const m = motif[inBar];
      if (m !== null && m !== undefined && style.lead !== "none") voice(a, gain, hz(note(chord + m, 1)), next, stepDur * (style.lead === "bell" ? 4 : 2), style.lead, style.lead === "strings" || style.lead === "brass" ? 0.05 : 0.09);
      // Drums.
      if (style.drums === "soft" && inBar % 8 === 0) drum(a, gain, next, "kick", 0.25);
      if (style.drums === "soft" && inBar % 4 === 2) drum(a, gain, next, "hat", 0.3);
      if (style.drums === "battle") {
        if (inBar % 8 === 0 || inBar === 10) drum(a, gain, next, "kick", 0.45);
        if (inBar % 8 === 4) drum(a, gain, next, "snare", 0.5);
        if (inBar % 2 === 0) drum(a, gain, next, "hat", 0.35);
        if (mood === "boss" && inBar === 14) drum(a, gain, next, "tom", 0.45);
      }
      step++;
      next += stepDur;
    }
  };
  schedule();
  const timer = setInterval(schedule, 100);
  playing = { mood, gain, timer };
}

function stopMusic(): void {
  const p = playing;
  playing = undefined;
  if (!p || !ctx) return;
  clearInterval(p.timer);
  const t = ctx.currentTime;
  p.gain.gain.cancelScheduledValues(t);
  p.gain.gain.setValueAtTime(Math.max(0.0001, p.gain.gain.value), t);
  p.gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
  setTimeout(() => p.gain.disconnect(), 2700);
}

/** Switches the music to a mood (cross-fade); the same mood again does nothing. */
export function setMood(mood: Mood): void {
  wanted = mood;
  if (playing?.mood === mood) return;
  if (!musicEnabled()) return;
  stopMusic();
  if (mood !== "silent") start(mood);
}

/** Quieter while someone speaks. */
export function duckMusic(on: boolean): void {
  duck = on ? 0.4 : 1;
  if (!playing || !ctx) return;
  const t = ctx.currentTime;
  const target = STYLES[playing.mood as Exclude<Mood, "silent">].volume * duck;
  playing.gain.gain.cancelScheduledValues(t);
  playing.gain.gain.setValueAtTime(Math.max(0.0001, playing.gain.gain.value), t);
  playing.gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, target), t + (on ? 0.35 : 0.9));
}

/** First tap/key: start what should be playing (browsers block sound before). */
export function unlockMusicOnGesture(): void {
  const unlock = () => {
    audio();
    if (ctx?.state === "running") {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (wanted && !playing) setMood(wanted);
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** What is playing right now (for tests and the settings). */
export function currentMood(): Mood | undefined {
  return playing?.mood;
}
