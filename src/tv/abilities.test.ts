import { describe, expect, it } from "vitest";
import { createMonster } from "../engine/creatures";
import { seededRng } from "../engine/rng";
import { defaultLook } from "../shared/doll";
import type { GameEvent, PlayerAction } from "../shared/events";
import type { ActionChoice, PlayerView } from "../shared/view";
import { GameController } from "./game";
import { createSession } from "./session";

const CLASSES = ["fighter", "paladin", "wizard", "rogue", "cleric", "bard", "ranger", "druid", "monk"];

/** What the phone sends for a choice with a picked target (same as the controller). */
function withTarget(c: ActionChoice, id: string | undefined): PlayerAction {
  const a = c.action;
  if (!id) return a;
  switch (a.kind) {
    case "attack":
    case "approach":
    case "use_item":
    case "interact":
    case "feature":
      return { ...a, targetId: id } as PlayerAction;
    case "cast":
      return a.targetIds.length ? a : { ...a, targetIds: [id] };
    default:
      return a;
  }
}

function fight(classId: string, level: number) {
  const rng = seededRng(11);
  const session = createSession(rng, {
    players: [
      { playerId: "p1", profile: { name: "Held", classId, raceId: "human", look: defaultLook(classId, "human"), color: "#fff" } },
      { playerId: "p2", profile: { name: "Freund", classId: "fighter", raceId: "human", look: defaultLook("fighter", "human"), color: "#0f0" } },
    ],
    plan: { path: ["burghof", "gang_gerade", "saeulenhalle"] },
    noMonsters: true,
    level,
  });
  const events: { to: string; e: GameEvent }[] = [];
  const views = new Map<string, PlayerView>();
  const game = new GameController(session, rng, (to, e) => {
    events.push({ to, e });
    if (e.type === "state_update") views.set(to, e.state);
  }, (e) => events.push({ to: "all", e }), { monsterDelayMs: 0 });
  game.start();
  const hero = game.heroOf("p1")!;
  const friend = game.heroOf("p2")!;
  // A goblin right next to the hero, the friend a little hurt.
  const gob = createMonster("goblin", "g1", { name: "Goblin" });
  gob.pos = { x: hero.pos!.x + 1, y: hero.pos!.y };
  if (!session.map.cells || Object.values(session.battle.creatures).some((c) => c !== hero && c.pos?.x === gob.pos!.x && c.pos?.y === gob.pos!.y)) gob.pos = { x: hero.pos!.x, y: hero.pos!.y + 1 };
  gob.maxHp = gob.hp = 200;
  session.battle.creatures[gob.id] = gob;
  friend.hp = Math.max(1, friend.maxHp - 5);
  session.map.explored.fill(true);
  game.spawnNearParty([]);
  // Until it is the hero's turn (the friend just waits).
  for (let i = 0; i < 20 && game.mode === "combat" && game.active()?.id !== hero.id; i++) {
    if (game.active()?.id === friend.id) game.handle("p2", { kind: "end_turn" });
    else break;
  }
  return { game, events, views, hero, gob, friend };
}

describe("every ability ends its roll (no die that spins forever)", () => {
  for (const classId of CLASSES) {
    for (const level of [1, 2, 3, 5]) {
      it(`${classId} level ${level}`, () => {
        let base: ReturnType<typeof fight>;
        try {
          base = fight(classId, level);
        } catch {
          return; // class not playable
        }
        // Get to the hero's turn in a fight.
        if (base.game.active()?.id !== base.hero.id) return;
        const view = base.views.get("p1");
        if (!view) return;
        const ids = view.choices.filter((c) => c.enabled && ["attack", "spell", "item", "ability"].includes(c.group)).map((c) => c.id);
        for (const id of ids) {
          const f = fight(classId, level);
          const v = f.views.get("p1")!;
          const c = v.choices.find((x) => x.id === id);
          if (!c || !c.enabled) continue;
          const target = c.targets?.find((t) => t.id === f.gob.id) ?? c.targets?.[0];
          const before = f.events.length;
          f.game.handle("p1", withTarget(c, target?.id));
          const asked = f.events.slice(before).find((x) => x.to === "p1" && x.e.type === "request_roll");
          if (!asked || asked.e.type !== "request_roll") continue;
          const at = f.events.length;
          f.game.handle("p1", { kind: "roll", rollId: asked.e.prompt.id });
          const after = f.events.slice(at);
          const result = after.find((x) => x.e.type === "roll_result");
          const error = after.find((x) => x.to === "p1" && x.e.type === "action_error");
          expect(result, `${classId} ${level} ${id}: ${error && error.e.type === "action_error" ? error.e.reason : "no result"}`).toBeTruthy();
        }
      });
    }
  }
});
