/**
 * Imports the SRD 5.1 subset we need from 5e-bits/5e-database and writes a reduced
 * version to src/data/srd/. Run with:  npm run import:srd
 *
 * Source: https://github.com/5e-bits/5e-database (src/2014/en), code MIT, content SRD 5.1 (CC-BY-4.0).
 * Set SRD_SOURCE=/path/to/5e-database/src/2014/en to read from a local checkout instead.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ArmorDef,
  ClassDef,
  ConditionId,
  DamagePart,
  DamageType,
  ItemDef,
  MonsterAction,
  MonsterDef,
  RaceDef,
  SkillDef,
  SkillId,
  SpellDef,
  WeaponDef,
  WeaponProperty,
} from "../src/shared/rules";
import type { Ability } from "../src/shared/types";

const REMOTE = "https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2014/en";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/data/srd");

// ---------------------------------------------------------------- selection

const CLASSES = ["fighter", "paladin", "wizard", "rogue", "cleric"];
const MAX_LEVEL = 3;
/** people → SRD subrace (the SRD only has one subrace each). */
const RACES: Record<string, string | undefined> = {
  human: undefined,
  elf: "high-elf",
  dwarf: "hill-dwarf",
  halfling: "lightfoot-halfling",
};
const SPELLS = [
  "fire-bolt",
  "ray-of-frost",
  "sacred-flame",
  "magic-missile",
  "burning-hands",
  "sleep",
  "cure-wounds",
  "healing-word",
  "bless",
  "guiding-bolt",
  "shield-of-faith",
  "divine-favor",
  "scorching-ray",
];
const MONSTERS = [
  // Tutorial & everyday
  "rat",
  "giant-rat",
  "swarm-of-rats",
  "commoner",
  "guard",
  "noble",
  // Story 1: Drachenfels
  "ogre",
  "red-dragon-wyrmling",
  "kobold",
  "wolf",
  "dire-wolf",
  "bandit",
  "bandit-captain",
  "thug",
  "knight",
  "veteran",
  "scout",
  "mage",
  "goblin",
  // Story 2: Rattenfänger
  "cultist",
  "cult-fanatic",
  "spy",
  "priest",
  "swarm-of-bats",
  // Story 3: Walpurgisnacht
  "werewolf-hybrid",
  "green-hag",
  "ghost",
  "specter",
  "skeleton",
  "zombie",
  "ghoul",
  "giant-spider",
];
const WEAPONS = [
  "club",
  "dagger",
  "handaxe",
  "javelin",
  "mace",
  "quarterstaff",
  "spear",
  "crossbow-light",
  "shortbow",
  "battleaxe",
  "greatsword",
  "longsword",
  "rapier",
  "shortsword",
  "warhammer",
  "longbow",
];
const ARMOR = ["leather-armor", "studded-leather-armor", "chain-shirt", "scale-mail", "chain-mail", "shield"];
const CONDITIONS: ConditionId[] = [
  "blinded",
  "charmed",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
];

