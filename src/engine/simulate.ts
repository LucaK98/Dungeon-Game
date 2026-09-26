/**
 * Runs a complete auto-played fight. Used by the console simulation and by tests.
 */
import type { Battle, Side } from "../shared/game";
import { runAutoTurn } from "./ai";
import { combatWinner, endCombat, nextTurn, startCombat } from "./combat";
import { createMonster, pregenCharacter } from "./creatures";
import { explainDeathSave, explainInitiative, explainOutcome, type ExplainedLine } from "./explain";
import { OPEN_FIELD } from "./grid";
import { nameOf } from "./names";
import type { Rng } from "./rng";

export interface SimulationSetup {
  heroes: string[];
  enemies: string[];
  level?: number;
}

export interface SimulationResult {
  battle: Battle;
  winner: Side | undefined;
  rounds: number;
  /** Every explanation line, grouped by turn headline. */
  log: { heading: string; lines: ExplainedLine[] }[];
}

export function setupBattle(setup: SimulationSetup): Battle {
  const battle: Battle = { creatures: {} };
  setup.heroes.forEach((cls, i) => {
    const c = pregenCharacter(cls, setup.level ?? 1, `held${i + 1}`);
    c.pos = { x: 2, y: 2 + i * 2 };
    battle.creatures[c.id] = c;
  });
  setup.enemies.forEach((m, i) => {
    const c = createMonster(m, `gegner${i + 1}`, { name: `${nameOf("monsters", m)} ${i + 1}` });
    c.pos = { x: 12, y: 2 + i * 2 };
    battle.creatures[c.id] = c;
  });
  return battle;
}

export function simulateBattle(rng: Rng, setup: SimulationSetup, maxTurns = 300): SimulationResult {
  const battle = setupBattle(setup);
  const log: SimulationResult["log"] = [];
  const combat = startCombat(rng, battle);
  log.push({ heading: "🎲 Initiative (wer zuerst dran ist)", lines: combat.order.map((e) => explainInitiative(battle, e)) });

  let current = combat.order[0]!.creatureId;
  for (let turns = 0; turns < maxTurns && !combatWinner(battle); turns++) {
    const c = battle.creatures[current]!;
    if (!c.dead && c.hp > 0) {
      const lines = runAutoTurn(rng, battle, c.id, { walkable: OPEN_FIELD }).flatMap((o) => explainOutcome(battle, o));
      log.push({ heading: `Runde ${battle.combat!.round}: ${c.name} ist dran (TP ${c.hp}/${c.maxHp})`, lines });
    }
    if (combatWinner(battle)) break;
    const start = nextTurn(rng, battle);
    if (start.deathSave) {
      log.push({
        heading: `Runde ${start.round}: ${battle.creatures[start.creatureId]!.name}`,
        lines: explainDeathSave(battle, start.deathSave),
      });
    }
    current = start.creatureId;
  }
  const rounds = battle.combat?.round ?? 0;
  const winner = combatWinner(battle);
  endCombat(battle);
  return { battle, winner, rounds, log };
}
