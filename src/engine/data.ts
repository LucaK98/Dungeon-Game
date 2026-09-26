import armorJson from "../data/srd/armor.json";
import classesJson from "../data/srd/classes.json";
import conditionsJson from "../data/srd/conditions.json";
import itemsJson from "../data/srd/items.json";
import monstersJson from "../data/srd/monsters.json";
import racesJson from "../data/srd/races.json";
import skillsJson from "../data/srd/skills.json";
import spellsJson from "../data/srd/spells.json";
import weaponsJson from "../data/srd/weapons.json";
import type {
  ArmorDef,
  ClassDef,
  ConditionId,
  ItemDef,
  MonsterDef,
  RaceDef,
  SkillDef,
  SkillId,
  SpellDef,
  SrdData,
  WeaponDef,
} from "../shared/rules";

/** The reduced SRD data (see scripts/import-srd.ts). */
export const SRD: SrdData = {
  skills: skillsJson as SkillDef[],
  classes: classesJson as ClassDef[],
  races: racesJson as RaceDef[],
  weapons: weaponsJson as WeaponDef[],
  armor: armorJson as ArmorDef[],
  items: itemsJson as ItemDef[],
  spells: spellsJson as SpellDef[],
  monsters: monstersJson as MonsterDef[],
  conditions: conditionsJson as ConditionId[],
};

function lookup<T extends { id: string }>(list: T[], what: string): (id: string) => T {
  const map = new Map(list.map((e) => [e.id, e]));
  return (id) => {
    const found = map.get(id);
    if (!found) throw new Error(`unknown ${what} "${id}"`);
    return found;
  };
}

export const getClass = lookup(SRD.classes, "class");
export const getRace = lookup(SRD.races, "race");
export const getWeapon = lookup(SRD.weapons, "weapon");
export const getArmor = lookup(SRD.armor, "armor");
export const getItem = lookup(SRD.items, "item");
export const getSpell = lookup(SRD.spells, "spell");
export const getMonster = lookup(SRD.monsters, "monster");

const skillMap = new Map(SRD.skills.map((s) => [s.id, s]));
export function getSkill(id: SkillId): SkillDef {
  const s = skillMap.get(id);
  if (!s) throw new Error(`unknown skill "${id}"`);
  return s;
}

export function hasMonster(id: string): boolean {
  return SRD.monsters.some((m) => m.id === id);
}
