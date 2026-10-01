/** The village and the saga live in the TV's local storage (the group's device). */
import { sanitizeSaga, sanitizeVillage, type Saga, type Village } from "../shared/homeland";
import { lockedFeatures, type Feature } from "../shared/unlocks";

const VILLAGE = "couch-dungeon.village";
const SAGA = "couch-dungeon.saga";

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: not kept this time.
  }
}

export function loadVillage(): Village {
  return sanitizeVillage(read(VILLAGE));
}

export function saveVillage(v: Village): void {
  write(VILLAGE, v);
}

export function loadSaga(): Saga {
  return sanitizeSaga(read(SAGA));
}

export function saveSaga(s: Saga): void {
  write(SAGA, s);
}

const ALL_KEY = "couch-dungeon.all-features";

/** "Alles von Anfang an": village, travel map, love and elements without waiting for them. */
export function loadAllFeatures(): boolean {
  try {
    return localStorage.getItem(ALL_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveAllFeatures(on: boolean): void {
  try {
    localStorage.setItem(ALL_KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
}

/** What is still hidden for this TV's group (by the adventures they have finished). */
export function lockedNow(): Set<Feature> {
  return lockedFeatures(loadSaga().entries.length, loadAllFeatures());
}
