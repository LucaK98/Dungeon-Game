/**
 * Everything a creature can do on its turn, with the action economy
 * (1 action, 1 bonus action, movement, 1 reaction per round).
 * The host calls `perform` for every player action and every monster decision.
 */
import type { AttackResult, Battle, CheckResult, Creature, GridPos, HpChange, SpellResult } from "../shared/game";
import type { BreakdownPart } from "../shared/types";
import { inRange, resolveAttack, rollDamage } from "./attack";
import {
  addCondition,
  addEffect,
  currentSpeedFt,
  damageCreature,
  distanceFt,
  heal,
  commitMove,
  isIncapacitated,
  planMove,
  type MoveResult,
} from "./combat";
import { abilityMod, savingThrow, skillCheck, sumParts } from "./core";
import { getItem, getSpell } from "./data";
import { parseDice, rollDice } from "./dice";
import type { Rng } from "./rng";
import { castSpell, spellSaveDcParts, validateCast } from "./spells";

export type CombatAction =
  | { type: "move"; path: GridPos[] }
  | { type: "attack"; targetId: string; optionId: string; smiteSlot?: number; dragonSlayer?: boolean }
  | { type: "cast"; spellId: string; slotLevel?: number; targetIds: string[] }
  | { type: "save-action"; actionId: string; targetIds: string[] }
  | { type: "dash"; bonus?: boolean }
  | { type: "disengage"; bonus?: boolean }
  | { type: "dodge" }
  | { type: "hide" }
  | { type: "second-wind" }
  | { type: "action-surge" }
  | { type: "lay-on-hands"; targetId: string; amount: number }
  | { type: "turn-undead"; targetIds: string[] }
  | { type: "use-item"; itemId: string; targetId?: string }
  | { type: "stand-up" };

export type ActionOutcome =
  | { ok: false; reason: string }
  | ({ ok: true; actorId: string; cost: "action" | "bonus" | "move" | "free" } & ActionDetail);

export type ActionDetail =
  | { kind: "move"; move: MoveResult; opportunityAttacks: AttackResult[] }
  | { kind: "attack"; attack: AttackResult }
  | { kind: "spell"; spell: SpellResult }
  | { kind: "save-action"; actionId: string; dc: number; results: { targetId: string; save: CheckResult; hp: HpChange; damage: number }[] }
  | { kind: "simple"; what: "dash" | "disengage" | "dodge" | "action-surge" | "stand-up" }
  | { kind: "hide"; check: CheckResult }
  | { kind: "heal"; what: "second-wind" | "lay-on-hands" | "potion"; targetId: string; parts: BreakdownPart[]; total: number; hp: HpChange }
  | { kind: "turn-undead"; dc: number; results: { targetId: string; save: CheckResult; turned: boolean }[] };

const fail = (reason: string): ActionOutcome => ({ ok: false, reason });

function spend(battle: Battle, actor: Creature, cost: "action" | "bonus"): string | undefined {
  const turn = battle.combat?.turn;
  if (!turn || turn.creatureId !== actor.id) return undefined; // outside combat nothing is limited
  if (cost === "action") {
    if (turn.actions <= 0) return "Du hast deine Aktion in diesem Zug schon benutzt.";
    turn.actions--;
  } else {
    if (!turn.bonusAction) return "Du hast deine Bonusaktion in diesem Zug schon benutzt.";
    turn.bonusAction = false;
  }
  return undefined;
}

function useResource(actor: Creature, id: string, amount = 1): string | undefined {
  const r = actor.pc?.resources[id];
  if (!r) return "Diese Fähigkeit hast du nicht.";
  if (r.max - r.used < amount) return "Diese Fähigkeit ist aufgebraucht. Sie lädt sich bei einer Rast wieder auf.";
  r.used += amount;
  return undefined;
}

