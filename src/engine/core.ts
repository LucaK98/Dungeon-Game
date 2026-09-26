/**
 * Basic rules: modifiers, d20 rolls with advantage/disadvantage, checks and saves.
 * Every calculation returns a breakdown so the help system can explain it.
 */
import type { CheckResult, Creature, D20Roll } from "../shared/game";
import type { SkillId } from "../shared/rules";
import type { Ability, BreakdownPart } from "../shared/types";
import { getSkill } from "./data";
import { rollDie } from "./dice";
import { abilityName, nameOf } from "./names";
import type { Rng } from "./rng";

export const ABILITY_GLOSSAR: Record<Ability, string> = {
  STR: "staerke",
  DEX: "geschicklichkeit",
  CON: "konstitution",
  INT: "intelligenz",
  WIS: "weisheit",
  CHA: "charisma",
};

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

export function modPart(c: Creature, ability: Ability): BreakdownPart {
  return { label: abilityName(ability), value: abilityMod(c.abilities[ability]), glossarKey: ABILITY_GLOSSAR[ability] };
}

export function profPart(value: number): BreakdownPart {
  return { label: "Übung", value, glossarKey: "uebungsbonus" };
}

export function sumParts(parts: BreakdownPart[]): number {
  return parts.reduce((s, p) => s + p.value, 0);
}

// ---------------------------------------------------------------- d20

export type AdvReason = D20Roll["reasons"][number];

export function advantage(text: string, glossarKey: string): AdvReason {
  return { text, glossarKey, effect: "advantage" };
}

export function disadvantage(text: string, glossarKey: string): AdvReason {
  return { text, glossarKey, effect: "disadvantage" };
}

/**
 * Rolls a d20. Advantage and disadvantage cancel each other out,
 * no matter how many sources there are (SRD rule).
 * `lucky` (halfling): natural 1s are rerolled once.
 */
export function rollD20(rng: Rng, reasons: AdvReason[] = [], lucky = false): D20Roll {
  const adv = reasons.some((r) => r.effect === "advantage");
  const dis = reasons.some((r) => r.effect === "disadvantage");
  const mode: D20Roll["mode"] = adv && !dis ? "advantage" : dis && !adv ? "disadvantage" : "normal";
  const one = (): number => {
    const v = rollDie(rng, 20);
    return lucky && v === 1 ? rollDie(rng, 20) : v;
  };
  const rolls = mode === "normal" ? [one()] : [one(), one()];
  const natural = mode === "advantage" ? Math.max(...rolls) : mode === "disadvantage" ? Math.min(...rolls) : rolls[0]!;
  return { rolls, natural, mode, reasons };
}

export function d20Part(roll: D20Roll): BreakdownPart {
  return { label: "Würfel", value: roll.natural, glossarKey: "w20" };
}

// ---------------------------------------------------------------- bonuses

function isLucky(c: Creature): boolean {
  return c.pc?.raceId === "halfling";
}

export function saveParts(c: Creature, ability: Ability): BreakdownPart[] {
  const mod = modPart(c, ability);
  const fixed = c.saveBonuses?.[ability];
  if (fixed !== undefined) {
    return fixed === mod.value ? [mod] : [mod, profPart(fixed - mod.value)];
  }
  const parts = [mod];
  if (c.pc?.saveProficiencies.includes(ability)) parts.push(profPart(c.proficiencyBonus));
  return parts;
}

export function skillParts(c: Creature, skill: SkillId): BreakdownPart[] {
  const ability = getSkill(skill).ability;
  const mod = modPart(c, ability);
  const fixed = c.skillBonuses?.[skill];
  if (fixed !== undefined) return fixed === mod.value ? [mod] : [mod, profPart(fixed - mod.value)];
  const parts = [mod];
  if (c.pc?.skillProficiencies.includes(skill)) {
    const expert = c.pc.expertise.includes(skill);
    parts.push({
      label: expert ? "Expertise" : "Übung",
      value: c.proficiencyBonus * (expert ? 2 : 1),
      glossarKey: expert ? "expertise" : "uebungsbonus",
    });
  }
  return parts;
}

