/**
 * Runs a complete auto-played fight. Used by the console simulation and by tests.
 */
import type { Battle, Side } from "../shared/game";
import { runAutoTurn } from "./ai";
import { combatWinner, endCombat, nextTurn, startCombat } from "./combat";
import { createMonster, hardenMonster, pregenCharacter } from "./creatures";
import { heal } from "./combat";
import { parseDice, rollDice } from "./dice";
import { applyElement, type Element } from "./types";
import { explainDeathSave, explainInitiative, explainOutcome, type ExplainedLine } from "./explain";
import { OPEN_FIELD } from "./grid";
import { nameOf } from "./names";
import type { Rng } from "./rng";

export interface SimulationSetup {
  heroes: string[];
  enemies: string[];
  level?: number;
  /** All foes as elemental variants (for balancing). */
  element?: Element;
  /** Heroes drink a healing potion (2W4+2, takes the turn) when they drop below a third: this many each. */
  potions?: number;
  /** Difficulty: monster hit points ×, to-hit and damage bonus (see hardenMonster). */
  harden?: { hp: number; attack: number; damage: number };
  /** Per foe (same order as enemies): fitted to the group (see src/dm/encounter.ts). */
  enemyMods?: { hp: number; attack: number; damage: number }[];
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
    if (setup.element) applyElement(c, setup.element);
    if (setup.harden) hardenMonster(c, setup.harden);
    const mod = setup.enemyMods?.[i];
    if (mod) hardenMonster(c, mod);
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
  const potions = new Map<string, number>(Object.values(battle.creatures).filter((c) => c.side === "party").map((c) => [c.id, setup.potions ?? 0]));
  for (let turns = 0; turns < maxTurns && !combatWinner(battle); turns++) {
    const c = battle.creatures[current]!;
    const left = potions.get(c.id) ?? 0;
    if (!c.dead && c.hp > 0 && left > 0 && c.hp < c.maxHp / 3) {
      // A hero in trouble drinks a potion instead of acting.
      potions.set(c.id, left - 1);
      const healed = rollDice(rng, parseDice("2d4+2")).total;
      heal(c, healed);
      log.push({ heading: `Runde ${battle.combat!.round}: ${c.name} trinkt einen Heiltrank`, lines: [{ text: `🧪 +${healed} TP`, glossarKeys: [] }] });
    } else if (!c.dead && c.hp > 0) {
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
