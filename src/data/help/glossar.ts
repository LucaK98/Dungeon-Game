import glossarJson from "./glossar.de.json";

export interface GlossarEntry {
  titel: string;
  /** One sentence, everyday language. */
  kurz: string;
  /** 3–6 sentences with an example from the game. */
  lang: string;
  beispiel?: string;
  siehe_auch?: string[];
}

export const GLOSSAR = glossarJson as Record<string, GlossarEntry>;

export function glossarEntry(key: string): GlossarEntry | undefined {
  return GLOSSAR[key];
}

/** Simple keyword search over titles and texts (the "?" search field). */
export function searchGlossar(query: string, limit = 20): { key: string; entry: GlossarEntry }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { key: string; entry: GlossarEntry; score: number }[] = [];
  for (const [key, entry] of Object.entries(GLOSSAR)) {
    const title = entry.titel.toLowerCase();
    let score = 0;
    if (title === q) score = 100;
    else if (title.startsWith(q)) score = 50;
    else if (title.includes(q)) score = 30;
    else if (entry.kurz.toLowerCase().includes(q)) score = 10;
    else if (entry.lang.toLowerCase().includes(q)) score = 5;
    if (score) scored.push({ key, entry, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.entry.titel.localeCompare(b.entry.titel)).slice(0, limit);
}

const STOP = new Set(["kann", "ich", "wie", "was", "wann", "warum", "wenn", "darf", "muss", "eine", "einen", "einem", "einer", "der", "die", "das", "den", "dem", "und", "oder", "mit", "mich", "mir", "man", "bei", "auf", "für", "ist", "sind", "habe", "hat", "noch", "auch", "nicht", "mein", "meine", "meinen", "gibt", "funktioniert", "bedeutet", "heißt"]);

/** Glossary entries that best fit a question in plain words ("Wie funktioniert Deckung?"). */
export function glossarForQuestion(question: string, limit = 4): { key: string; entry: GlossarEntry }[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-zäöüß0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 5 ? w.slice(0, w.length - 1) : w)); // "Angriffe" also finds "Angriff"
  if (!words.length) return [];
  const scored = Object.entries(GLOSSAR).map(([key, entry]) => {
    const t = entry.titel.toLowerCase();
    const k = entry.kurz.toLowerCase();
    const l = entry.lang.toLowerCase();
    const score = words.reduce((sum, w) => sum + (t.includes(w) ? 6 : 0) + (k.includes(w) ? 2 : 0) + (l.includes(w) ? 1 : 0), 0);
    return { key, entry, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Scores like glossarForQuestion, for deciding whether the rule book alone answers a question. */
export function glossarScores(question: string): { key: string; entry: GlossarEntry; score: number }[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-zäöüß0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 5 ? w.slice(0, w.length - 1) : w));
  if (!words.length) return [];
  return Object.entries(GLOSSAR)
    .map(([key, entry]) => {
      const t = entry.titel.toLowerCase();
      const score = words.reduce((sum, w) => sum + (t.includes(w) ? 6 : 0) + (entry.kurz.toLowerCase().includes(w) ? 2 : 0) + (entry.lang.toLowerCase().includes(w) ? 1 : 0), 0);
      return { key, entry, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}
