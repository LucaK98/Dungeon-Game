/**
 * Attack rolls and damage.
 */
import type { AttackOption, AttackResult, Battle, Creature, DamageLine, DamageResult } from "../shared/game";
import type { DamagePart, DamageType } from "../shared/rules";
import type { BreakdownPart } from "../shared/types";
import { canSee } from "./vision";
import { abilityMod, advantage, d20Part, disadvantage, rollD20, sumParts, type AdvReason } from "./core";
import { parseDice, rollDice, rollDie } from "./dice";
import { coverParts, onHighGround, weatherAt } from "./terrain";
import { acParts, damageCreature, distanceFt, hasCondition, hasEffect, isActive, isIncapacitated } from "./combat";
import type { Rng } from "./rng";

const PHYSICAL: DamageType[] = ["bludgeoning", "piercing", "slashing"];

// ---------------------------------------------------------------- damage

export interface DamageInput {
  parts: DamagePart[];
  /** Flat bonuses added to the first damage part (ability modifier, …). */
  bonus?: BreakdownPart[];
  crit?: boolean;
  magical?: boolean;
  /** Label for the dice, e.g. "Langschwert". */
  source?: string;
  glossarKey?: string;
}

/** Rolls damage and applies resistance, immunity and vulnerability of the target. */
export function rollDamage(rng: Rng, input: DamageInput, target?: Creature): DamageResult {
  const lines: DamageLine[] = [];
  input.parts.forEach((part, i) => {
    const parsed = parseDice(part.dice);
    const rolled = rollDice(rng, { terms: parsed.terms, flat: 0 }, input.crit ? 2 : 1);
    const parts: BreakdownPart[] = rolled.dice.map((v, k) => ({
      label: `W${rolled.sides[k]}`,
      value: v,
      glossarKey: `w${rolled.sides[k]}`,
    }));
    if (parsed.flat) parts.push({ label: "Bonus", value: parsed.flat, glossarKey: "schaden" });
    if (i === 0 && input.bonus) parts.push(...input.bonus.filter((b) => b.value !== 0));
    const raw = Math.max(0, sumParts(parts));
    lines.push({ type: part.type, dice: rolled.dice, parts, raw, final: raw });
  });

  if (target) {
    for (const line of lines) {
      const physicalNonmagic = PHYSICAL.includes(line.type) && !input.magical;
      if (target.immunities.includes(line.type) || (physicalNonmagic && target.immuneNonmagical)) {
        line.final = 0;
        line.note = "immunity";
      } else if (target.resistances.includes(line.type) || (physicalNonmagic && target.resistsNonmagical)) {
        line.final = Math.floor(line.raw / 2);
        line.note = "resistance";
      } else if (target.vulnerabilities.includes(line.type)) {
        line.final = line.raw * 2;
        line.note = "vulnerability";
      }
    }
  }
  return { lines, total: lines.reduce((s, l) => s + l.final, 0), crit: !!input.crit };
}

/** "2d6" → "1d6" (weakened swarm). */
function halveDice(p: DamagePart): DamagePart {
  const m = /^(\d+)d(\d+)$/.exec(p.dice);
  return m ? { ...p, dice: `${Math.max(1, Math.floor(Number(m[1]) / 2))}d${m[2]}` } : p;
}

// ---------------------------------------------------------------- advantage

function hasAllyNear(battle: Battle, attacker: Creature, target: Creature): boolean {
  return Object.values(battle.creatures).some(
    (o) => o.id !== attacker.id && o.side === attacker.side && !isIncapacitated(o) && distanceFt(o, target) <= 5,
  );
}

