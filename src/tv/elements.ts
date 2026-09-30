/**
 * Small elemental states after a hit – kept rare so they spice up a fight without deciding it:
 * fire may set a foe burning (1d4 at the start of its turn), cold chills (slower), lightning
 * shocks (no reaction), poison sickens for a round. Water makes wet (fire ×½, lightning ×2, see
 * rollDamage); wet and then chilled freezes solid for a round. Lightning into water jumps over.
 */
import { addCondition, addEffect, applyDamage, distanceFt, hasEffect, isActive } from "../engine/combat";
import { parseDice, rollDice } from "../engine/dice";
import type { Rng } from "../engine/rng";
import { effectiveness } from "../engine/types";
import { isOutdoorCell } from "../map/props";
import type { Battle, Creature, DamageResult } from "../shared/game";
import { cellIndex, inBounds, type DungeonMap } from "../shared/map";
import type { WorldResult } from "./environment";

/** Chance of a state after a hit of this type (small on purpose). */
export const STATUS_CHANCE = { fire: 0.2, cold: 0.25, lightning: 0.25, poison: 0.2 } as const;

const empty = (): WorldResult => ({ lines: [], hits: [] });

/** Standing in water or a puddle. */
export function inWater(map: DungeonMap, c: Creature): boolean {
  if (!c.pos || !inBounds(map, c.pos.x, c.pos.y)) return false;
  const i = cellIndex(map, c.pos.x, c.pos.y);
  return map.cells[i] === "water" || map.cells[i] === "deep" || map.surface?.[i]?.kind === "puddle";
}

function onIce(map: DungeonMap, c: Creature): boolean {
  if (!c.pos || !inBounds(map, c.pos.x, c.pos.y)) return false;
  return map.surface?.[cellIndex(map, c.pos.x, c.pos.y)]?.kind === "ice";
}

/** Water and rain make wet (for two rounds). */
export function soak(map: DungeonMap, c: Creature): boolean {
  if (!isActive(c) || !c.pos) return false;
  const rain = map.weather === "rain" && isOutdoorCell(map, cellIndex(map, c.pos.x, c.pos.y));
  if (!inWater(map, c) && !rain) return false;
  const fresh = !hasEffect(c, "wet");
  addEffect(c, "wet", 2, "water");
  return fresh;
}

/**
 * What a damage roll does on top: states, frozen, lightning jumping through water.
 * `canFreeze`: not bosses or big foes.
 */
export function afterHit(rng: Rng, map: DungeonMap, battle: Battle, attacker: Creature, target: Creature, damage: DamageResult, canFreeze: boolean): WorldResult {
  const r = empty();
  if (target.dead) return r;
  const dealt = (type: string) => damage.lines.some((l) => l.type === type && l.final > 0);
  if (isActive(target)) {
    if (dealt("fire") && !hasEffect(target, "wet") && rng.next() < STATUS_CHANCE.fire) {
      addEffect(target, "burning", 1, attacker.id);
      r.lines.push({ text: `🔥 ${target.name} fängt Feuer! (brennt nächste Runde: 1W4)`, glossarKeys: ["zustand_element"] });
    }
    if (dealt("cold")) {
      const chill = onIce(map, target) || rng.next() < STATUS_CHANCE.cold;
      if (chill && hasEffect(target, "wet") && canFreeze) {
        target.effects = target.effects.filter((e) => e.id !== "wet");
        addCondition(target, { id: "incapacitated", rounds: 1 });
        r.lines.push({ text: `🧊 ${target.name} ist klatschnass – und friert fest! Eine Runde lang kann ${target.name} nichts tun.`, glossarKeys: ["zustand_element", "zustand:incapacitated"] });
      } else if (chill) {
        addEffect(target, "chilled", 1, attacker.id);
        r.lines.push({ text: `❄️ ${target.name} ist unterkühlt (−2 Felder Bewegung).`, glossarKeys: ["zustand_element"] });
      }
    }
    if (dealt("lightning") && rng.next() < STATUS_CHANCE.lightning && battle.combat) {
      battle.combat.reactionUsed[target.id] = true;
      addEffect(target, "shocked", 1, attacker.id);
      r.lines.push({ text: `⚡ ${target.name} ist geschockt (keine Reaktion bis zum nächsten Zug).`, glossarKeys: ["zustand_element"] });
    }
    if (dealt("poison") && rng.next() < STATUS_CHANCE.poison && addCondition(target, { id: "poisoned", rounds: 1 })) {
      r.lines.push({ text: `🟢 ${target.name} ist vergiftet (eine Runde Nachteil).`, glossarKeys: ["zustand:poisoned"] });
    }
  }
  // Lightning into water: it jumps to everyone else standing in water nearby (half damage).
  const bolt = damage.lines.filter((l) => l.type === "lightning").reduce((s, l) => s + l.raw, 0);
  if (bolt > 0 && inWater(map, target)) {
    for (const o of Object.values(battle.creatures)) {
      if (o.id === target.id || !isActive(o) || !o.pos || !inWater(map, o) || distanceFt(target, o) > 10) continue;
      const dmg = Math.floor((Math.floor(bolt / 2) * effectiveness(o, "lightning")) * (hasEffect(o, "wet") && !o.vulnerabilities.includes("lightning") ? 2 : 1));
      if (dmg <= 0) continue;
      applyDamage(rng, o, dmg);
      r.hits.push({ targetId: o.id, amount: dmg });
      r.lines.push({ text: `⚡💧 Der Blitz springt durchs Wasser: ${o.name} bekommt ${dmg} Blitzschaden ab!`, glossarKeys: ["zustand_element"] });
    }
  }
  return r;
}

/** Start of a turn: burning hurts, chilled is slower (returns the feet lost). */
export function turnStart(rng: Rng, c: Creature): WorldResult & { slowFt: number } {
  const r = { ...empty(), slowFt: 0 };
  if (!isActive(c)) return r;
  if (hasEffect(c, "burning")) {
    const mult = effectiveness(c, "fire");
    const dmg = Math.floor(rollDice(rng, parseDice("1d4")).total * mult);
    c.effects = c.effects.filter((e) => e.id !== "burning");
    if (dmg > 0) {
      applyDamage(rng, c, dmg);
      r.hits.push({ targetId: c.id, amount: dmg });
      r.lines.push({ text: `🔥 ${c.name} brennt: ${dmg} Feuerschaden – dann ist das Feuer aus.`, glossarKeys: ["zustand_element"] });
    }
  }
  if (hasEffect(c, "chilled")) r.slowFt = 10;
  return r;
}
