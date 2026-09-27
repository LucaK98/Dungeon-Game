/**
 * A running game on the TV: the dungeon, all creatures and who plays whom.
 * Pure data + setup; the Phaser scene draws it, the host changes it.
 */
import { applyGear, createCharacter, createMonster } from "../engine/creatures";
import type { Rng } from "../engine/rng";
import { DIFFICULTY, type Difficulty } from "../shared/difficulty";
import type { Battle, Creature, GridPos } from "../shared/game";
import type { CharacterProfile } from "../shared/lobby";
import type { DungeonMap } from "../shared/map";
import { generateWithRetries, randomPlan, type DungeonPlan } from "../map/generate";
import { partyStartSpots, revealAround } from "../map/walk";
import { getModule, moduleExits } from "../map/modules";

export interface GameSession {
  map: DungeonMap;
  battle: Battle;
  partyIds: string[];
}

/** Monsters for rooms of a random dungeon, by difficulty of the room. */
const WANDERING: string[][] = [
  ["giant-rat", "giant-rat", "giant-rat"],
  ["goblin", "goblin"],
  ["kobold", "kobold", "kobold"],
  ["wolf", "wolf"],
  ["skeleton", "zombie"],
  ["bandit", "bandit", "thug"],
];
const BOSSES = ["red-dragon-wyrmling", "ogre", "bandit-captain", "werewolf-hybrid"];

export interface SessionOptions {
  players: { playerId: string; profile: CharacterProfile }[];
  level?: number;
  plan?: DungeonPlan;
  /** Story games place their own monsters. */
  noMonsters?: boolean;
  /** Decides the healing potions at the start. */
  difficulty?: Difficulty;
}

export function createSession(rng: Rng, opts: SessionOptions): GameSession {
  const map = generateWithRetries(rng, opts.plan ?? randomPlan(rng, 5, 1));
  const battle: Battle = { creatures: {} };
  const start = map.rooms[0]!;
  const partyIds: string[] = [];

  const exit = moduleExits(getModule(start.moduleId))[0]?.cells[0] ?? { x: 1, y: 1 };
  const spots = partyStartSpots(map, opts.players.length, { x: start.x + exit.x, y: start.y + exit.y });
  opts.players.forEach(({ playerId, profile }, i) => {
    const legacy = profile.legacy;
    const c = createCharacter({
      id: `hero-${i + 1}`,
      name: profile.name,
      classId: profile.classId,
      raceId: profile.raceId,
      level: Math.max(opts.level ?? 1, legacy?.level ?? 1),
    });
    c.playerId = playerId;
    c.appearance = { look: { ...profile.look }, color: profile.color };
    // Healing potions by difficulty (a hero from the hero book keeps the ones they saved up).
    if (c.pc) {
      const want = Math.max(DIFFICULTY[opts.difficulty ?? "normal"].potions, legacy?.potions ?? 0);
      const potion = c.pc.inventory.find((it) => it.itemId === "potion-of-healing");
      if (potion) potion.qty = want;
      else if (want) c.pc.inventory.push({ itemId: "potion-of-healing", qty: want });
      c.pc.inventory = c.pc.inventory.filter((it) => it.itemId !== "potion-of-healing" || it.qty > 0);
    }
    // A hero from the hero book brings gold and equipment along.
    if (legacy && c.pc) {
      if (legacy.gold) c.pc.inventory.push({ itemId: "gold", qty: legacy.gold });
      applyGear(c, legacy.gear);
      c.pc.stories = [...legacy.stories];
    }
    c.pos = spots[i] ?? spots[0];
    battle.creatures[c.id] = c;
    partyIds.push(c.id);
  });

  let n = 0;
  const spawn = (monsterId: string, pos: GridPos): Creature => {
    const c = createMonster(monsterId, `monster-${++n}`);
    c.pos = pos;
    battle.creatures[c.id] = c;
    return c;
  };
  map.rooms.forEach((room, index) => {
    if (index === 0 || opts.noMonsters) return;
    if (room.spots.boss.length) {
      spawn(BOSSES[rng.int(0, BOSSES.length - 1)]!, room.spots.boss[0]!);
    }
    if (room.tags.includes("fight") && room.spots.monster.length) {
      const group = WANDERING[rng.int(0, WANDERING.length - 1)]!;
      group.forEach((m, i) => {
        const spot = room.spots.monster[i % room.spots.monster.length]!;
        if (!Object.values(battle.creatures).some((c) => c.pos?.x === spot.x && c.pos?.y === spot.y)) spawn(m, spot);
      });
    }
  });

  for (const id of partyIds) revealAround(map, battle.creatures[id]!.pos!);
  return { map, battle, partyIds };
}

export function party(session: GameSession): Creature[] {
  return session.partyIds.map((id) => session.battle.creatures[id]!).filter(Boolean);
}
