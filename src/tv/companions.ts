/**
 * Tamed animals in play: building one from its hero-book entry (growing with the hero),
 * and placing strays on a new map.
 */
import { createMonster } from "../engine/creatures";
import type { Rng } from "../engine/rng";
import { COMPANIONS, WILD, type CompanionInfo, type CompanionKind } from "../shared/companions";
import type { Creature, GridPos } from "../shared/game";
import type { DungeonMap } from "../shared/map";

/** The companion as a creature on the heroes' side, stronger with its hero's level and its gift. */
export function makeCompanion(info: CompanionInfo, owner: Creature, id: string): Creature {
  const def = COMPANIONS[info.kind];
  const c = createMonster(def.monster, id, { name: info.name, side: "party" });
  const level = owner.pc?.level ?? 1;
  c.maxHp += def.hpPerLevel * level + (info.trait === "zaeh" ? 6 : 0);
  c.hp = c.maxHp;
  if (info.trait === "beisser") for (const a of c.attacks) a.damageBonus.push({ label: "Beißer", value: 2, glossarKey: "begleiter" });
  if (info.trait === "flink") c.baseAc.push({ label: "Flink", value: 2, glossarKey: "begleiter" });
  // Companions learn to fight with their hero: their aim gets better with the hero's level.
  const aim = Math.floor((level - 1) / 2);
  if (aim) for (const a of c.attacks) a.toHit.push({ label: "Erfahrung", value: aim, glossarKey: "begleiter" });
  c.companion = { ...info, ownerId: owner.id };
  return c;
}

/** Stray animals for a new map: at most one, and only if a hero still has no companion. */
export function placeStray(map: DungeonMap, rng: Rng, free: (p: GridPos) => boolean, avoid: GridPos[]): { kind: CompanionKind; pos: GridPos } | undefined {
  const options: { kind: CompanionKind; room: number }[] = [];
  map.rooms.forEach((room, i) => {
    if (i === 0) return;
    for (const [kind, chance] of WILD[room.theme] ?? []) if (rng.next() < chance) options.push({ kind, room: i });
  });
  if (!options.length) return undefined;
  const pick = options[rng.int(0, options.length - 1)]!;
  const room = map.rooms[pick.room]!;
  const cells: GridPos[] = [];
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      const p = { x, y };
      if (free(p) && !avoid.some((a) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) <= 2)) cells.push(p);
    }
  }
  if (!cells.length) return undefined;
  return { kind: pick.kind, pos: cells[rng.int(0, cells.length - 1)]! };
}
