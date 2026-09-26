/**
 * A running game on the TV: the dungeon, all creatures and who plays whom.
 * Pure data + setup; the Phaser scene draws it, the host changes it.
 */
import { createCharacter, createMonster } from "../engine/creatures";
import type { Rng } from "../engine/rng";
import type { Battle, Creature, GridPos } from "../shared/game";
import type { CharacterProfile } from "../shared/lobby";
import type { DungeonMap } from "../shared/map";
import { generateWithRetries, randomPlan, type DungeonPlan } from "../map/generate";
import { revealAround } from "../map/walk";

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
}

export function createSession(rng: Rng, opts: SessionOptions): GameSession {
  const map = generateWithRetries(rng, opts.plan ?? randomPlan(rng, 5, 1));
  const battle: Battle = { creatures: {} };
  const start = map.rooms[0]!;
  const partyIds: string[] = [];

  opts.players.forEach(({ playerId, profile }, i) => {
    const c = createCharacter({
      id: `hero-${i + 1}`,
      name: profile.name,
      classId: profile.classId,
      raceId: profile.raceId,
      level: opts.level ?? 1,
    });
    c.playerId = playerId;
    c.appearance = { look: profile.look, color: profile.color };
    c.pos = start.spots.party[i] ?? start.spots.party[0];
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
    if (index === 0) return;
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