// ---------------------------------------------------------------- checks

export interface CheckOptions {
  reasons?: AdvReason[];
  /** Extra bonus dice already rolled (e.g. Bless). */
  extra?: BreakdownPart[];
}

function conditionReasonsForCheck(c: Creature, kind: "check" | "save", ability: Ability): AdvReason[] {
  const out: AdvReason[] = [];
  const has = (id: string) => c.conditions.some((x) => x.id === id);
  if (kind === "check" && has("poisoned")) out.push(disadvantage("Vergiftet", "zustand:poisoned"));
  if (kind === "check" && has("frightened")) out.push(disadvantage("Verängstigt", "zustand:frightened"));
  if (kind === "save" && ability === "DEX" && has("restrained")) out.push(disadvantage("Festgesetzt", "zustand:restrained"));
  return out;
}

/** Strength/Dexterity saves fail automatically while paralyzed, stunned or unconscious. */
function autoFailSave(c: Creature, ability: Ability): string | undefined {
  if (ability !== "STR" && ability !== "DEX") return undefined;
  return c.conditions.find((x) => x.id === "paralyzed" || x.id === "stunned" || x.id === "unconscious")?.id;
}

export function abilityCheck(
  rng: Rng,
  c: Creature,
  ability: Ability,
  dc: number,
  opts: CheckOptions = {},
): CheckResult {
  const reasons = [...conditionReasonsForCheck(c, "check", ability), ...(opts.reasons ?? [])];
  const roll = rollD20(rng, reasons, isLucky(c));
  const parts = [d20Part(roll), modPart(c, ability), ...(opts.extra ?? [])];
  const total = sumParts(parts);
  return { kind: "check", ability, roll, parts, total, dc, success: total >= dc };
}

export function skillCheck(rng: Rng, c: Creature, skill: SkillId, dc: number, opts: CheckOptions = {}): CheckResult {
  const ability = getSkill(skill).ability;
  const reasons = [...conditionReasonsForCheck(c, "check", ability), ...(opts.reasons ?? [])];
  if (skill === "stealth" && c.pc?.armorId) {
    // Heavy armour makes noise.
    const heavy = c.pc.armorId === "chain-mail" || c.pc.armorId === "scale-mail";
    if (heavy) reasons.push(disadvantage("Schwere Rüstung klappert", "ruestung:" + c.pc.armorId));
  }
  const roll = rollD20(rng, reasons, isLucky(c));
  const parts = [d20Part(roll), ...skillParts(c, skill), ...(opts.extra ?? [])];
  const total = sumParts(parts);
  return { kind: "check", ability, skill, roll, parts, total, dc, success: total >= dc };
}

export function savingThrow(rng: Rng, c: Creature, ability: Ability, dc: number, opts: CheckOptions = {}): CheckResult {
  const reasons = [...conditionReasonsForCheck(c, "save", ability), ...(opts.reasons ?? [])];
  const extra = [...(opts.extra ?? [])];
  const bless = c.effects.find((e) => e.id === "bless");
  if (bless) extra.push({ label: "Segen", value: rollDie(rng, 4), glossarKey: "zauber:bless" });
  const roll = rollD20(rng, reasons, isLucky(c));
  const parts = [d20Part(roll), ...saveParts(c, ability), ...extra];
  const total = sumParts(parts);
  const failedBy = autoFailSave(c, ability);
  return {
    kind: "save",
    ability,
    roll,
    parts,
    total,
    dc,
    success: failedBy ? false : total >= dc,
  };
}

export function passivePerception(c: Creature): number {
  return 10 + sumParts(skillParts(c, "perception"));
}

export function skillName(skill: SkillId): string {
  return nameOf("skills", skill);
}
