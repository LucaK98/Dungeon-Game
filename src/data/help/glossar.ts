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