/** Validates and performs one action. Never throws for invalid player input. */
export function perform(rng: Rng, battle: Battle, actorId: string, action: CombatAction): ActionOutcome {
  const actor = battle.creatures[actorId];
  if (!actor || actor.dead) return fail("Diese Figur ist nicht mehr im Spiel.");
  const turn = battle.combat?.turn;
  const myTurn = !battle.combat || turn?.creatureId === actorId;
  if (!myTurn) return fail("Du bist gerade nicht am Zug.");
  if (isIncapacitated(actor)) return fail("Du kannst gerade nichts tun.");
  const ok = { ok: true as const, actorId };

  switch (action.type) {
    case "move": {
      if (currentSpeedFt(actor) === 0) return fail("Du kannst dich gerade nicht bewegen.");
      const move = planMove(battle, actorId, action.path);
      if (!move.ok) return fail(move.reason ?? "Bewegung nicht möglich.");
      // Opportunity attacks hit while the creature is still in reach, before it gets away.
      const opportunityAttacks: AttackResult[] = [];
      for (const enemyId of move.provokes) {
        const enemy = battle.creatures[enemyId]!;
        const option = enemy.attacks.find((a) => a.kind === "melee");
        if (!option || isIncapacitated(actor)) continue;
        if (battle.combat) battle.combat.reactionUsed[enemyId] = true;
        opportunityAttacks.push(resolveAttack(rng, battle, enemy, actor, option));
      }
      if (!isIncapacitated(actor)) commitMove(battle, actorId, action.path, move.costFt);
      return { ...ok, cost: "move", kind: "move", move, opportunityAttacks };
    }

    case "attack": {
      const target = battle.creatures[action.targetId];
      if (!target || target.dead) return fail("Dieses Ziel gibt es nicht mehr.");
      if (target.id === actor.id) return fail("Du kannst dich nicht selbst angreifen.");
      const option = actor.attacks.find((a) => a.id === action.optionId);
      if (!option) return fail("Diese Waffe hast du nicht.");
      if (!inRange(actor, target, option)) return fail(`${target.name} ist außer Reichweite.`);
      if (turn && turn.creatureId === actorId) {
        if (turn.attacksLeft > 0) {
          turn.attacksLeft--;
        } else {
          const err = spend(battle, actor, "action");
          if (err) return fail(err);
          turn.attacksLeft = Math.max(0, (actor.multiattack?.length ?? 1) - 1);
        }
      }
      let smiteSlot: number | undefined;
      if (action.smiteSlot) {
        const pc = actor.pc;
        if (!pc?.features.includes("divine-smite")) return fail("Du beherrschst keinen Göttlichen Schlag.");
        if ((pc.spellSlots[action.smiteSlot - 1] ?? 0) <= 0) return fail("Kein Zauberplatz für den Göttlichen Schlag frei.");
        smiteSlot = action.smiteSlot;
      }
      const attack = resolveAttack(rng, battle, actor, target, option, {
        ...(smiteSlot ? { smiteSlot } : {}),
        ...(action.dragonSlayer ? { dragonSlayer: true } : {}),
      });
      // The smite slot is only spent on a hit.
      if (smiteSlot && attack.hit && option.kind === "melee") actor.pc!.spellSlots[smiteSlot - 1]!--;
      return { ...ok, cost: "action", kind: "attack", attack };
    }

    case "cast": {
      const err = validateCast(battle, actor, action);
      if (err) return fail(err);
      const spell = getSpell(action.spellId);
      const costErr = spend(battle, actor, spell.castingTime === "bonus" ? "bonus" : "action");
      if (costErr) return fail(costErr);
      const result = castSpell(rng, battle, actor, action);
      return { ...ok, cost: spell.castingTime === "bonus" ? "bonus" : "action", kind: "spell", spell: result };
    }

    case "save-action": {
      const sa = actor.saveActions.find((s) => s.id === action.actionId);
      if (!sa) return fail("Unbekannte Fähigkeit.");
      if (!sa.available) return fail("Diese Fähigkeit lädt sich noch auf.");
      const err = spend(battle, actor, "action");
      if (err) return fail(err);
      if (sa.recharge) sa.available = false;
      const shared = rollDamage(rng, { parts: sa.damage, magical: true });
      const results = [];
      for (const id of action.targetIds) {
        const t = battle.creatures[id];
        if (!t || t.dead) continue;
        const save = savingThrow(rng, t, sa.save.ability, sa.save.dc);
        let dmg = 0;
        for (const line of shared.lines) {
          let v = line.raw;
          if (t.immunities.includes(line.type)) v = 0;
          else if (t.resistances.includes(line.type)) v = Math.floor(v / 2);
          else if (t.vulnerabilities.includes(line.type)) v *= 2;
          dmg += v;
        }
        if (save.success) dmg = sa.save.onSuccess === "half" ? Math.floor(dmg / 2) : 0;
        const hp = damageCreature(rng, battle, t, dmg, { types: shared.lines.map((l) => l.type) });
        results.push({ targetId: id, save, hp, damage: dmg });
      }
      return { ...ok, cost: "action", kind: "save-action", actionId: sa.id, dc: sa.save.dc, results };
    }

    case "dash":
    case "disengage": {
      if (action.bonus && !(actor.pc?.features.includes("cunning-action") || actor.traits.includes("nimble-escape") || actor.traits.includes("cunning-action"))) {
        return fail("Nur Schurken können das als Bonusaktion.");
      }
      const err = spend(battle, actor, action.bonus ? "bonus" : "action");
      if (err) return fail(err);
      if (action.type === "dash" && turn) turn.movementLeftFt += currentSpeedFt(actor);
      if (action.type === "disengage") addEffect(actor, "disengage", 1, actor.id);
      return { ...ok, cost: action.bonus ? "bonus" : "action", kind: "simple", what: action.type };
    }

    case "dodge": {
      const err = spend(battle, actor, "action");
      if (err) return fail(err);
      addEffect(actor, "dodge", 99, actor.id);
      return { ...ok, cost: "action", kind: "simple", what: "dodge" };
    }

    case "hide": {
      const bonus = actor.pc?.features.includes("cunning-action") || actor.traits.includes("nimble-escape");
      const err = spend(battle, actor, bonus ? "bonus" : "action");
      if (err) return fail(err);
      // Hidden against the best passive perception of the enemies.
      const watchers = Object.values(battle.creatures).filter((c) => c.side !== actor.side && !c.dead);
      const dc = Math.max(10, ...watchers.map((w) => 10 + abilityMod(w.abilities.WIS)));
      const check = skillCheck(rng, actor, "stealth", dc);
      if (check.success) addCondition(actor, { id: "invisible", rounds: 1, sourceId: actor.id });
      return { ...ok, cost: bonus ? "bonus" : "action", kind: "hide", check };
    }

    case "second-wind": {
      if (!actor.pc?.resources["second-wind"]) return fail("Nur Kämpfer können durchatmen.");
      const err = spend(battle, actor, "bonus");
      if (err) return fail(err);
      const resErr = useResource(actor, "second-wind");
      if (resErr) {
        if (turn) turn.bonusAction = true;
        return fail(resErr);
      }
      const d = rollDice(rng, parseDice("1d10"));
      const parts: BreakdownPart[] = [
        { label: "W10", value: d.total, glossarKey: "w10" },
        { label: "Stufe", value: actor.pc.level, glossarKey: "stufe" },
      ];
      const total = sumParts(parts);
      return { ...ok, cost: "bonus", kind: "heal", what: "second-wind", targetId: actor.id, parts, total, hp: heal(actor, total) };
    }

    case "action-surge": {
      const resErr = useResource(actor, "action-surge");
      if (resErr) return fail(resErr);
      if (turn) turn.actions++;
      return { ...ok, cost: "free", kind: "simple", what: "action-surge" };
    }

    case "lay-on-hands": {
      const target = battle.creatures[action.targetId];
      if (!target || target.dead) return fail("Ungültiges Ziel.");
      if (distanceFt(actor, target) > 5) return fail("Du musst dein Ziel berühren können.");
      if (target.creatureType === "undead") return fail("Handauflegen wirkt nicht bei Untoten.");
      const pool = actor.pc?.resources["lay-on-hands"];
      if (!pool) return fail("Nur Ritter können Hände auflegen.");
      const amount = Math.min(action.amount, pool.max - pool.used, target.maxHp - target.hp);
      if (amount <= 0) return fail(pool.max - pool.used <= 0 ? "Dein Heilvorrat ist leer." : "Das Ziel ist schon unverletzt.");
      const err = spend(battle, actor, "action");
      if (err) return fail(err);
      pool.used += amount;
      const parts = [{ label: "Aus dem Heilvorrat", value: amount, glossarKey: "merkmal:lay-on-hands" }];
      return { ...ok, cost: "action", kind: "heal", what: "lay-on-hands", targetId: target.id, parts, total: amount, hp: heal(target, amount) };
    }

    case "turn-undead": {
      if (!actor.pc?.resources["channel-divinity"]) return fail("Nur Kleriker ab Stufe 2 können Untote vertreiben.");
      const resErr = useResource(actor, "channel-divinity");
      if (resErr) return fail(resErr);
      const err = spend(battle, actor, "action");
      if (err) {
        actor.pc.resources["channel-divinity"]!.used--;
        return fail(err);
      }
      const dcParts = spellSaveDcParts(actor, "sacred-flame");
      const dc = sumParts(dcParts);
      const results = [];
      for (const id of action.targetIds) {
        const t = battle.creatures[id];
        if (!t || t.dead || t.creatureType !== "undead" || distanceFt(actor, t) > 30) continue;
        const save = savingThrow(rng, t, "WIS", dc);
        if (!save.success) {
          addEffect(t, "turned", 10, actor.id);
          addCondition(t, { id: "frightened", rounds: 10, sourceId: actor.id });
        }
        results.push({ targetId: id, save, turned: !save.success });
      }
      return { ...ok, cost: "action", kind: "turn-undead", dc, results };
    }

    case "use-item": {
      const entry = actor.pc?.inventory.find((i) => i.itemId === action.itemId && i.qty > 0);
      if (!entry) return fail("Diesen Gegenstand hast du nicht.");
      const item = getItem(action.itemId);
      if (item.kind !== "potion" || !item.heal) return fail("Diesen Gegenstand kann man im Kampf nicht so benutzen.");
      const target = battle.creatures[action.targetId ?? actor.id];
      if (!target || target.dead) return fail("Ungültiges Ziel.");
      if (distanceFt(actor, target) > 5 && target.id !== actor.id) return fail("Du musst direkt neben dem Ziel stehen.");
      const err = spend(battle, actor, "action");
      if (err) return fail(err);
      entry.qty--;
      actor.pc!.inventory = actor.pc!.inventory.filter((i) => i.qty > 0);
      const d = rollDice(rng, parseDice(item.heal));
      const parts: BreakdownPart[] = [
        ...d.dice.map((v, i) => ({ label: `W${d.sides[i]}`, value: v, glossarKey: `w${d.sides[i]}` })),
        { label: "Bonus", value: parseDice(item.heal).flat, glossarKey: "gegenstand:potion-of-healing" },
      ];
      return { ...ok, cost: "action", kind: "heal", what: "potion", targetId: target.id, parts, total: d.total, hp: heal(target, d.total) };
    }

    case "stand-up": {
      if (!actor.conditions.some((c) => c.id === "prone")) return fail("Du stehst schon.");
      const cost = Math.floor(actor.speedFt / 2);
      if (turn && turn.movementLeftFt < cost) return fail("Nicht genug Bewegung, um aufzustehen.");
      if (turn) turn.movementLeftFt -= cost;
      actor.conditions = actor.conditions.filter((c) => c.id !== "prone");
      return { ...ok, cost: "move", kind: "simple", what: "stand-up" };
    }
  }
}

