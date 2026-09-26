/**
 * Validation of character profiles sent by phones. The TV never trusts the phone.
 */
import { PLAYABLE_CLASSES } from "../engine/creatures";
import { SRD } from "../engine/data";
import { DOLL_LAYERS, DOLL_OPTIONS, type DollLook, withAutoParts } from "../shared/doll";
import { cleanName, PLAYER_COLORS, type CharacterProfile } from "../shared/lobby";

const RACES = SRD.races.map((r) => r.id);

export function sanitizeLook(look: Partial<DollLook> | undefined, raceId: string): DollLook {
  const out: DollLook = { base: `${raceId}_1` };
  if (look?.base === `${raceId}_1` || look?.base === `${raceId}_2`) out.base = look.base;
  for (const layer of DOLL_LAYERS) {
    if (layer === "base" || layer === "legs" || layer === "boots") continue;
    const id = look?.[layer];
    if (id && DOLL_OPTIONS[layer].some((o) => o.id === id)) out[layer] = id;
  }
  return withAutoParts(out);
}

/**
 * Returns a clean profile, or undefined if it is unusable.
 * A colour already taken by someone else is replaced by the first free one.
 */
export function sanitizeProfile(p: Partial<CharacterProfile> | null | undefined, takenColors: string[]): CharacterProfile | undefined {
  if (!p) return undefined;
  const name = cleanName(String(p.name ?? ""));
  const classId = String(p.classId ?? "");
  const raceId = String(p.raceId ?? "");
  if (!name || !PLAYABLE_CLASSES.includes(classId) || !RACES.includes(raceId)) return undefined;
  const free = PLAYER_COLORS.map((c) => c.id).filter((c) => !takenColors.includes(c));
  const color = p.color && free.includes(p.color) ? p.color : (free[0] ?? PLAYER_COLORS[0]!.id);
  return { name, classId, raceId, look: sanitizeLook(p.look, raceId), color };
}
