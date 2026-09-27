/**
 * Battle state: positions, hit points, conditions, initiative and turns.
 * 1 square = 5 feet = 1.5 m.
 */
import type {
  ActiveCondition,
  Battle,
  CombatState,
  Creature,
  DeathSaveResult,
  EffectId,
  GridPos,
  HpChange,
  InitiativeEntry,
  Side,
  TurnState,
} from "../shared/game";
import type { ConditionId, Size } from "../shared/rules";
import type { BreakdownPart } from "../shared/types";
import { d20Part, modPart, rollD20, savingThrow, sumParts } from "./core";
import type { Rng } from "./rng";
import { pathCost } from "./terrain";

export const FEET_PER_SQUARE = 5;

// ---------------------------------------------------------------- geometry

export function sizeInSquares(size: Size): number {
  return size === "large" ? 2 : size === "huge" ? 3 : size === "gargantuan" ? 4 : 1;
}

export function squaresOf(c: Creature, at: GridPos | undefined = c.pos): GridPos[] {
  if (!at) return [];
  const n = sizeInSquares(c.size);
  const out: GridPos[] = [];
  for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) out.push({ x: at.x + dx, y: at.y + dy });
  return out;
}

/** Chebyshev distance: diagonals count like straight steps (SRD default). */
export function squareDistance(a: GridPos, b: GridPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function distanceFt(a: Creature, b: Creature, aPos: GridPos | undefined = a.pos): number {
  const sa = squaresOf(a, aPos);
  const sb = squaresOf(b);
  if (!sa.length || !sb.length) return Infinity;
  let best = Infinity;
  for (const p of sa) for (const q of sb) best = Math.min(best, squareDistance(p, q));
  return best * FEET_PER_SQUARE;
}

// ---------------------------------------------------------------- state helpers

export function hasCondition(c: Creature, id: ConditionId): boolean {
  return c.conditions.some((x) => x.id === id);
}

export function addCondition(c: Creature, cond: ActiveCondition): boolean {
  if (c.conditionImmunities.includes(cond.id)) return false;
  c.conditions = c.conditions.filter((x) => x.id !== cond.id);
  c.conditions.push(cond);
  return true;
}

export function removeCondition(c: Creature, id: ConditionId): void {
  c.conditions = c.conditions.filter((x) => x.id !== id);
}

export function hasEffect(c: Creature, id: EffectId): boolean {
  return c.effects.some((e) => e.id === id);
}

export function addEffect(c: Creature, id: EffectId, rounds: number, sourceId: string): void {
  c.effects = c.effects.filter((e) => !(e.id === id && e.sourceId === sourceId));
  c.effects.push({ id, rounds, sourceId });
}

export function isIncapacitated(c: Creature): boolean {
  return (
    c.dead ||
    c.hp <= 0 ||
    c.conditions.some((x) => ["incapacitated", "paralyzed", "stunned", "unconscious"].includes(x.id))
  );
}

export function isActive(c: Creature): boolean {
  return !c.dead && c.hp > 0;
}

export function acParts(c: Creature): BreakdownPart[] {
  const parts = [...c.baseAc];
  if (hasEffect(c, "shield-of-faith")) parts.push({ label: "Schild des Glaubens", value: 2, glossarKey: "zauber:shield-of-faith" });
  if (hasEffect(c, "cover")) parts.push({ label: "Deckung", value: 2, glossarKey: "deckung" });
  return parts;
}

export function armorClass(c: Creature): number {
  return sumParts(acParts(c));
}

export function currentSpeedFt(c: Creature): number {
  if (hasCondition(c, "grappled") || hasCondition(c, "restrained") || isIncapacitated(c)) return 0;
  let speed = c.speedFt;
  if (hasEffect(c, "ray-of-frost")) speed = Math.max(0, speed - 10);
  return speed;
}

// ---------------------------------------------------------------- hit points

function blankChange(c: Creature): HpChange {
  return {
    targetId: c.id,
    before: c.hp,
    after: c.hp,
    tempAbsorbed: 0,
    downed: false,
    killed: false,
    deathSaveFailures: 0,
    wokeUp: false,
  };
}

export interface DamageContext {
  crit?: boolean;
  /** Damage type of the biggest part (zombie fortitude cares about radiant). */
  types?: string[];
}

/** Applies damage, handling temporary HP, dying, death and concentration. */
export function applyDamage(rng: Rng, c: Creature, amount: number, ctx: DamageContext = {}): HpChange {
  const change = blankChange(c);
  if (amount <= 0 || c.dead) return change;

  let rest = amount;
  if (c.tempHp > 0) {
    change.tempAbsorbed = Math.min(c.tempHp, rest);
    c.tempHp -= change.tempAbsorbed;
    rest -= change.tempAbsorbed;
  }

  // Sleeping creatures wake up when hurt.
  const sleeping = c.conditions.find((x) => x.id === "unconscious" && x.endsOnDamage);
  if (sleeping && rest > 0 && c.hp > 0) {
    removeCondition(c, "unconscious");
    change.wokeUp = true;
  }

  if (c.hp <= 0 && c.kind === "pc") {
    // Already dying: each hit is a failed death save, a critical hit counts twice.
    const fails = ctx.crit ? 2 : 1;
    c.deathSaves.failures = Math.min(3, c.deathSaves.failures + fails);
    c.stable = false;
    change.deathSaveFailures = fails;
    if (c.deathSaves.failures >= 3) {
      c.dead = true;
      change.killed = true;
    }
    return change;
  }

  c.hp = Math.max(0, c.hp - rest);
  change.after = c.hp;

  if (c.hp === 0) {
    if (c.kind === "monster") {
      if (c.traits.includes("undead-fortitude") && !ctx.crit && !ctx.types?.includes("radiant")) {
        const check = savingThrow(rng, c, "CON", 5 + rest);
        if (check.success) {
          c.hp = 1;
          change.after = 1;
          change.survived = check;
          return change;
        }
      }
      c.dead = true;
      change.killed = true;
      c.concentration = undefined;
      return change;
    }
    // Simplified for beginners: no instant death from massive damage, heroes always get death saves.
    change.downed = true;
    c.deathSaves = { successes: 0, failures: 0 };
    c.stable = false;
    addCondition(c, { id: "unconscious" });
    addCondition(c, { id: "prone" });
    c.concentration = undefined;
    return change;
  }

  if (c.concentration) {
    const dc = Math.max(10, Math.floor(rest / 2));
    const check = savingThrow(rng, c, "CON", dc);
    change.concentration = { spellId: c.concentration, check, lost: !check.success };
    if (!check.success) c.concentration = undefined;
  }
  return change;
}

/** Heals and wakes up unconscious characters. */
export function heal(c: Creature, amount: number): HpChange {
  const change = blankChange(c);
  // Swarms can't regain hit points (SRD).
  if (c.dead || amount <= 0 || c.traits.includes("swarm")) return change;
  const wasDown = c.hp === 0;
  c.hp = Math.min(c.maxHp, c.hp + amount);
  change.after = c.hp;
  if (wasDown && c.hp > 0) {
    c.deathSaves = { successes: 0, failures: 0 };
    c.stable = false;
    removeCondition(c, "unconscious");
    change.wokeUp = true;
  }
  return change;
}

/** Death saving throw at the start of a dying character's turn (simplified SRD rules). */
export function rollDeathSave(rng: Rng, c: Creature): DeathSaveResult {
  const roll = rollD20(rng, [], c.pc?.raceId === "halfling");
  const n = roll.natural;
  let outcome: DeathSaveResult["outcome"] = "continue";
  if (n === 20) {
    heal(c, 1);
    outcome = "revived";
  } else if (n >= 10) {
    c.deathSaves.successes++;
  } else {
    c.deathSaves.failures += n === 1 ? 2 : 1;
  }
  if (outcome === "continue") {
    if (c.deathSaves.failures >= 3) {
      c.dead = true;
      outcome = "dead";
    } else if (c.deathSaves.successes >= 3) {
      c.stable = true;
      outcome = "stable";
    }
  }
  return {
    creatureId: c.id,
    roll,
    success: n >= 10,
    successes: c.deathSaves.successes,
    failures: Math.min(3, c.deathSaves.failures),
    outcome,
  };
}

// ---------------------------------------------------------------- initiative & turns

export function rollInitiative(rng: Rng, c: Creature): InitiativeEntry {
  const roll = rollD20(rng, [], c.pc?.raceId === "halfling");
  const parts = [d20Part(roll), modPart(c, "DEX")];
  if (c.pc?.talents?.includes("wachsam")) parts.push({ label: "Wachsam", value: 5, glossarKey: "talent" });
  return { creatureId: c.id, total: sumParts(parts), parts, roll };
}

export function newTurn(c: Creature): TurnState {
  return {
    creatureId: c.id,
    movementLeftFt: currentSpeedFt(c),
    actions: 1,
    bonusAction: true,
    sneakAttackUsed: false,
    attacksLeft: 0,
  };
}

export function startCombat(rng: Rng, battle: Battle, ids: string[] = Object.keys(battle.creatures)): CombatState {
  const order = ids
    .map((id) => battle.creatures[id]!)
    .filter((c) => !c.dead)
    .map((c) => rollInitiative(rng, c))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const ca = battle.creatures[a.creatureId]!;
      const cb = battle.creatures[b.creatureId]!;
      if (cb.abilities.DEX !== ca.abilities.DEX) return cb.abilities.DEX - ca.abilities.DEX;
      return ca.side === "party" ? -1 : cb.side === "party" ? 1 : 0;
    });
  const first = battle.creatures[order[0]!.creatureId]!;
  battle.combat = { round: 1, order, turnIndex: 0, turn: newTurn(first), reactionUsed: {} };
  return battle.combat;
}

