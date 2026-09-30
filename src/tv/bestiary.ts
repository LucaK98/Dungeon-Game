/**
 * The bestiary: what the heroes learned about foes' strengths and weaknesses stays on this TV
 * for the next adventures (a Feuerkobold is weak against cold – once you know it, you know it).
 */
const KEY = "couch-dungeon-bestiary";

export function loadBestiary(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as unknown) : {};
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function saveBestiary(known: Record<string, string[]>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(known));
  } catch {
    // ignore (private window, storage full)
  }
}
