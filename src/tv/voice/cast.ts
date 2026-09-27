/**
 * Who speaks with which voice. The narrator has one fixed voice; every character gets its own,
 * chosen from their name: women, men, monsters and ghosts sound different, and the same
 * character always sounds the same. Pure functions (tested), used by the speech engines.
 */

export type Kind = "narrator" | "female" | "male" | "monster" | "ghost" | "child";

/** A neural voice (Piper model) with speaker and tempo. */
export interface NeuralVoice {
  model: string;
  /** Speaker name or index for models with several speakers. */
  speaker?: string;
  /** > 1 speaks slower, < 1 faster. */
  lengthScale: number;
}

/** Piper models (rhasspy/piper-voices on Hugging Face, MIT/CC licensed voices). */
export const MODELS: Record<string, { path: string; sizeMb: number }> = {
  "de_DE-thorsten-medium": { path: "de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx", sizeMb: 63 },
  "de_DE-kerstin-low": { path: "de/de_DE/kerstin/low/de_DE-kerstin-low.onnx", sizeMb: 63 },
  "de_DE-thorsten_emotional-medium": { path: "de/de_DE/thorsten_emotional/medium/de_DE-thorsten_emotional-medium.onnx", sizeMb: 77 },
};

const FEMALE_WORDS = /\b(frau|witwe|hexe|vettel|prinzessin|königin|magd|wirtin|mutter|tochter|schwester|herrin|kräuterfrau|äbtissin|nonne|gräfin|alte|dame)\b/i;
const FEMALE_NAMES = /\b(hilde|adelgund|liese|lina|grete|gretel|kriemhild|brunhild|gudrun|elsa|ilse|marie|anna|berta|frieda|agnes|walburga|mechthild|ute|gerda|irmgard|trude|rosa|lotte|kunigunde)\b/i;
const CHILD_WORDS = /\b(kind|junge|mädchen|kleine[rs]?|knabe|lina)\b/i;
const MONSTER_WORDS = /\b(oger|drache|troll|goblin|kobold|wolf|werwolf|bestie|ungeheuer|räuberhauptmann|ork|riese|dämon)\b/i;
const GHOST_WORDS = /\b(geist|gespenst|spuk|schatten|wilde[nr]? jagd|toter|untote[rn]?)\b/i;

/** Guesses what kind of voice fits a speaker name. */
export function kindOf(name: string | undefined): Kind {
  if (!name) return "narrator";
  if (GHOST_WORDS.test(name)) return "ghost";
  if (MONSTER_WORDS.test(name)) return "monster";
  if (CHILD_WORDS.test(name)) return "child";
  if (FEMALE_WORDS.test(name) || FEMALE_NAMES.test(name)) return "female";
  return "male";
}

/** Small stable hash, so a name always picks the same variant. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const EMOTIONS_MALE = ["neutral", "amused", "sleepy", "surprised", "disgusted"];

/** The neural voice for a speaker (undefined name = narrator). */
export function neuralVoice(name?: string): NeuralVoice {
  const kind = kindOf(name);
  const h = name ? hash(name) : 0;
  const tempo = 0.92 + ((h >>> 8) % 17) / 100; // 0.92 … 1.08: everyone has their own pace
  switch (kind) {
    case "narrator":
      return { model: "de_DE-thorsten-medium", lengthScale: 1.05 };
    case "female":
      return { model: "de_DE-kerstin-low", lengthScale: tempo };
    case "child":
      return { model: "de_DE-kerstin-low", lengthScale: 0.9 };
    case "monster":
      return { model: "de_DE-thorsten_emotional-medium", speaker: "angry", lengthScale: 1.2 };
    case "ghost":
      return { model: "de_DE-thorsten_emotional-medium", speaker: "whisper", lengthScale: 1.15 };
    default:
      return { model: "de_DE-thorsten_emotional-medium", speaker: EMOTIONS_MALE[h % EMOTIONS_MALE.length]!, lengthScale: tempo };
  }
}

/** Browser voices: tone and tempo per character (the voice itself is chosen from what is installed). */
export function browserStyle(name?: string): { kind: Kind; pitch: number; rate: number; pick: number } {
  const kind = kindOf(name);
  const h = name ? hash(name) : 0;
  const wobble = ((h >>> 4) % 11) / 100 - 0.05; // ±0.05
  const base: Record<Kind, { pitch: number; rate: number }> = {
    narrator: { pitch: 1, rate: 1 },
    female: { pitch: 1.1, rate: 1.02 },
    male: { pitch: 0.9, rate: 0.98 },
    child: { pitch: 1.35, rate: 1.08 },
    monster: { pitch: 0.55, rate: 0.85 },
    ghost: { pitch: 0.75, rate: 0.82 },
  };
  const b = base[kind];
  return { kind, pitch: b.pitch + (kind === "narrator" ? 0 : wobble * 2), rate: b.rate + (kind === "narrator" ? 0 : wobble), pick: h };
}

/** Rates installed browser voices: natural online voices first. */
export function voiceScore(v: { name: string; lang: string; localService?: boolean }): number {
  if (!v.lang.toLowerCase().startsWith("de")) return -1;
  let s = 1;
  if (/natural|neural|online/i.test(v.name)) s += 10;
  if (/google/i.test(v.name)) s += 6;
  if (/premium|enhanced|siri/i.test(v.name)) s += 5;
  if (v.lang === "de-DE") s += 1;
  if (/espeak|compact/i.test(v.name)) s -= 3;
  return s;
}

const FEMALE_VOICE = /katja|amala|louisa|maja|tanja|elke|gisela|klarissa|seraphina|anna|petra|helena|hedda|marlene|vicki|yannick-no|female|frau|sabine|steffi|ingrid|julia|carmen/i;

/** Guesses the gender of an installed voice by its name. */
export function voiceIsFemale(name: string): boolean {
  return FEMALE_VOICE.test(name);
}

/** Text as it should be spoken: no emoji or symbols. */
export function speakable(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[„“”"«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits text into sentences (short pieces speak sooner). */
export function sentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+["“”]?\s*|[^.!?…]+$/g) ?? [text];
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    // Very short bits ride along with the previous sentence.
    if (out.length && p.length < 12) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}