/** All reasons for advantage/disadvantage on this attack, with glossary keys. */
export function attackReasons(battle: Battle, attacker: Creature, target: Creature, option: AttackOption): AdvReason[] {
  const r: AdvReason[] = [];
  const dist = distanceFt(attacker, target);
  const ranged = option.kind === "ranged" || (option.thrown === true && dist > option.reachFt);

  if (hasCondition(attacker, "poisoned")) r.push(disadvantage("Du bist vergiftet", "zustand:poisoned"));
  if (hasCondition(attacker, "blinded")) r.push(disadvantage("Du bist blind", "zustand:blinded"));
  if (hasCondition(attacker, "frightened")) r.push(disadvantage("Du hast Angst", "zustand:frightened"));
  if (hasCondition(attacker, "prone")) r.push(disadvantage("Du liegst am Boden", "zustand:prone"));
  if (hasCondition(attacker, "restrained")) r.push(disadvantage("Du bist festgesetzt", "zustand:restrained"));
  if (hasCondition(attacker, "invisible")) r.push(advantage("Du bist unsichtbar", "zustand:invisible"));

  if (hasCondition(target, "prone")) {
    r.push(dist <= 5 ? advantage("Ziel liegt am Boden", "zustand:prone") : disadvantage("Ziel liegt am Boden (Fernkampf)", "zustand:prone"));
  }
  for (const id of ["blinded", "paralyzed", "restrained", "stunned", "unconscious"] as const) {
    if (hasCondition(target, id)) r.push(advantage(`Ziel ist ${label(id)}`, `zustand:${id}`));
  }
  if (hasCondition(target, "invisible")) r.push(disadvantage("Ziel ist unsichtbar", "zustand:invisible"));
  if (hasEffect(target, "dodge")) r.push(disadvantage("Ziel weicht aus", "ausweichen"));
  if (!canSee(battle, attacker, target)) r.push(disadvantage("Zu dunkel: du siehst das Ziel nicht", "dunkelheit"));
  if (!canSee(battle, target, attacker)) r.push(advantage("Das Ziel sieht dich im Dunkeln nicht", "dunkelheit"));
  if (hasEffect(target, "guiding-bolt")) r.push(advantage("Lenkendes Geschoss leuchtet auf dem Ziel", "zauber:guiding-bolt"));
  if (hasEffect(target, "distracted")) r.push(advantage("Ziel ist abgelenkt", "abgelenkt"));
  if (hasEffect(attacker, "helped")) r.push(advantage("Ein Freund hilft dir", "helfen"));
  if (hasEffect(attacker, "hampered")) r.push(disadvantage("Du bist behindert (entwaffnet, geblendet …)", "behindert"));
  if (hasEffect(attacker, "enraged")) r.push(advantage("Wütend: greift mit voller Wucht an", "wuetend"));

  if (ranged && dist > 30 && weatherAt(battle, attacker, target) === "fog") r.push(disadvantage("Nebel: auf die Entfernung siehst du kaum etwas", "wetter"));
  if (ranged && onHighGround(battle, attacker.pos) && !onHighGround(battle, target.pos)) {
    r.push(advantage("Du stehst erhöht und schießt nach unten", "erhoeht"));
  }
  if (ranged) {
    const enemyNear = Object.values(battle.creatures).some(
      (o) => o.side !== attacker.side && o.side !== "neutral" && !isIncapacitated(o) && distanceFt(attacker, o) <= 5,
    );
    if (enemyNear) r.push(disadvantage("Gegner direkt neben dir", "fernkampf"));
    if (option.rangeFt && dist > option.rangeFt.normal) r.push(disadvantage("Große Entfernung", "reichweite"));
  }
  if (attacker.traits.includes("pack-tactics") && hasAllyNear(battle, attacker, target)) {
    r.push(advantage("Rudeltaktik: ein Verbündeter steht am Ziel", "monstermerkmal:pack-tactics"));
  }
  return r;
}

function label(id: string): string {
  return { blinded: "blind", paralyzed: "gelähmt", restrained: "festgesetzt", stunned: "betäubt", unconscious: "bewusstlos" }[id] ?? id;
}

export function inRange(attacker: Creature, target: Creature, option: AttackOption): boolean {
  const dist = distanceFt(attacker, target);
  if (dist <= option.reachFt) return true;
  const max = option.rangeFt ? (option.rangeFt.long ?? option.rangeFt.normal) : 0;
  return dist <= max;
}

// ---------------------------------------------------------------- attack

export interface AttackOptions {
  /** Paladin: spend a spell slot of this level for Divine Smite. */
  smiteSlot?: number;
  extraReasons?: AdvReason[];
  /** Double damage against dragons (Drachenlanze). */
  dragonSlayer?: boolean;
  /** Silvered weapon (Silberstaub): counts as magical against werewolves & co. */
  silvered?: boolean;
}

function critThreshold(attacker: Creature): number {
  return attacker.pc?.features.includes("improved-critical") ? 19 : 20;
}

function sneakAttackAllowed(battle: Battle, attacker: Creature, target: Creature, option: AttackOption, mode: string): boolean {
  if (attacker.pc?.classId !== "rogue") return false;
  if (!(option.finesse || option.kind === "ranged")) return false;
  if (mode === "disadvantage") return false;
  if (battle.combat?.turn.creatureId === attacker.id && battle.combat.turn.sneakAttackUsed) return false;
  return mode === "advantage" || hasAllyNear(battle, attacker, target);
}