/** Recharge rolls for breath weapons at the start of a monster's turn. */
export function rollRecharges(rng: Rng, c: Creature): string[] {
  const recharged: string[] = [];
  for (const sa of c.saveActions) {
    if (!sa.available && sa.recharge && rng.int(1, 6) >= sa.recharge) {
      sa.available = true;
      recharged.push(sa.id);
    }
  }
  return recharged;
}

/** Short rest: fighters and clerics get their features back, everyone may spend hit dice (simplified: half HP). */
export function shortRest(c: Creature): void {
  if (!c.pc || c.dead) return;
  for (const r of Object.values(c.pc.resources)) if (r.recharge === "short") r.used = 0;
  c.hp = Math.min(c.maxHp, Math.max(c.hp, 1) + Math.ceil(c.maxHp / 2));
  c.conditions = c.conditions.filter((x) => x.id !== "unconscious");
  c.deathSaves = { successes: 0, failures: 0 };
  c.stable = false;
}

export function longRest(c: Creature): void {
  if (!c.pc || c.dead) return;
  for (const r of Object.values(c.pc.resources)) r.used = 0;
  c.pc.spellSlots = [...c.pc.spellSlotsMax];
  c.hp = c.maxHp;
  c.tempHp = 0;
  c.conditions = [];
  c.effects = [];
  c.deathSaves = { successes: 0, failures: 0 };
  c.stable = false;
}