export function currentCreature(battle: Battle): Creature | undefined {
  const combat = battle.combat;
  if (!combat) return undefined;
  const entry = combat.order[combat.turnIndex];
  return entry ? battle.creatures[entry.creatureId] : undefined;
}

export interface TurnStart {
  creatureId: string;
  round: number;
  newRound: boolean;
  deathSave?: DeathSaveResult;
  expired: { creatureId: string; what: string }[];
  /** True if the creature can't do anything this turn (dying, asleep, …). */
  skip: boolean;
}

function tickDurations(c: Creature, expired: TurnStart["expired"]): void {
  c.effects = c.effects.filter((e) => {
    e.rounds--;
    if (e.rounds <= 0) expired.push({ creatureId: c.id, what: e.id });
    return e.rounds > 0;
  });
  c.conditions = c.conditions.filter((x) => {
    if (x.rounds === undefined) return true;
    x.rounds--;
    if (x.rounds <= 0) expired.push({ creatureId: c.id, what: x.id });
    return x.rounds > 0;
  });
}

/** Ends the current turn and starts the next one. */
export function nextTurn(rng: Rng, battle: Battle): TurnStart {
  const combat = battle.combat;
  if (!combat) throw new Error("no combat running");
  const expired: TurnStart["expired"] = [];
  const ending = currentCreature(battle);
  if (ending) {
    // Effects last "until the end of your next turn" → count down on the owner's turn end.
    tickDurations(ending, expired);
    // Disengage only lasts for the turn it was used in.
    ending.effects = ending.effects.filter((e) => e.id !== "disengage");
  }

  let newRound = false;
  for (let guard = 0; guard < combat.order.length + 1; guard++) {
    combat.turnIndex++;
    if (combat.turnIndex >= combat.order.length) {
      combat.turnIndex = 0;
      combat.round++;
      combat.reactionUsed = {};
      newRound = true;
    }
    const c = battle.creatures[combat.order[combat.turnIndex]!.creatureId];
    if (c && !c.dead) break;
  }

  const c = currentCreature(battle)!;
  // Dodge lasts until the start of the creature's next turn.
  c.effects = c.effects.filter((e) => e.id !== "dodge");
  combat.turn = newTurn(c);
  const start: TurnStart = { creatureId: c.id, round: combat.round, newRound, expired, skip: false };

  if (c.hp === 0 && c.kind === "pc" && !c.dead) {
    if (!c.stable) start.deathSave = rollDeathSave(rng, c);
    start.skip = c.hp === 0;
  } else if (isIncapacitated(c)) {
    start.skip = true;
  }
  return start;
}