export function resolveAttack(
  rng: Rng,
  battle: Battle,
  attacker: Creature,
  target: Creature,
  option: AttackOption,
  opts: AttackOptions = {},
): AttackResult {
  const reasons = [...attackReasons(battle, attacker, target, option), ...(opts.extraReasons ?? [])];
  const roll = rollD20(rng, reasons, attacker.pc?.raceId === "halfling");
  const parts: BreakdownPart[] = [d20Part(roll), ...option.toHit];
  if (hasEffect(attacker, "bless")) parts.push({ label: "Segen", value: rollDie(rng, 4), glossarKey: "zauber:bless" });
  // Strong wind blows arrows and bolts off course (not spells).
  if (option.kind === "ranged" && option.source !== "spell" && weatherAt(battle, attacker, target) === "wind") parts.push({ label: "Wind", value: -2, glossarKey: "wetter" });
  const total = sumParts(parts);
  // Furniture between attacker and target (not on top of a cover spell like "Deckung suchen").
  const targetAcParts = [...acParts(target), ...(hasEffect(target, "cover") ? [] : coverParts(battle, attacker, target))];
  const targetAc = sumParts(targetAcParts);

  // Guiding bolt's light is used up by the next attack.
  target.effects = target.effects.filter((e) => e.id !== "guiding-bolt" && e.id !== "distracted");
  attacker.effects = attacker.effects.filter((e) => e.id !== "helped" && e.id !== "enraged");

  let crit = roll.natural >= critThreshold(attacker);
  const fumble = roll.natural === 1;
  const hit = !fumble && (crit || total >= targetAc);
  // Hits against paralysed or unconscious targets from up close are always critical.
  if (hit && distanceFt(attacker, target) <= 5 && (hasCondition(target, "paralyzed") || hasCondition(target, "unconscious"))) {
    crit = true;
  }

  const result: AttackResult = {
    type: "attack",
    attackerId: attacker.id,
    targetId: target.id,
    optionId: option.id,
    roll,
    parts,
    total,
    targetAc,
    acParts: targetAcParts,
    hit,
    crit: hit && crit,
  };
  if (!hit) return result;

  // Swarms get weaker as they shrink: half the dice at half hit points or less.
  const weakSwarm = attacker.traits.includes("swarm") && attacker.hp <= attacker.maxHp / 2;
  const dmgParts: DamagePart[] = weakSwarm ? option.damage.map(halveDice) : [...option.damage];
  const bonus = [...option.damageBonus];
  // The home village's smithy sharpens every hero's weapons.
  if (attacker.traits.includes("dorfschmiede") && option.source === "weapon") bonus.push({ label: "Dorfschmiede", value: 1, glossarKey: "heimatdorf" });
  if (sneakAttackAllowed(battle, attacker, target, option, roll.mode)) {
    // 1d6 at level 1, one more every two levels (2d6 at 3, 3d6 at 5).
    const dice = Math.ceil(attacker.pc!.level / 2);
    dmgParts.push({ dice: `${dice}d6`, type: option.damage[0]!.type });
    if (battle.combat?.turn.creatureId === attacker.id) battle.combat.turn.sneakAttackUsed = true;
  }
  if (option.source === "weapon" && hasEffect(attacker, "divine-favor")) dmgParts.push({ dice: "1d4", type: "radiant" });
  // Hunter's Mark: +1d6 on weapon hits against the marked creature.
  if (option.source === "weapon" && target.effects.some((e) => e.id === "hunters-mark" && e.sourceId === attacker.id)) dmgParts.push({ dice: "1d6", type: option.damage[0]!.type });
  // Colossus Slayer (ranger, Hunter): once per turn +1d8 against a creature that is already hurt.
  if (option.source === "weapon" && attacker.pc?.features.includes("colossus-slayer") && target.hp < target.maxHp && !(battle.combat?.turn.creatureId === attacker.id && battle.combat.turn.sneakAttackUsed)) {
    dmgParts.push({ dice: "1d8", type: option.damage[0]!.type });
    if (battle.combat?.turn.creatureId === attacker.id) battle.combat.turn.sneakAttackUsed = true;
  }
  if (opts.smiteSlot && option.kind === "melee") {
    const undeadBonus = target.creatureType === "undead" ? 1 : 0;
    dmgParts.push({ dice: `${Math.min(5, 1 + opts.smiteSlot + undeadBonus)}d8`, type: "radiant" });
  }

  const damage = rollDamage(
    rng,
    { parts: dmgParts, bonus, crit: result.crit, magical: !!option.magical || (!!opts.silvered && option.source === "weapon") },
    target,
  );
  if (opts.dragonSlayer && target.creatureType === "dragon") {
    for (const l of damage.lines) l.final *= 2;
    damage.total *= 2;
  }
  // Deflect Missiles (monk, level 3): a ranged weapon hit is reduced by 1d10 + Dex + level (reaction).
  if (target.pc?.features.includes("deflect-missiles") && option.kind === "ranged" && option.source !== "spell" && battle.combat && !battle.combat.reactionUsed[target.id] && damage.total > 0 && isActive(target)) {
    battle.combat.reactionUsed[target.id] = true;
    const cut = Math.min(damage.total, rollDamage(rng, { parts: [{ dice: "1d10", type: "bludgeoning" }] }).total + abilityMod(target.abilities.DEX) + target.pc.level);
    let left = cut;
    for (const l of damage.lines) {
      const off = Math.min(l.final, left);
      l.final -= off;
      left -= off;
    }
    damage.total -= cut;
    result.deflected = cut;
  }
  // Uncanny Dodge (rogue, level 5): the first hit each round is halved (uses the reaction).
  if (target.pc?.features.includes("uncanny-dodge") && battle.combat && !battle.combat.reactionUsed[target.id] && damage.total > 0 && isActive(target)) {
    battle.combat.reactionUsed[target.id] = true;
    for (const l of damage.lines) l.final = Math.floor(l.final / 2);
    damage.total = Math.floor(damage.total / 2);
    result.uncannyDodge = true;
  }
  result.damage = damage;
  result.hp = damageCreature(rng, battle, target, damage.total, {
    crit: result.crit,
    types: damage.lines.map((l) => l.type),
  });
  return result;
}
