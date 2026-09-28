/**
 * Simple tactical behaviour for monsters (and for auto-played heroes in simulations):
 * go to the nearest enemy, attack, use a breath weapon on groups, flee when turned.
 */
import type { AttackOption, Battle, Creature, GridPos } from "../shared/game";
import { perform, rollRecharges, type ActionOutcome, type CombatAction } from "./actions";
import { inRange } from "./attack";
import { distanceFt, hasEffect, isActive, isIncapacitated } from "./combat";
import { averageOf } from "./dice";
import { findPath, type Walkable } from "./grid";
import { pathCost, stepCost } from "./terrain";
import type { Rng } from "./rng";

export interface AiContext {
  walkable: Walkable;
}

/** Enemies of `c` that take part in the current fight. */
function enemiesOf(battle: Battle, c: Creature): Creature[] {
  const inFight = battle.combat ? new Set(battle.combat.order.map((o) => o.creatureId)) : undefined;
  return Object.values(battle.creatures).filter(
    (o) => o.side !== c.side && o.side !== "neutral" && !o.dead && o.pos && (!inFight || inFight.has(o.id)),
  );
}

function alliesOf(battle: Battle, c: Creature): Creature[] {
  return Object.values(battle.creatures).filter((o) => o.side === c.side && o.id !== c.id && !o.dead);
}

function avgDamage(o: AttackOption): number {
  return o.damage.reduce((s, d) => s + averageOf(d.dice), 0) + o.damageBonus.reduce((s, b) => s + b.value, 0);
}

function pickTarget(battle: Battle, c: Creature): Creature | undefined {
  const enemies = enemiesOf(battle, c);
  // A companion goes for the enemy its hero pointed at.
  const focus = c.focusId ? enemies.find((e) => e.id === c.focusId && isActive(e)) : undefined;
  if (focus) return focus;
  const standing = enemies.filter(isActive);
  const pool = standing.length ? standing : enemies;
  return pool.sort((a, b) => distanceFt(c, a) - distanceFt(c, b) || a.hp - b.hp)[0];
}

/** Best melee weapon: the strongest one, preferring weapons that already reach the target. */
function bestMelee(c: Creature, target: Creature): AttackOption | undefined {
  const usable = c.attacks.filter((o) => o.kind === "melee" && o.source !== "unarmed");
  const reach = usable.filter((o) => distanceFt(c, target) <= o.reachFt);
  const list = (reach.length ? reach : usable).sort((a, b) => avgDamage(b) - avgDamage(a) || b.reachFt - a.reachFt);
  return list[0] ?? c.attacks.find((o) => o.kind === "melee");
}

/** Walk as far along `path` as movement allows, stopping on a free square. */
function truncate(battle: Battle, c: Creature, path: GridPos[]): GridPos[] {
  let budget = Math.floor((battle.combat?.turn.movementLeftFt ?? c.speedFt) / 5);
  const out: GridPos[] = [];
  for (const p of path) {
    budget -= stepCost(battle, p);
    if (budget < 0) break;
    out.push(p);
  }
  const taken = new Set(
    Object.values(battle.creatures)
      .filter((o) => o.id !== c.id && o.pos && !(o.kind === "monster" && !isActive(o)) && !o.dead)
      .map((o) => `${o.pos!.x},${o.pos!.y}`),
  );
  while (out.length && taken.has(`${out[out.length - 1]!.x},${out[out.length - 1]!.y}`)) out.pop();
  return out;
}

function act(rng: Rng, battle: Battle, c: Creature, action: CombatAction, log: ActionOutcome[]): ActionOutcome {
  const o = perform(rng, battle, c.id, action);
  log.push(o);
  return o;
}

function moveTowards(rng: Rng, battle: Battle, c: Creature, target: Creature, reachFt: number, ctx: AiContext, log: ActionOutcome[]): void {
  if (distanceFt(c, target) <= reachFt) return;
  const path = findPath(battle, c, (p) => distanceFt(c, target, p) <= reachFt, ctx.walkable);
  if (!path) return;
  const steps = truncate(battle, c, path);
  if (steps.length) act(rng, battle, c, { type: "move", path: steps }, log);
}

