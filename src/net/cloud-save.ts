/**
 * Save games in the cloud (Supabase), so a game can go on on another TV or laptop.
 *
 * Every game gets a short save code (8 letters/digits) that the TV shows. Anyone with the code
 * can load the game; only the device that made it can overwrite it (secret write token, kept in
 * this browser). The database only allows the two functions couch_dungeon_save/_load.
 */
import { SUPABASE_ANON_JWT, SUPABASE_KEY, SUPABASE_URL } from "./supabase";

export interface CloudId {
  code: string;
  token: string;
}

/** No 0/O and 1/I: easy to read aloud and type. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomChars(n: number, alphabet: string): string {
  const buf = new Uint32Array(n);
  globalThis.crypto.getRandomValues(buf);
  return [...buf].map((v) => alphabet[v % alphabet.length]).join("");
}

export function newCloudId(): CloudId {
  return { code: randomChars(8, ALPHABET), token: randomChars(32, ALPHABET + "abcdefghijkmnopqrstuvwxyz") };
}

/** Accepts what people type: spaces, dashes, lower case. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function isCloudCode(code: string): boolean {
  return /^[A-Z0-9]{8}$/.test(code);
}

/** "ABCD2345" → "ABCD-2345" (easier to read from the sofa). */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

type Fetch = typeof fetch;

async function rpc(fn: string, body: unknown, fetchImpl: Fetch): Promise<unknown> {
  const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_ANON_JWT}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`cloud ${fn}: ${res.status}`);
  return res.json();
}

/** Uploads a save. Resolves false if it could not be stored (offline, foreign code). */
export async function cloudSave(id: CloudId, data: unknown, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    return (await rpc("couch_dungeon_save", { p_code: id.code, p_token: id.token, p_data: data }, fetchImpl)) === true;
  } catch {
    return false;
  }
}

/** Loads a save by its code; undefined if there is none (or no connection). */
export async function cloudLoad(code: string, fetchImpl: Fetch = fetch): Promise<unknown> {
  const c = normalizeCode(code);
  if (!isCloudCode(c)) return undefined;
  try {
    return (await rpc("couch_dungeon_load", { p_code: c }, fetchImpl)) ?? undefined;
  } catch {
    return undefined;
  }
}