// ---------------------------------------------------------------- helpers

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function load(file: string): Promise<Json[]> {
  const local = process.env.SRD_SOURCE;
  if (local) return JSON.parse(await readFile(join(local, file), "utf8")) as Json[];
  const res = await fetch(`${REMOTE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return (await res.json()) as Json[];
}

function byIndex(list: Json[]): Map<string, Json> {
  const map = new Map<string, Json>();
  for (const entry of list) if (!map.has(entry.index)) map.set(entry.index, entry);
  return map;
}

function pick(map: Map<string, Json>, ids: string[], what: string): Json[] {
  return ids.map((id) => {
    const entry = map.get(id);
    if (!entry) throw new Error(`${what} "${id}" is not part of the SRD 5.1 data`);
    return entry;
  });
}

const ab = (index: string): Ability => index.toUpperCase() as Ability;
const feet = (text: string | undefined): number => Number.parseInt(text ?? "0", 10) || 0;
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const dice = (d: string): string => d.replace(/\s+/g, "");

function durationRounds(text: string): number {
  const t = text.toLowerCase();
  if (t.startsWith("instantaneous")) return 0;
  const m = /(\d+)\s*(round|minute|hour)/.exec(t);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === "round" ? n : m[2] === "minute" ? n * 10 : n * 600;
}

// ---------------------------------------------------------------- converters

function convertSkills(raw: Json[]): SkillDef[] {
  return raw.map((s) => ({ id: s.index as SkillId, ability: ab(s.ability_score.index) }));
}

function convertClass(c: Json, levels: Json[]): ClassDef {
  const profs: string[] = c.proficiencies.map((p: Json) => p.index);
  const armor: ClassDef["armor"] = [];
  if (profs.includes("all-armor") || profs.includes("light-armor")) armor.push("light");
  if (profs.includes("all-armor") || profs.includes("medium-armor")) armor.push("medium");
  if (profs.includes("all-armor") || profs.includes("heavy-armor")) armor.push("heavy");
  if (profs.includes("shields")) armor.push("shield");
  const weapons: ClassDef["weapons"] = [];
  if (profs.includes("simple-weapons")) weapons.push("simple");
  if (profs.includes("martial-weapons")) weapons.push("martial");

  const choice = c.proficiency_choices[0];
  const skillChoices = {
    count: choice.choose as number,
    from: choice.from.options.map((o: Json) => o.item.index.replace(/^skill-/, "")) as SkillId[],
  };

  const own = levels
    .filter((l) => l.class?.index === c.index && !l.subclass && l.level <= MAX_LEVEL)
    .sort((a, b) => a.level - b.level)
    .map((l) => {
      const sc = l.spellcasting ?? {};
      const slots: number[] = [];
      for (let i = 1; i <= 9; i++) slots.push(sc[`spell_slots_level_${i}`] ?? 0);
      while (slots.length && slots[slots.length - 1] === 0) slots.pop();
      const def: ClassDef["levels"][number] = {
        level: l.level,
        proficiencyBonus: l.prof_bonus,
        features: l.features.map((f: Json) => f.index),
        spellSlots: slots,
        cantripsKnown: sc.cantrips_known ?? 0,
      };
      const sneak = l.class_specific?.sneak_attack;
      if (sneak) def.sneakAttackDice = sneak.dice_count;
      return def;
    });

  return {
    id: c.index,
    hitDie: c.hit_die,
    saves: c.saving_throws.map((s: Json) => ab(s.index)),
    armor,
    weapons,
    skillChoices,
    ...(c.spellcasting ? { spellcastingAbility: ab(c.spellcasting.spellcasting_ability.index) } : {}),
    levels: own,
  };
}

function convertRace(r: Json, sub: Json | undefined): RaceDef {
  const bonuses: RaceDef["abilityBonuses"] = {};
  for (const b of [...r.ability_bonuses, ...(sub?.ability_bonuses ?? [])]) {
    const k = ab(b.ability_score.index);
    bonuses[k] = (bonuses[k] ?? 0) + b.bonus;
  }
  const traits: string[] = [...r.traits, ...(sub?.racial_traits ?? [])].map((t: Json) => t.index);
  return {
    id: r.index,
    ...(sub ? { subrace: sub.index } : {}),
    speedFt: r.speed,
    size: r.size.toLowerCase(),
    abilityBonuses: bonuses,
    traits,
    darkvisionFt: traits.includes("darkvision") ? 60 : 0,
    skillProficiencies: traits.includes("keen-senses") ? ["perception"] : [],
    resistances: traits.includes("dwarven-resilience") ? ["poison"] : [],
  };
}

function convertWeapon(w: Json): WeaponDef {
  const ranged = w.weapon_range === "Ranged";
  const props = w.properties.map((p: Json) => p.index) as WeaponProperty[];
  const rangeFt = ranged || props.includes("thrown")
    ? { normal: (w.throw_range ?? w.range).normal, long: (w.throw_range ?? w.range).long }
    : { normal: w.range.normal };
  return {
    id: w.index,
    category: w.weapon_category.toLowerCase(),
    ranged,
    damage: { dice: dice(w.damage.damage_dice), type: w.damage.damage_type.index },
    ...(w.two_handed_damage ? { versatileDice: dice(w.two_handed_damage.damage_dice) } : {}),
    properties: props,
    rangeFt,
    weight: w.weight,
  };
}

function convertArmor(a: Json): ArmorDef {
  return {
    id: a.index,
    category: a.armor_category.toLowerCase(),
    baseAc: a.armor_class.base,
    dexBonus: a.armor_class.dex_bonus,
    ...(a.armor_class.max_bonus != null ? { maxDexBonus: a.armor_class.max_bonus } : {}),
    strMinimum: a.str_minimum ?? 0,
    stealthDisadvantage: a.stealth_disadvantage ?? false,
  };
}

function convertSpell(s: Json): SpellDef {
  const range: string = s.range;
  const rangeFt: SpellDef["rangeFt"] = range === "Self" ? "self" : range === "Touch" ? "touch" : feet(range);
  const def: SpellDef = {
    id: s.index,
    level: s.level,
    school: s.school.index,
    classes: s.classes.map((c: Json) => c.index),
    castingTime: /bonus/i.test(s.casting_time) ? "bonus" : /reaction/i.test(s.casting_time) ? "reaction" : "action",
    rangeFt,
    concentration: s.concentration,
    durationRounds: durationRounds(s.duration),
  };
  if (s.attack_type) def.attack = s.attack_type;
  if (s.dc) def.save = { ability: ab(s.dc.dc_type.index), onSuccess: s.dc.dc_success === "half" ? "half" : "none" };
  const dmg = Array.isArray(s.damage) ? s.damage[0] : s.damage;
  const norm = (rec: Record<string, string> | undefined) =>
    rec ? Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, dice(v)])) : undefined;
  if (dmg?.damage_type) {
    const byCharLevel = norm(dmg.damage_at_character_level);
    const bySlot = norm(dmg.damage_at_slot_level);
    def.damage = { type: dmg.damage_type.index, ...(byCharLevel ? { byCharLevel } : {}), ...(bySlot ? { bySlot } : {}) };
  } else if (dmg?.damage_at_slot_level) {
    // Sleep: the dice are a hit point pool, not damage.
    def.hpPool = norm(dmg.damage_at_slot_level);
  }
  if (s.heal_at_slot_level) {
    def.heal = Object.fromEntries(
      Object.entries(s.heal_at_slot_level as Record<string, string>).map(([k, v]) => [k, dice(v)]),
    );
  }
  if (s.area_of_effect) def.area = { shape: s.area_of_effect.type, sizeFt: s.area_of_effect.size };
  return def;
}

function damageParts(list: Json[] | undefined): DamagePart[] {
  const out: DamagePart[] = [];
  for (const d of list ?? []) {
    // Choice (e.g. spear one-/two-handed): take the first option.
    const entry = d.damage_dice ? d : d.from?.options?.[0];
    if (entry?.damage_dice && entry.damage_type) {
      out.push({ dice: dice(entry.damage_dice), type: entry.damage_type.index });
    }
  }
  return out;
}

function convertMonsterAction(a: Json): MonsterAction | undefined {
  const damage = damageParts(a.damage);
  if (!damage.length) return undefined;
  const desc: string = a.desc ?? "";
  const id = slug(a.name);
  const recharge = a.usage?.type === "recharge on roll" ? a.usage.min_value : undefined;

  if (a.attack_bonus != null) {
    const ranged = /Ranged (Weapon|Spell) Attack/.test(desc) && !/Melee or Ranged/.test(desc);
    const reach = /reach (\d+) ft/.exec(desc);
    const range = /range (\d+)(?:\/(\d+))? ft/.exec(desc);
    const action: MonsterAction = { id, kind: ranged ? "ranged" : "melee", attackBonus: a.attack_bonus, damage };
    if (reach) action.reachFt = Number(reach[1]);
    if (range) action.rangeFt = { normal: Number(range[1]), ...(range[2] ? { long: Number(range[2]) } : {}) };
    if (!ranged && action.reachFt === undefined) action.reachFt = 5;
    if (recharge) action.recharge = recharge;
    return action;
  }
  if (a.dc) {
    const area = /(\d+)-foot[- ](cone|line|radius|sphere)/.exec(desc);
    const action: MonsterAction = {
      id,
      kind: "save",
      damage,
      save: {
        ability: ab(a.dc.dc_type.index),
        dc: a.dc.dc_value,
        onSuccess: a.dc.success_type === "half" ? "half" : "none",
      },
    };
    if (area) {
      const shape = area[2] === "radius" ? "sphere" : (area[2] as "cone" | "line" | "sphere");
      action.area = { shape, sizeFt: Number(area[1]) };
    }
    if (recharge) action.recharge = recharge;
    return action;
  }
  return undefined;
}

function convertMultiattack(a: Json | undefined, known: Set<string>): string[] | undefined {
  if (!a) return undefined;
  let entries: Json[] = [];
  if (a.multiattack_type === "actions") entries = a.actions;
  else if (a.multiattack_type === "action_options") {
    const first = a.action_options.from.options[0];
    entries = first.option_type === "multiple" ? first.items : [first];
    const out: string[] = [];
    for (const e of entries) for (let i = 0; i < e.count; i++) out.push(slug(e.action_name));
    return out.filter((id) => known.has(id));
  }
  // "actions" sometimes lists alternatives (veteran: 2 longsword OR 2 shortsword):
  // take entries until the monster has at least two attacks.
  const out: string[] = [];
  for (const e of entries) {
    if (out.length >= 2) break;
    for (let i = 0; i < e.count; i++) out.push(slug(e.action_name));
  }
  const filtered = out.filter((id) => known.has(id));
  return filtered.length ? filtered : undefined;
}

function convertMonster(m: Json): MonsterDef {
  const speed = m.speed ?? {};
  const resist: DamageType[] = [];
  let resistsNonmagical = false;
  for (const r of m.damage_resistances as string[]) {
    if (r.includes("nonmagical")) resistsNonmagical = true;
    else resist.push(r as DamageType);
  }
  const immune: DamageType[] = [];
  let immuneNonmagical = false;
  for (const r of m.damage_immunities as string[]) {
    if (r.includes("nonmagical")) immuneNonmagical = true;
    else immune.push(r as DamageType);
  }
  const saves: MonsterDef["saves"] = {};
  const skills: MonsterDef["skills"] = {};
  for (const p of m.proficiencies ?? []) {
    const idx: string = p.proficiency.index;
    if (idx.startsWith("saving-throw-")) saves[ab(idx.slice(13))] = p.value;
    else if (idx.startsWith("skill-")) skills[idx.slice(6) as SkillId] = p.value;
  }
  const actions = (m.actions as Json[]).map(convertMonsterAction).filter((a): a is MonsterAction => !!a);
  const known = new Set(actions.map((a) => a.id));
  const multi = convertMultiattack(
    (m.actions as Json[]).find((a) => a.name === "Multiattack"),
    known,
  );

  const def: MonsterDef = {
    id: m.index,
    size: m.size.toLowerCase(),
    type: m.type,
    ac: m.armor_class[0].value,
    hp: m.hit_points,
    hitDice: m.hit_points_roll ?? m.hit_dice,
    speedFt: {
      walk: feet(speed.walk),
      ...(speed.fly ? { fly: feet(speed.fly) } : {}),
      ...(speed.swim ? { swim: feet(speed.swim) } : {}),
      ...(speed.climb ? { climb: feet(speed.climb) } : {}),
    },
    abilities: {
      STR: m.strength,
      DEX: m.dexterity,
      CON: m.constitution,
      INT: m.intelligence,
      WIS: m.wisdom,
      CHA: m.charisma,
    },
    cr: m.challenge_rating,
    xp: m.xp,
    proficiencyBonus: m.proficiency_bonus,
    saves,
    skills,
    darkvisionFt: feet(m.senses?.darkvision),
    passivePerception: m.senses?.passive_perception ?? 10,
    resistances: resist,
    immunities: immune,
    vulnerabilities: m.damage_vulnerabilities,
    resistsNonmagical,
    immuneNonmagical,
    conditionImmunities: (m.condition_immunities as Json[])
      .map((c) => c.index as ConditionId)
      .filter((c) => CONDITIONS.includes(c)),
    actions,
    traits: (m.special_abilities ?? []).map((s: Json) => slug(s.name)),
  };
  if (multi) def.multiattack = multi;
  if (!actions.length) throw new Error(`monster ${m.index} has no usable attack`);
  return def;
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const [skills, classes, levels, races, subraces, equipment, magicItems, spells, monsters] = await Promise.all([
    load("5e-SRD-Skills.json"),
    load("5e-SRD-Classes.json"),
    load("5e-SRD-Levels.json"),
    load("5e-SRD-Races.json"),
    load("5e-SRD-Subraces.json"),
    load("5e-SRD-Equipment.json"),
    load("5e-SRD-Magic-Items.json"),
    load("5e-SRD-Spells.json"),
    load("5e-SRD-Monsters.json"),
  ]);

  const eq = byIndex(equipment);
  const sub = byIndex(subraces);
  const potion = byIndex(magicItems).get("potion-of-healing-common");
  if (!potion) throw new Error("potion-of-healing-common missing");

  const items: ItemDef[] = [
    { id: "potion-of-healing", kind: "potion", heal: "2d4+2" },
    { id: "gold", kind: "gear" },
    // Story item (not SRD): see src/dm/stories/drachenfels.json
    { id: "drachenlanze", kind: "gear" },
    // Story item (not SRD): walpurgisnacht.json – makes weapons count as silvered.
    { id: "silberstaub", kind: "gear" },
    ...pick(eq, ["torch", "rope-hempen-50-feet", "healers-kit"], "equipment").map(
      (e): ItemDef => ({ id: e.index, kind: "gear" }),
    ),
  ];

  const out = {
    skills: convertSkills(skills),
    classes: pick(byIndex(classes), CLASSES, "class").map((c) => convertClass(c, levels)),
    races: pick(byIndex(races), Object.keys(RACES), "race").map((r) => {
      const subId = RACES[r.index];
      return convertRace(r, subId ? sub.get(subId) : undefined);
    }),
    weapons: pick(eq, WEAPONS, "weapon").map(convertWeapon),
    armor: pick(eq, ARMOR, "armor").map(convertArmor),
    items,
    spells: pick(byIndex(spells), SPELLS, "spell").map(convertSpell),
    monsters: pick(byIndex(monsters), MONSTERS, "monster").map(convertMonster),
    conditions: CONDITIONS,
  };

  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, data] of Object.entries(out)) {
    await writeFile(join(OUT_DIR, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
    console.log(`${name}: ${(data as unknown[]).length}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