export function sideOf(battle: Battle, side: Side): Creature[] {
  return Object.values(battle.creatures).filter((c) => c.side === side);
}

/** "party" if all enemies are down, "enemy" if all heroes are down, else undefined. */
export function combatWinner(battle: Battle): Side | undefined {
  const involved = new Set(battle.combat?.order.map((o) => o.creatureId) ?? Object.keys(battle.creatures));
  const standing = (side: Side) =>
    Object.values(battle.creatures).some((c) => involved.has(c.id) && c.side === side && isActive(c));
  if (!standing("enemy")) return "party";
  if (!standing("party")) return "enemy";
  return undefined;
}

export function endCombat(battle: Battle): void {
  for (const c of Object.values(battle.creatures)) {
    // Dying heroes stabilise after the fight, so nobody dies "off screen".
    if (c.kind === "pc" && c.hp === 0 && !c.dead) c.stable = true;
    c.effects = [];
    c.concentration = undefined;
  }
  delete battle.combat;
}

// ---------------------------------------------------------------- movement

export interface MoveResult {
  ok: boolean;
  reason?: string;
  costFt: number;
  /** Enemies that may take an opportunity attack. */
  provokes: string[];
}

/**
 * Checks a move along a path of squares (each step 5 ft, diagonals included) without changing anything.
 * Walls and other obstacles are checked by the map layer before calling this.
 */
