/**
 * Casting the spells of our SRD subset.
 * Targets (also for area spells) are chosen by the caller; the map layer knows who stands in a cone.
 */
import type { AttackOption, Battle, Creature, SpellResult, SpellTargetResult } from "../shared/game";
import type { SpellDef } from "../shared/rules";
import type { Ability, BreakdownPart } from "../shared/types";
import { resolveAttack, rollDamage } from "./attack";
import { addCondition, addEffect, damageCreature, distanceFt, dropConcentration, heal, isActive } from "./combat";
import { ABILITY_GLOSSAR, abilityMod, modPart, profPart, savingThrow, sumParts } from "./core";
import { getClass, getSpell } from "./data";
import { parseDice, rollDice } from "./dice";
import { abilityName } from "./names";
import type { Rng } from "./rng";

export function spellcastingAbility(c: Creature, spellId: string): Ability {
  const cls = c.pc ? getClass(c.pc.classId) : undefined;
  const spell = getSpell(spellId);
  if (cls?.spellcastingAbility && spell.classes.includes(cls.id)) return cls.spellcastingAbility;
  // High-elf cantrip: Intelligence.
  return "INT";
}

export function spellAttackParts(c: Creature, spellId: string): BreakdownPart[] {
  return [modPart(c, spellcastingAbility(c, spellId)), profPart(c.proficiencyBonus)];
}

export function spellSaveDcParts(c: Creature, spellId: string): BreakdownPart[] {
  return [
    { label: "Grundwert", value: 8, glossarKey: "zauber_sg" },
    modPart(c, spellcastingAbility(c, spellId)),
    profPart(c.proficiencyBonus),
  ];
}

function cantripDice(spell: SpellDef, charLevel: number): string {
  const table = spell.damage!.byCharLevel!;
  let dice = table["1"]!;
  for (const [lvl, d] of Object.entries(table)) if (charLevel >= Number(lvl)) dice = d;
  return dice;
}

function slotDice(table: Record<string, string>, slot: number): string {
  return table[String(slot)] ?? table[String(Math.max(...Object.keys(table).map(Number)))]!;
}

export function maxTargets(spell: SpellDef, slot: number): number {
  switch (spell.id) {
    case "bless":
      return 3 + (slot - 1);
    case "magic-missile":
      return 3 + (slot - 1);
    case "scorching-ray":
      return 3 + (slot - 2);
    case "divine-favor":
      return 1;
    case "mass-healing-word":
      return 6;
    case "burning-hands":
    case "thunderwave":
    case "sleep":
      return 99;
    default:
      return 1;
  }
}

export interface CastRequest {
  spellId: string;
  /** Spell slot level (ignored for cantrips). */
  slotLevel?: number;
  /** Target IDs; magic missile and scorching ray may repeat an ID per dart/ray. */
  targetIds: string[];
}

/** Returns a German reason if the spell can't be cast like this. */
export function validateCast(battle: Battle, caster: Creature, req: CastRequest): string | undefined {
  const pc = caster.pc;
  if (!pc || !pc.spells.includes(req.spellId)) return "Diesen Zauber kennst du nicht.";
  if (caster.effects.some((e) => e.id === "wild-shape")) return "Als Wolf kannst du nicht zaubern.";
  const spell = getSpell(req.spellId);
  const slot = spell.level === 0 ? 0 : (req.slotLevel ?? spell.level);
  if (spell.level > 0) {
    if (slot < spell.level) return "Der Zauberplatz ist zu niedrig.";
    if ((pc.spellSlots[slot - 1] ?? 0) <= 0) return "Du hast keinen passenden Zauberplatz mehr.";
  }
  const targets = spell.rangeFt === "self" && !spell.area ? [caster.id] : req.targetIds;
  if (!targets.length) return "Wähle ein Ziel.";
  if (targets.length > maxTargets(spell, slot || 1)) return "Zu viele Ziele.";
  for (const id of targets) {
    const t = battle.creatures[id];
    if (!t || t.dead) return "Ungültiges Ziel.";
    const range = spell.rangeFt === "touch" ? 5 : spell.rangeFt === "self" ? (spell.area?.sizeFt ?? 0) : spell.rangeFt;
    if (t.id !== caster.id && distanceFt(caster, t) > range) return `${t.name} ist zu weit weg.`;
  }
  return undefined;
}

