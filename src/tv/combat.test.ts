import { describe, expect, it } from "vitest";
import { createMonster } from "../engine/creatures";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { GameEvent } from "../shared/events";
import type { PlayerView } from "../shared/view";
import { isWalkable } from "../map/walk";
import type { DungeonMap } from "../shared/map";
import { GameController } from "./game";
import { createSession } from "./session";

const HEROES = [
  { name: "Brunhild", classId: "fighter", raceId: "human" },
  { name: "Siegfried", classId: "paladin", raceId: "human" },
  { name: "Ilmarin", classId: "wizard", raceId: "elf" },
  { name: "Pip", classId: "rogue", raceId: "halfling" },
];

/** A fight against three goblins, played through the same messages the phones send. */
function goblinFight(seed: number, talk: boolean | "vivid" = false) {
  const rng = seededRng(seed);
  const session = createSession(rng, {
    players: HEROES.map((h, i) => ({ playerId: `p${i}`, profile: { ...h, look: defaultLook(h.classId, h.raceId), color: "#fff" } })),
    plan: { path: ["burghof", "gang_gerade", "saeulenhalle"] },
  });
  // Clear the random monsters, place three goblins in the hall.
  for (const c of Object.values(session.battle.creatures)) if (c.kind === "monster") delete session.battle.creatures[c.id];
  const hall = session.map.rooms[2]!;
  const spots = [...hall.spots.monster, { x: hall.x + 6, y: hall.y + 5 }];
  for (let i = 0; i < 3; i++) {
    const g = createMonster("goblin", `goblin-${i + 1}`, { name: `Goblin ${i + 1}` });
    g.pos = spots[i]!;
    session.battle.creatures[g.id] = g;
  }
  const views = new Map<string, PlayerView>();
  const rolls: string[] = [];
  const events: GameEvent[] = [];
  const game = new GameController(
    session,
    rng,
    (to, e) => {
      events.push(e);
      if (e.type === "state_update") views.set(to, e.state);
    },
    (e) => {
      events.push(e);
      if (e.type === "roll_result") rolls.push(...e.result.lines.map((l) => l.text));
    },
    { monsterDelayMs: 0 },
  );
  let combatSeen = false;
  let typed = 0;
  game.on({ combat: (started) => started && (combatSeen = true) });
  game.start();

  // Simple "players": go towards the goblins, attack what is in reach, heal the fallen.
  for (let step = 0; step < 2000 && !(combatSeen && game.mode === "explore"); step++) {
    const active = game.active()!;
    const pid = active.playerId!;
    const view = game.viewFor(pid)!;
    if (view.pendingRoll) {
      game.handle(pid, { kind: "roll", rollId: view.pendingRoll.id });
      continue;
    }
    const heal = view.choices.find((c) => c.enabled && c.recommended && (c.group === "item" || c.id.startsWith("spell:healing") || c.id.startsWith("spell:cure")));
    const attack = view.choices.find((c) => c.enabled && c.group === "attack" && c.targets?.length);
    if (heal?.targets?.length) {
      const downed = heal.targets.find((t) => session.battle.creatures[t.id]!.hp === 0) ?? heal.targets[0]!;
      game.handle(pid, heal.action.kind === "use_item" ? { ...heal.action, targetId: downed.id } : { kind: "cast", spellId: heal.id.slice(6), targetIds: [downed.id] });
      continue;
    }
    if (attack && talk) {
      const who = attack.targets![0]!.name;
      game.handle(pid, { kind: "free_text", text: talk === "vivid" ? `Ich springe mit Anlauf vor und greife ${who} mit aller Kraft an` : `Ich greife ${who} an!` });
      if (game.viewFor(pid)!.log.some((l) => /„Ich greife Goblin \d an!“ → /.test(l.text))) typed++;
      continue;
    }
    if (attack) {
      game.handle(pid, { ...(attack.action as Extract<typeof attack.action, { kind: "attack" }>), targetId: attack.targets![0]!.id });
      continue;
    }
    const goblins = Object.values(session.battle.creatures).filter((c) => c.kind === "monster" && !c.dead);
    const reach = view.minimap.reachable;
    if (reach.length && goblins.length && view.turn.movementLeftFt > 0) {
      const field = walkDistances(session.map, goblins.map((g) => g.pos!));
      const dist = (p: { x: number; y: number }) => field.get(`${p.x},${p.y}`) ?? 9999;
      const best = [...reach].sort((a, b) => dist(a) - dist(b))[0]!;
      if (dist(best) < dist(active.pos!)) {
        game.handle(pid, { kind: "move", to: best });
        continue;
      }
    }
    game.handle(pid, { kind: "end_turn" });
  }
  return { game, session, rolls, combatSeen, events, typed };
}

describe("combat (A5)", () => {
  it("plays a whole fight against three goblins", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { session, rolls, combatSeen, game } = goblinFight(seed);
      expect(combatSeen, `seed ${seed}`).toBe(true);
      expect(game.mode, `seed ${seed}`).toBe("explore");
      const goblins = Object.values(session.battle.creatures).filter((c) => c.monsterId === "goblin");
      const heroesUp = Object.values(session.battle.creatures).filter((c) => c.kind === "pc" && c.hp > 0);
      expect(goblins.every((g) => g.dead) || heroesUp.length > 0, `seed ${seed}`).toBe(true);
      // Every roll is explained: attack lines compare with the armour class.
      expect(rolls.some((l) => /gegen RK \d+ → /.test(l)), `seed ${seed}`).toBe(true);
      expect(rolls.some((l) => l.startsWith("⚔️ Kampf!")), `seed ${seed}`).toBe(true);
    }
  });

  it("turns typed attacks into real attacks with the hero's weapon", () => {
    const { session, rolls, typed } = goblinFight(3, true);
    expect(Object.values(session.battle.creatures).filter((c) => c.monsterId === "goblin").every((g) => g.dead)).toBe(true);
    expect(rolls.some((l) => /gegen RK \d+ → /.test(l))).toBe(true);
    expect(typed).toBeGreaterThan(0);
  });

  it("tells typed attacks in the player's words, a vivid one catches the enemy off guard", () => {
    const { events, session } = goblinFight(5, "vivid");
    const said = JSON.stringify(events.filter((e) => e.type === "narration"));
    expect(said).toMatch(/Genau so macht es|versucht es genau so/);
    expect(JSON.stringify(events)).toContain("Stark beschrieben");
    expect(Object.values(session.battle.creatures).filter((c) => c.monsterId === "goblin").every((g) => g.dead)).toBe(true);
  });

  it("lets the goblins act on their own", () => {
    const { rolls } = goblinFight(2);
    expect(rolls.some((l) => /^Goblin \\d greift/.test(l) || /Goblin \d greift .* an/.test(l))).toBe(true);
  });
});

/** Walking distance to the nearest of `goals` for every square (breadth-first). */
function walkDistances(map: DungeonMap, goals: { x: number; y: number }[]): Map<string, number> {
  const dist = new Map<string, number>();
  let frontier = goals.map((g) => ({ ...g }));
  frontier.forEach((g) => dist.set(`${g.x},${g.y}`, 0));
  for (let d = 1; frontier.length; d++) {
    const next: { x: number; y: number }[] = [];
    for (const p of frontier) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const q = { x: p.x + dx, y: p.y + dy };
          const k = `${q.x},${q.y}`;
          if (dist.has(k) || !isWalkable(map, q)) continue;
          dist.set(k, d);
          next.push(q);
        }
      }
    }
    frontier = next;
  }
  return dist;
}