export function planMove(battle: Battle, id: string, path: GridPos[]): MoveResult {
  const c = battle.creatures[id]!;
  const turn = battle.combat?.turn;
  const costFt = pathCost(battle, path) * FEET_PER_SQUARE + (hasCondition(c, "prone") ? Math.floor(c.speedFt / 2) : 0);
  if (turn && turn.creatureId === id && costFt > turn.movementLeftFt) {
    return { ok: false, reason: "Nicht genug Bewegung übrig.", costFt, provokes: [] };
  }
  if (!c.pos || !path.length) return { ok: true, costFt: 0, provokes: [] };

  const provokes: string[] = [];
  if (!hasEffect(c, "disengage")) {
    let prev = c.pos;
    for (const step of path) {
      for (const other of Object.values(battle.creatures)) {
        if (other.side === c.side || other.side === "neutral" || isIncapacitated(other)) continue;
        if (battle.combat?.reactionUsed[other.id] || provokes.includes(other.id)) continue;
        const reach = Math.max(5, ...other.attacks.filter((a) => a.kind === "melee").map((a) => a.reachFt));
        if (distanceFt(c, other, prev) <= reach && distanceFt(c, other, step) > reach) provokes.push(other.id);
      }
      prev = step;
    }
  }
  return { ok: true, costFt, provokes };
}

export function commitMove(battle: Battle, id: string, path: GridPos[], costFt: number): void {
  const c = battle.creatures[id]!;
  const turn = battle.combat?.turn;
  if (!path.length) return;
  if (hasCondition(c, "prone")) removeCondition(c, "prone");
  c.pos = path[path.length - 1]!;
  if (turn && turn.creatureId === id) turn.movementLeftFt -= costFt;
}

const CONCENTRATION_EFFECTS: EffectId[] = ["bless", "shield-of-faith", "divine-favor", "hunters-mark"];

/** Ends all effects a caster keeps up by concentration. */
export function dropConcentration(battle: Battle, casterId: string): void {
  const caster = battle.creatures[casterId];
  if (caster) caster.concentration = undefined;
  for (const c of Object.values(battle.creatures)) {
    c.effects = c.effects.filter((e) => !(e.sourceId === casterId && CONCENTRATION_EFFECTS.includes(e.id)));
  }
}

/** applyDamage + cleanup of concentration effects on the whole battlefield. */
export function damageCreature(rng: Rng, battle: Battle, target: Creature, amount: number, ctx: DamageContext = {}): HpChange {
  const hadConcentration = target.concentration;
  const change = applyDamage(rng, target, amount, ctx);
  if (hadConcentration && !target.concentration) dropConcentration(battle, target.id);
  // A druid in wolf shape changes back when the wolf's hit points are gone.
  if (target.tempHp <= 0 && target.effects.some((e) => e.id === "wild-shape")) {
    target.effects = target.effects.filter((e) => e.id !== "wild-shape");
    target.attacks = target.attacks.filter((a) => a.id !== "wolf-bite");
  }
  return change;
}