/** Casts a spell. Call validateCast first; this function trusts its input. */
export function castSpell(rng: Rng, battle: Battle, caster: Creature, req: CastRequest): SpellResult {
  const spell = getSpell(req.spellId);
  const slot = spell.level === 0 ? 0 : (req.slotLevel ?? spell.level);
  if (slot > 0) caster.pc!.spellSlots[slot - 1]!--;
  let targetIds = spell.rangeFt === "self" && !spell.area ? [caster.id] : req.targetIds;
  // Fireball: the chosen creature is the centre; everyone on its side within the blast is hit.
  if (spell.id === "fireball" && targetIds[0]) {
    const centre = battle.creatures[targetIds[0]]!;
    const radius = spell.area?.sizeFt ?? 20;
    targetIds = Object.values(battle.creatures)
      .filter((c) => !c.dead && c.pos && c.side === centre.side && (c.id === centre.id || distanceFt(centre, c) <= radius))
      .map((c) => c.id);
  }
  const result: SpellResult = { type: "spell", casterId: caster.id, spellId: spell.id, slotLevel: slot, targets: [] };
  const charLevel = caster.pc?.level ?? 1;
  const castMod = abilityMod(caster.abilities[spellcastingAbility(caster, spell.id)]);

  if (spell.concentration) {
    if (caster.concentration) dropConcentration(battle, caster.id);
    caster.concentration = spell.id;
  }

  const target = (id: string) => battle.creatures[id]!;

  // Spell attacks: fire bolt, ray of frost, guiding bolt, scorching ray.
  if (spell.attack) {
    const dice = spell.level === 0 ? cantripDice(spell, charLevel) : slotDice(spell.damage!.bySlot!, slot);
    const option: AttackOption = {
      id: spell.id,
      sourceId: spell.id,
      source: "spell",
      kind: spell.attack,
      toHit: spellAttackParts(caster, spell.id),
      damage: [{ dice, type: spell.damage!.type }],
      damageBonus: [],
      reachFt: spell.attack === "melee" ? 5 : 0,
      rangeFt: { normal: typeof spell.rangeFt === "number" ? spell.rangeFt : 5 },
      magical: true,
    };
    for (const id of targetIds) {
      const t = target(id);
      if (!isActive(t)) continue;
      const attack = resolveAttack(rng, battle, caster, t, option);
      const entry: SpellTargetResult = { targetId: id, attack };
      if (attack.hit && spell.id === "guiding-bolt" && !t.dead) {
        addEffect(t, "guiding-bolt", 1, caster.id);
        entry.applied = "guiding-bolt";
      }
      if (attack.hit && spell.id === "ray-of-frost" && !t.dead) {
        addEffect(t, "ray-of-frost", 1, caster.id);
        entry.applied = "ray-of-frost";
      }
      result.targets.push(entry);
    }
    return result;
  }

  // Saving throw spells: sacred flame, burning hands.
  if (spell.save && spell.damage) {
    const dcParts = spellSaveDcParts(caster, spell.id);
    const dc = sumParts(dcParts);
    result.dc = { value: dc, parts: dcParts };
    const dice = spell.level === 0 ? cantripDice(spell, charLevel) : slotDice(spell.damage.bySlot!, slot);
    // Area spells roll damage once for everyone.
    const shared = spell.area ? rollDamage(rng, { parts: [{ dice, type: spell.damage.type }], magical: true }) : undefined;
    for (const id of targetIds) {
      const t = target(id);
      if (!isActive(t)) continue;
      const save = savingThrow(rng, t, spell.save.ability, dc);
      let damage = shared
        ? structuredClone(shared)
        : rollDamage(rng, { parts: [{ dice, type: spell.damage.type }], magical: true });
      // Re-apply the target's resistances on the shared roll.
      damage = applyResistances(damage, t);
      if (save.success) {
        for (const l of damage.lines) l.final = spell.save.onSuccess === "half" ? Math.floor(l.final / 2) : 0;
        damage.total = damage.lines.reduce((s, l) => s + l.final, 0);
      }
      const hp = damageCreature(rng, battle, t, damage.total, { types: [spell.damage.type] });
      // Vicious Mockery: a failed save also spoils the next attack (disadvantage).
      if (spell.id === "vicious-mockery" && !save.success && !t.dead) {
        addEffect(t, "hampered", 2, caster.id);
        result.targets.push({ targetId: id, save, damage, hp, applied: "hampered" });
        continue;
      }
      result.targets.push({ targetId: id, save, damage, hp });
    }
    return result;
  }

  switch (spell.id) {
    case "magic-missile": {
      for (const id of targetIds) {
        const t = target(id);
        if (!isActive(t)) continue;
        const damage = rollDamage(rng, { parts: [{ dice: "1d4+1", type: "force" }], magical: true }, t);
        const hp = damageCreature(rng, battle, t, damage.total, { types: ["force"] });
        result.targets.push({ targetId: id, damage, hp });
      }
      return result;
    }
    case "sleep": {
      const extra = slot - 1;
      const parsed = parseDice(`${5 + 2 * extra}d8`);
      const rolled = rollDice(rng, parsed);
      const parts = rolled.dice.map((v) => ({ label: "W8", value: v, glossarKey: "w8" }));
      let pool = rolled.total;
      result.pool = { parts, total: pool };
      const sorted = targetIds.map(target).filter(isActive).sort((a, b) => a.hp - b.hp);
      for (const t of sorted) {
        if (t.creatureType === "undead") {
          result.targets.push({ targetId: t.id, unaffected: "Untote schlafen nicht." });
          continue;
        }
        if (t.traits.includes("fey-ancestry") || t.conditionImmunities.includes("charmed")) {
          result.targets.push({ targetId: t.id, unaffected: `${t.name} ist gegen magischen Schlaf geschützt.` });
          continue;
        }
        if (t.conditions.some((c) => c.id === "unconscious")) continue;
        if (t.hp > pool) {
          result.targets.push({ targetId: t.id, unaffected: `${t.name} hat zu viele Trefferpunkte.` });
          continue;
        }
        pool -= t.hp;
        addCondition(t, { id: "unconscious", rounds: spell.durationRounds, sourceId: caster.id, endsOnDamage: true });
        addCondition(t, { id: "prone", sourceId: caster.id });
        result.targets.push({ targetId: t.id, applied: "unconscious" });
      }
      return result;
    }
    case "cure-wounds":
    case "healing-word":
    case "mass-healing-word": {
      for (const id of targetIds) {
        const t = target(id);
        if (t.creatureType === "undead" || t.dead) {
          result.targets.push({ targetId: id, unaffected: "Heilmagie wirkt hier nicht." });
          continue;
        }
        const parsed = parseDice(slotDice(spell.heal!, slot).replace("+MOD", ""));
        const rolled = rollDice(rng, parsed);
        const parts: BreakdownPart[] = rolled.dice.map((v, i) => ({
          label: `W${rolled.sides[i]}`,
          value: v,
          glossarKey: `w${rolled.sides[i]}`,
        }));
        const ability = spellcastingAbility(caster, spell.id);
        parts.push({ label: abilityName(ability), value: castMod, glossarKey: ABILITY_GLOSSAR[ability] });
        if (caster.pc?.features.includes("disciple-of-life")) {
          parts.push({ label: "Jünger des Lebens", value: 2 + slot, glossarKey: "merkmal:disciple-of-life" });
        }
        const total = Math.max(1, sumParts(parts));
        const hp = heal(t, total);
        result.targets.push({ targetId: id, heal: { parts, total }, hp });
      }
      return result;
    }
    case "hunters-mark": {
      for (const id of targetIds) {
        addEffect(target(id), "hunters-mark", spell.durationRounds, caster.id);
        result.targets.push({ targetId: id, applied: "hunters-mark" });
      }
      return result;
    }
    case "bless":
    case "shield-of-faith":
    case "divine-favor": {
      for (const id of targetIds) {
        const t = target(id);
        addEffect(t, spell.id, spell.durationRounds, caster.id);
        result.targets.push({ targetId: id, applied: spell.id });
      }
      return result;
    }
  }
  throw new Error(`spell ${spell.id} is not implemented`);
}

function applyResistances(damage: ReturnType<typeof rollDamage>, t: Creature): ReturnType<typeof rollDamage> {
  for (const line of damage.lines) {
    line.final = line.raw;
    delete line.note;
    if (t.immunities.includes(line.type)) {
      line.final = 0;
      line.note = "immunity";
    } else if (t.resistances.includes(line.type)) {
      line.final = Math.floor(line.raw / 2);
      line.note = "resistance";
    } else if (t.vulnerabilities.includes(line.type)) {
      line.final = line.raw * 2;
      line.note = "vulnerability";
    }
  }
  damage.total = damage.lines.reduce((s, l) => s + l.final, 0);
  return damage;
}