function flee(rng: Rng, battle: Battle, c: Creature, from: Creature, ctx: AiContext, log: ActionOutcome[]): void {
  const away = findPath(
    battle,
    c,
    (p) => distanceFt(c, from, p) >= distanceFt(c, from) + 25,
    ctx.walkable,
    12,
  );
  if (!away) {
    act(rng, battle, c, { type: "dodge" }, log);
    return;
  }
  act(rng, battle, c, { type: "disengage" }, log);
  const steps = truncate(battle, c, away);
  if (steps.length) act(rng, battle, c, { type: "move", path: steps }, log);
}

// ---------------------------------------------------------------- heroes (simulation only)

function heroSpecial(rng: Rng, battle: Battle, c: Creature, target: Creature, log: ActionOutcome[]): boolean {
  const pc = c.pc!;
  const slot1 = (pc.spellSlots[0] ?? 0) > 0;
  const downedAlly = alliesOf(battle, c).find((a) => a.hp === 0 && !a.dead && a.kind === "pc");
  if (downedAlly && pc.spells.includes("healing-word") && slot1 && distanceFt(c, downedAlly) <= 60) {
    act(rng, battle, c, { type: "cast", spellId: "healing-word", targetIds: [downedAlly.id] }, log);
  }
  if (pc.resources["second-wind"] && c.hp < c.maxHp / 2 && pc.resources["second-wind"].used === 0) {
    act(rng, battle, c, { type: "second-wind" }, log);
  }
  const left = (id: string) => (pc.resources[id] ? pc.resources[id].max - pc.resources[id].used : 0);
  // Bard: inspire a friend nearby (bonus action), then fight on.
  const friend = alliesOf(battle, c).find((a) => a.id !== c.id && isActive(a) && distanceFt(c, a) <= 60 && !a.effects.some((e) => e.id === "helped"));
  if (left("bardic-inspiration") && friend) act(rng, battle, c, { type: "bardic-inspiration", targetId: friend.id }, log);
  // Ranger: mark the target (bonus action).
  if (pc.spells.includes("hunters-mark") && slot1 && !c.concentration && distanceFt(c, target) <= 90) {
    act(rng, battle, c, { type: "cast", spellId: "hunters-mark", targetIds: [target.id] }, log);
  }
  // Druid: turn into a wolf for the fight.
  if (left("wild-shape") && !c.effects.some((e) => e.id === "wild-shape") && distanceFt(c, target) <= 30) {
    act(rng, battle, c, { type: "wild-shape" }, log);
    return true;
  }
  const cantrip = ["produce-flame", "vicious-mockery"].find((s) => pc.spells.includes(s));
  if (cantrip && !c.effects.some((e) => e.id === "wild-shape") && distanceFt(c, target) > 5 && distanceFt(c, target) <= (cantrip === "produce-flame" ? 30 : 60)) {
    act(rng, battle, c, { type: "cast", spellId: cantrip, targetIds: [target.id] }, log);
    return true;
  }
  if (pc.spells.includes("magic-missile") && slot1 && distanceFt(c, target) <= 120) {
    act(rng, battle, c, { type: "cast", spellId: "magic-missile", targetIds: [target.id, target.id, target.id] }, log);
    return true;
  }
  if (pc.spells.includes("guiding-bolt") && slot1 && distanceFt(c, target) <= 120 && distanceFt(c, target) > 5) {
    act(rng, battle, c, { type: "cast", spellId: "guiding-bolt", targetIds: [target.id] }, log);
    return true;
  }
  if (pc.spells.includes("fire-bolt") && pc.classId === "wizard" && distanceFt(c, target) <= 120) {
    act(rng, battle, c, { type: "cast", spellId: "fire-bolt", targetIds: [target.id] }, log);
    return true;
  }
  if (pc.spells.includes("sacred-flame") && distanceFt(c, target) > 5 && distanceFt(c, target) <= 60) {
    act(rng, battle, c, { type: "cast", spellId: "sacred-flame", targetIds: [target.id] }, log);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- main

/** Plays one full turn for `id`. Returns everything that happened. */
export function runAutoTurn(rng: Rng, battle: Battle, id: string, ctx: AiContext): ActionOutcome[] {
  const log: ActionOutcome[] = [];
  const c = battle.creatures[id]!;
  if (isIncapacitated(c)) return log;
  rollRecharges(rng, c);

  // Turned undead run away from the cleric.
  const turned = c.effects.find((e) => e.id === "turned");
  if (turned) {
    const cleric = battle.creatures[turned.sourceId];
    if (cleric) flee(rng, battle, c, cleric, ctx, log);
    return log;
  }

  let target = pickTarget(battle, c);
  if (!target) return log;

  // Get up first – lying on the ground gives disadvantage.
  if (c.conditions.some((x) => x.id === "prone") && c.speedFt > 0) act(rng, battle, c, { type: "stand-up" }, log);

  // Cowardly monsters flee at low health (not bosses, not mindless undead).
  if (c.kind === "monster" && c.hp <= c.maxHp / 4 && c.creatureType !== "undead" && c.maxHp < 40 && !hasEffect(c, "dodge")) {
    flee(rng, battle, c, target, ctx, log);
    return log;
  }

  // Breath weapon against groups.
  const breath = c.saveActions.find((s) => s.available);
  if (breath) {
    const size = breath.area?.sizeFt ?? 15;
    const inArea = enemiesOf(battle, c).filter((e) => isActive(e) && distanceFt(c, e) <= size);
    if (inArea.length >= 2 || (inArea.length === 1 && rng.next() < 0.5)) {
      act(rng, battle, c, { type: "save-action", actionId: breath.id, targetIds: inArea.map((e) => e.id) }, log);
      return log;
    }
  }

  if (c.pc && heroSpecial(rng, battle, c, target, log)) return log;

  let melee = bestMelee(c, target);
  const ranged = c.attacks.find((o) => o.kind === "ranged");
  const meleeReach = melee?.reachFt ?? 5;
  const pathToMelee = melee ? findPath(battle, c, (p) => distanceFt(c, target!, p) <= meleeReach, ctx.walkable) : undefined;
  const canReachMelee = !!melee && pathToMelee !== undefined && pathCost(battle, pathToMelee) * 5 <= (battle.combat?.turn.movementLeftFt ?? c.speedFt);
  const preferRanged = !!ranged && (!canReachMelee || (c.pc?.classId === "rogue" && distanceFt(c, target) > 5));

  let option: AttackOption | undefined;
  if (preferRanged && ranged && inRange(c, target, ranged)) {
    option = ranged;
  } else if (melee) {
    moveTowards(rng, battle, c, target, melee.reachFt, ctx, log);
    if (c.dead || isIncapacitated(c)) return log;
    melee = bestMelee(c, target) ?? melee;
    if (inRange(c, target, melee)) option = melee;
  }
  if (!option) {
    // Still too far: dash towards the target.
    act(rng, battle, c, { type: "dash" }, log);
    if (melee) moveTowards(rng, battle, c, target, melee.reachFt, ctx, log);
    return log;
  }

  // Attack (monsters with multiattack keep going through their list).
  const sequence = c.multiattack?.length ? c.multiattack : c.pc?.features.includes("extra-attack") ? [option.id, option.id] : [option.id];
  for (let i = 0; i < sequence.length; i++) {
    if (!target || !isActive(target)) {
      target = pickTarget(battle, c);
      if (!target || !isActive(target)) break;
    }
    const wanted = i === 0 ? option : (c.attacks.find((a) => a.id === sequence[i]) ?? option);
    const use = inRange(c, target, wanted) ? wanted : option;
    if (!inRange(c, target, use)) break;
    const smite =
      c.pc?.features.includes("divine-smite") && use.kind === "melee" && (c.pc.spellSlots[0] ?? 0) > 0 && target.hp > 8
        ? { smiteSlot: 1 }
        : {};
    const o = act(rng, battle, c, { type: "attack", targetId: target.id, optionId: use.id, ...smite }, log);
    if (!o.ok) break;
  }

  // Monks follow up with their fists (Flurry of Blows with ki, otherwise Martial Arts).
  if (c.pc?.features.includes("martial-arts") && target && isActive(target) && distanceFt(c, target) <= 5) {
    const ki = c.pc.resources["ki"];
    act(rng, battle, c, { type: ki && ki.used < ki.max ? "flurry-of-blows" : "martial-arts", targetId: target.id }, log);
  }
  // Rogues slip away after hitting in melee.
  if (c.pc?.features.includes("cunning-action") && distanceFt(c, target!) <= 5) {
    act(rng, battle, c, { type: "disengage", bonus: true }, log);
  }
  return log;
}
