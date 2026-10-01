/**
 * Sound effects, made on the fly with the Web Audio API (no audio files to load or license).
 * Short effects for dice, hits and events, plus a quiet background per place: wind outdoors,
 * crickets at night, drips in caves, a low hum indoors.
 *
 * Browsers only allow sound after the first tap or key press; until then everything is silent.
 */

export type Sfx = "pop" | "dice" | "hit" | "crit" | "miss" | "heal" | "victory" | "defeat" | "coin" | "chime" | "thud" | "splash" | "rumble" | "fight" | "boss" | "door";

export interface AmbienceKind {
  outdoor: boolean;
  night: boolean;
  cave: boolean;
}

const KEY = "couch-dungeon.sound";

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private mode: only for this page.
  }
  if (!on) stopAmbience();
}

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let noiseBuffer: AudioBuffer | undefined;

function audio(): AudioContext | undefined {
  if (!soundEnabled()) return undefined;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx.state === "running" ? ctx : undefined;
}

/** Call once: the first tap or key press unlocks sound. */
export function unlockSoundOnGesture(): void {
  const unlock = () => {
    audio();
    if (ctx?.state === "running") {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (pendingAmbience) setAmbience(pendingAmbience);
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function noise(a: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const len = a.sampleRate * 2;
  noiseBuffer = a.createBuffer(1, len, a.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** One enveloped tone. */
function tone(a: AudioContext, freq: number, start: number, dur: number, opts: { type?: OscillatorType; vol?: number; to?: number; attack?: number } = {}): void {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, start);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, start + dur);
  const vol = opts.vol ?? 0.3;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + (opts.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(master!);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** A burst of filtered noise. */
function hiss(a: AudioContext, start: number, dur: number, opts: { freq?: number; to?: number; q?: number; vol?: number; type?: BiquadFilterType } = {}): void {
  const src = a.createBufferSource();
  src.buffer = noise(a);
  const f = a.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.frequency.setValueAtTime(opts.freq ?? 1500, start);
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, start + dur);
  f.Q.value = opts.q ?? 1;
  const g = a.createGain();
  const vol = opts.vol ?? 0.3;
  g.gain.setValueAtTime(vol, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(start, Math.random() * 1.5, dur + 0.05);
}

export function play(sfx: Sfx): void {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + 0.01;
  switch (sfx) {
    case "pop":
      tone(a, 660, t, 0.08, { to: 990, vol: 0.12 });
      break;
    case "dice":
      // Dice rattling on the table: a few clicks, getting slower.
      for (let i = 0, at = 0; i < 7; i++) {
        hiss(a, t + at, 0.04, { freq: 2500 + Math.random() * 2500, q: 6, vol: 0.35 - i * 0.03 });
        at += 0.04 + i * 0.025 + Math.random() * 0.03;
      }
      break;
    case "hit":
      tone(a, 160, t, 0.18, { to: 50, vol: 0.5 });
      hiss(a, t, 0.08, { freq: 900, q: 0.8, vol: 0.35 });
      break;
    case "crit":
      tone(a, 180, t, 0.22, { to: 45, vol: 0.55 });
      hiss(a, t, 0.1, { freq: 1200, q: 0.8, vol: 0.4 });
      tone(a, 880, t + 0.05, 0.5, { type: "triangle", vol: 0.18 });
      tone(a, 1320, t + 0.08, 0.6, { type: "triangle", vol: 0.14 });
      break;
    case "miss":
      hiss(a, t, 0.28, { freq: 500, to: 2500, q: 1.5, vol: 0.25 });
      break;
    case "heal":
      [523, 659, 784, 1047].forEach((f, i) => tone(a, f, t + i * 0.08, 0.5, { vol: 0.13 }));
      break;
    case "victory":
      [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45]].forEach(([f, d]) => tone(a, f!, t + d!, d === 0.45 ? 0.9 : 0.2, { type: "square", vol: 0.08 }));
      [[262, 0.45]].forEach(([f, d]) => tone(a, f!, t + d!, 0.9, { type: "triangle", vol: 0.15 }));
      break;
    case "defeat":
      [[392, 0], [311, 0.3], [262, 0.6]].forEach(([f, d]) => tone(a, f!, t + d!, 0.5, { type: "triangle", vol: 0.15 }));
      break;
    case "coin":
      tone(a, 988, t, 0.08, { type: "square", vol: 0.07 });
      tone(a, 1319, t + 0.08, 0.35, { type: "square", vol: 0.07 });
      break;
    case "chime":
      [1047, 1319, 1568, 2093].forEach((f, i) => tone(a, f, t + i * 0.06 + Math.random() * 0.02, 0.9, { vol: 0.07 }));
      break;
    case "thud":
      tone(a, 110, t, 0.2, { to: 40, vol: 0.4 });
      hiss(a, t, 0.25, { freq: 400, q: 0.7, vol: 0.2, type: "lowpass" });
      break;
    case "splash":
      hiss(a, t, 0.4, { freq: 1800, to: 600, q: 0.6, vol: 0.3 });
      hiss(a, t + 0.05, 0.25, { freq: 4000, q: 1.2, vol: 0.12 });
      break;
    case "rumble":
      hiss(a, t, 1.2, { freq: 120, q: 0.5, vol: 0.6, type: "lowpass" });
      tone(a, 55, t, 1.0, { to: 35, vol: 0.35 });
      break;
    case "fight":
      // War drum: two heavy beats.
      tone(a, 90, t, 0.3, { to: 45, vol: 0.6 });
      tone(a, 90, t + 0.28, 0.4, { to: 40, vol: 0.6 });
      hiss(a, t, 0.12, { freq: 300, q: 0.5, vol: 0.2 });
      break;
    case "boss":
      tone(a, 73, t, 1.6, { type: "sawtooth", vol: 0.12, attack: 0.3 });
      tone(a, 110, t + 0.1, 1.5, { type: "sawtooth", vol: 0.08, attack: 0.3 });
      hiss(a, t, 1.2, { freq: 150, q: 0.5, vol: 0.4, type: "lowpass" });
      break;
    case "door":
      tone(a, 180, t, 0.35, { type: "sawtooth", to: 120, vol: 0.06 });
      tone(a, 60, t + 0.3, 0.15, { to: 40, vol: 0.3 });
      break;
  }
}

// ---------------------------------------------------------------- background

let bed: { stop: () => void; kind: string } | undefined;
let pendingAmbience: AmbienceKind | undefined;

function stopAmbience(): void {
  bed?.stop();
  bed = undefined;
}

/** Quiet background for the current place. Calling it again with the same place does nothing. */
export function setAmbience(kind: AmbienceKind | undefined): void {
  pendingAmbience = kind;
  const a = audio();
  if (!a || !master) return;
  const id = kind ? `${kind.outdoor}${kind.night}${kind.cave}` : "";
  if (bed?.kind === id) return;
  stopAmbience();
  if (!kind) return;
  const out = a.createGain();
  out.gain.setValueAtTime(0.0001, a.currentTime);
  out.gain.exponentialRampToValueAtTime(1, a.currentTime + 2);
  out.connect(master);
  const nodes: AudioScheduledSourceNode[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];

  // Air: wind outdoors, a low room hum indoors.
  const src = a.createBufferSource();
  src.buffer = noise(a);
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = kind.outdoor ? 500 : 180;
  const g = a.createGain();
  g.gain.value = kind.outdoor ? 0.05 : 0.03;
  // Gusts: the volume swells slowly.
  const lfo = a.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = a.createGain();
  lfoGain.gain.value = kind.outdoor ? 0.03 : 0.01;
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(f).connect(g).connect(out);
  src.start();
  lfo.start();
  nodes.push(src, lfo);

  const blip = (freq: number, dur: number, vol: number) => {
    const o = a.createOscillator();
    const e = a.createGain();
    o.frequency.value = freq;
    const t = a.currentTime;
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  if (kind.cave) {
    // Water drops falling into puddles.
    timers.push(setInterval(() => Math.random() < 0.5 && blip(1400 + Math.random() * 900, 0.12, 0.05), 1300));
  }
  if (kind.outdoor && kind.night) {
    // Crickets: fast little chirps.
    timers.push(
      setInterval(() => {
        if (Math.random() < 0.6) for (let i = 0; i < 3; i++) setTimeout(() => blip(4200 + Math.random() * 300, 0.03, 0.012), i * 60);
      }, 700),
    );
  }
  if (kind.outdoor && !kind.night) {
    // Birds now and then.
    timers.push(
      setInterval(() => {
        if (Math.random() < 0.25) [0, 90, 180].forEach((d, i) => setTimeout(() => blip(2400 + i * 300 + Math.random() * 200, 0.07, 0.015), d));
      }, 2500),
    );
  }
  bed = {
    kind: id,
    stop: () => {
      timers.forEach(clearInterval);
      const t = a.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 2);
      setTimeout(() => {
        nodes.forEach((n) => n.stop());
        out.disconnect();
      }, 2100);
    },
  };
}
