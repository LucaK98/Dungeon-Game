/**
 * Not everything at once: the first adventure shows only the core (move, fight, talk, find clues).
 * Village, travel map and brewing come after the first adventure, love & family and the elements
 * after the second. A setting ("Alles von Anfang an") switches all of it on right away.
 */
export type Feature = "village" | "travel" | "brewing" | "romance" | "elements";

export interface Unlock {
  feature: Feature;
  /** Free after this many finished adventures. */
  after: number;
  icon: string;
  title: string;
  text: string;
}

export const UNLOCKS: Unlock[] = [
  { feature: "village", after: 1, icon: "🏘️", title: "Heimatdorf", text: "Mit dem Gold aus euren Abenteuern baut ihr im Hauptmenü euer Dorf aus – jedes Gebäude hilft im nächsten Abenteuer." },
  { feature: "travel", after: 1, icon: "🗺️", title: "Reisekarte", text: "Zwischen den Kapiteln wählt ihr euren Weg durch den Harz – mit Begegnungen unterwegs." },
  { feature: "brewing", after: 1, icon: "⚗️", title: "Brauen & Basteln", text: "Kräuter und Funde lassen sich im Taschen-Tab zu Tränken und Werkzeug verarbeiten." },
  { feature: "romance", after: 2, icon: "🌹", title: "Freundschaft & Liebe", text: "Flirten, Geschenke, Verlobung: Figuren erinnern sich an euch – und manche ziehen ins Dorf." },
  { feature: "elements", after: 2, icon: "🔥", title: "Elemente", text: "Manche Gegner sind jetzt aus Feuer, Eis oder Gift – und gegen andere Elemente besonders anfällig." },
];

/** The features still hidden after this many finished adventures. */
export function lockedFeatures(done: number, all = false): Set<Feature> {
  return new Set(all ? [] : UNLOCKS.filter((u) => done < u.after).map((u) => u.feature));
}

/** What this finished adventure (the n-th) has just unlocked. */
export function newUnlocks(done: number, all = false): Unlock[] {
  return all ? [] : UNLOCKS.filter((u) => u.after === done);
}
