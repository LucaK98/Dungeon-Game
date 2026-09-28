/**
 * Settings of this phone (not the game): a simpler action screen, ending the turn by itself after the action,
 * rolling the die by shaking the phone.
 */
export interface PhonePrefs {
  /** Only the most useful actions; everything else behind "Alle Aktionen". */
  simple: boolean;
  /** After the action (and no bonus action to use) the turn ends by itself. */
  autoEnd: boolean;
  /** Shake the phone to roll. */
  shake: boolean;
  /** The roll result closes by itself after a few seconds. */
  autoClose: boolean;
}

const KEY = "couch-dungeon.phone-prefs";

export function loadPrefs(): PhonePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<PhonePrefs>;
    return { simple: !!raw.simple, autoEnd: !!raw.autoEnd, shake: raw.shake !== false, autoClose: raw.autoClose !== false };
  } catch {
    return { simple: false, autoEnd: false, shake: true, autoClose: true };
  }
}

export function savePrefs(p: PhonePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // no storage: the choice lasts for this page only
  }
}

/** iOS asks before a page may read the motion sensor (only after a tap). */
export async function allowMotion(): Promise<boolean> {
  const D = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  if (!D) return false;
  if (!D.requestPermission) return true;
  try {
    return (await D.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
