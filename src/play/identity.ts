/**
 * The phone's player ID. Kept per tab (sessionStorage) so several tabs can play on one computer,
 * and in localStorage so a phone that reopens the page gets its seat back.
 */
const KEY = "couch-dungeon.playerId";

function read(store: Storage): string | null {
  try {
    return store.getItem(KEY);
  } catch {
    return null;
  }
}

function write(id: string): void {
  try {
    sessionStorage.setItem(KEY, id);
    localStorage.setItem(KEY, id);
  } catch {
    // Storage blocked: the ID lives only for this page.
  }
}

export function newPlayerId(): string {
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  write(id);
  return id;
}

export function playerId(): string {
  const id = read(sessionStorage) ?? read(localStorage);
  if (id) {
    write(id);
    return id;
  }
  return newPlayerId();
}
