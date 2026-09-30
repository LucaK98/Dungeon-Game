/**
 * The memory of the world: every named character is one person for good.
 *
 * A character is known by name ("Gräfin Irmgard" is always the same woman, whichever adventure she
 * turns up in). The first meeting gives her a personality of her own – traits, way of speaking,
 * wishes, fears, a secret, whom she could fall for – and a voice style. After that she keeps what
 * happened (a few short facts) and how she feels about each hero (−10 … +10). When the heroes come
 * back, she remembers them.
 *
 * Pure data and rules: stored on the TV (src/tv/npc-store.ts), read by the director and the AI DM.
 */
import type { FamilyView } from "../shared/view";
import { KID_FAREWELL, pick, soundsYoung, SQUIRE_FAREWELL, TEEN_FAREWELL, YOUTH_GREETINGS, YOUTH_SPEECH } from "./youth";

export type Gender = "female" | "male";

export interface NpcPersona {
  gender: Gender;
  /** Three traits, e.g. "stolz", "großzügig", "misstrauisch". */
  traits: string[];
  /** How she talks. */
  speech: string;
  wish: string;
  fear: string;
  /** Known to the game master only; hinted at, never told outright. */
  secret: string;
  likes: string;
  dislikes: string;
  /** Who she could fall for (some are not interested in romance at all). */
  romance: { open: boolean; likes: Gender[] };
  /** For the storyteller voice: "warm und langsam", "schnell und spitz" … */
  voiceStyle: string;
  /** A young person: talks in today's youth slang (src/dm/youth.ts). */
  young?: boolean;
}

export interface NpcMind {
  name: string;
  monster: string;
  persona: NpcPersona;
  /** Short facts in her own view, newest last. */
  facts: string[];
  /** Feelings towards each hero (by hero name): −10 … +10. */
  bond: Record<string, number>;
  /** Romance with a hero (by name): 0 … 10 – separate from friendship. */
  love?: Record<string, number>;
  /** Heroes she had a rendezvous with, per adventure ("hero|adventure"). */
  dates?: string[];
  /** Said yes to this hero's proposal (the wedding is at home, after the adventure). */
  engaged?: string;
  /** Married to this hero; lives in the home village. */
  spouse?: string;
  /** The couple wishes for a child (said on the phone; it happens at home, after the adventure). */
  childWish?: string;
  /** Expecting a child with this hero since the world clock `since`; `announced` once told. */
  expecting?: { hero: string; since: number; announced?: boolean };
  /** Children with a hero; they live in the home village. */
  children?: NpcChild[];
  /** Her hero did not come home: she mourns. */
  widowOf?: string;
  /** Adventures she appeared in (to tell "we have met before"). */
  adventures: string[];
  firstMet: number;
  lastSeen: number;
}

export interface NpcWorld {
  version: 1;
  npcs: Record<string, NpcMind>;
  /** Foes the heroes let go: one may turn up one day and help (newest last). */
  spared?: { name: string; monster: string }[];
  /** What people tell each other (newest last): deeds of the heroes and what they said. */
  rumors?: { text: string; from: string }[];
  /** Adventures played to the end on this TV (children grow with it). */
  clock?: number;
}

export interface NpcChild {
  name: string;
  gender: Gender;
  /** The hero parent. */
  hero: string;
  /** World clock at birth. */
  born: number;
  /** One from each parent's side. */
  traits: string[];
  /** The hero parent gave the name on the phone (once). */
  named?: boolean;
  /** How often the hero parent came by (before an adventure). */
  visits: number;
  /** Goes along as squire (teenagers only). */
  squire?: boolean;
}

export const MAX_FACTS = 10;
export const BOND_MIN = -10;
export const BOND_MAX = 10;

export function emptyWorld(): NpcWorld {
  return { version: 1, npcs: {} };
}

/** The key of a character: her name, without case and extra spaces. */
export function npcKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function hash(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pickFrom<T>(list: readonly T[], key: string, salt: number): T {
  return list[hash(key, salt) % list.length]!;
}

const FEMALE_WORDS = /(^|\s)(frau|magd|hexe|muhme|vettel|mutter|oma|tante|königin|prinzessin|witwe|nonne|äbtissin|schwester|dame|jungfer)(\s|$)/i;
const FEMALE_NAMES = /(^|\s)(gerda|irmgard|grete|walpurga|walburga|hildegard|adelheid|agnes|berta|elsa|frieda|gisela|hedwig|ilse|kunigunde|lieselotte|margarete|mechthild|ottilie|rosa|rosalind|trude|ursula|wilma|anna|klara|lene|marthe|rike|brunhild|ragnhild|kriemhild|dietlinde|sieglinde|ortrun|fenja|mira|lina|greta|emma|lotte)\b/i;

/** Female by title ("Müllerin", "Gräfin", "Frau …") or first name; otherwise male. */
export function genderOf(name: string): Gender {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (FEMALE_WORDS.test(name) || FEMALE_NAMES.test(name)) return "female";
  // Titles ending in -in (Müllerin, Gräfin, Wirtin, Försterin), not names like "Merlin".
  if (/[a-zäöü]{3,}in$/i.test(first) && !/^(merlin|martin|kevin|erwin|edwin|alwin)$/i.test(first)) return "female";
  return "male";
}

/** People who can talk and feel (not wolves, not skeletons). */
const PEOPLE = new Set(["commoner", "noble", "guard", "priest", "acolyte", "scout", "knight", "veteran", "mage", "spy", "bandit", "bandit-captain", "thug", "druid", "cult-fanatic", "cultist", "gladiator", "berserker", "tribal-warrior"]);

export function isPerson(monster: string): boolean {
  return PEOPLE.has(monster);
}

const TRAITS = [
  "stolz", "großzügig", "misstrauisch", "neugierig", "gutmütig", "launisch", "ehrgeizig", "schüchtern", "herzlich", "geizig",
  "abergläubisch", "mutig", "ängstlich", "verschmitzt", "fromm", "ungeduldig", "geschwätzig", "wortkarg", "eitel", "hilfsbereit",
  "sturköpfig", "verträumt", "listig", "ehrlich bis zur Grobheit",
];
const SPEECH = [
  "spricht langsam und bedächtig, mit langen Pausen",
  "redet schnell und ohne Punkt und Komma",
  "benutzt altmodische, gewählte Worte",
  "spricht derb und direkt, mit Harzer Dialekt",
  "flüstert gern, als wäre alles ein Geheimnis",
  "lacht viel und macht kleine Witze",
  "stellt ständig Gegenfragen",
  "seufzt oft und klagt über alles",
  "redet in Sprichwörtern",
  "ist kurz angebunden und knapp",
  "schmeichelt jedem, der ihr zuhört",
  "spricht warm und mütterlich-väterlich",
];
const WISHES = [
  "einmal das Meer sehen", "genug Gold für ein eigenes Haus", "dass die Familie wieder zusammenfindet", "Rache an einem alten Feind",
  "ein ruhiges Leben ohne Monster", "als Held in einem Lied besungen werden", "die große Liebe finden", "das Geheimnis der alten Burg lüften",
  "den verlorenen Bruder wiederfinden", "ein Fest, von dem man noch in hundert Jahren spricht", "endlich einmal ausschlafen", "einen Drachen aus der Nähe sehen",
];
const FEARS = [
  "Dunkelheit", "Spinnen", "Einsamkeit", "Hexen", "den Winter", "Armut", "Wölfe", "tiefes Wasser", "vergessen zu werden", "Gewitter", "den Tod", "Fremde",
];
const SECRETS = [
  "hat einmal aus Not gestohlen", "ist heimlich in jemanden aus dem Dorf verliebt", "hat eine verbotene Zauberschrift versteckt", "stammt eigentlich aus einem Adelshaus",
  "schuldet einem Räuber viel Geld", "hat einen Schatz vergraben und die Stelle vergessen", "war früher selbst Abenteurer und ist geflohen", "kann nicht lesen und schämt sich dafür",
  "hat ein Kind, von dem niemand weiß", "hört nachts Stimmen aus dem Brunnen", "hat den Bürgermeister einmal belogen", "trägt ein Amulett einer toten Liebe",
];
const LIKES = ["Blumen", "gutes Essen", "Musik und Lieder", "Ehrlichkeit", "Mut", "Geschenke", "kluge Fragen", "Tiere", "Humor", "Höflichkeit", "Gold", "Geschichten von der Reise"];
const DISLIKES = ["Prahler", "Lügner", "Grobheit", "Gestank", "Ungeduld", "Geiz", "Magie", "Hunde", "laute Leute", "Schmeichelei", "Unordnung", "Diebe"];
const VOICE = ["warm und ruhig", "hell und lebhaft", "rau und tief", "leise und zögerlich", "kräftig und laut", "spitz und schnell", "sanft und singend", "trocken und knapp"];

/** A personality of her own, the same for the same name every time (no AI needed). */
export function personaFor(name: string, monster: string): NpcPersona {
  const key = npcKey(name);
  const gender = genderOf(name);
  const traits: string[] = [];
  for (let salt = 1; traits.length < 3 && salt < 20; salt++) {
    const t = pickFrom(TRAITS, key, salt);
    if (!traits.includes(t)) traits.push(t);
  }
  // Romance: most people are open to it; most like the other sex, some their own, a few both.
  const r = hash(key, 99) % 100;
  const open = isPerson(monster) && r < 75;
  const other: Gender = gender === "female" ? "male" : "female";
  const pref = hash(key, 101) % 100;
  const likes: Gender[] = !open ? [] : pref < 80 ? [other] : pref < 92 ? [gender] : [other, gender];
  const likesThing = pickFrom(LIKES, key, 7);
  let dislikes = pickFrom(DISLIKES, key, 8);
  if (dislikes === likesThing) dislikes = pickFrom(DISLIKES, key, 9);
  // Apprentices, squires, maids – and about one person in eight – are young.
  const young = isPerson(monster) && (soundsYoung(name) || hash(key, 131) % 100 < 12);
  return {
    gender,
    traits,
    speech: young ? YOUTH_SPEECH : pickFrom(SPEECH, key, 4),
    ...(young ? { young: true } : {}),
    wish: pickFrom(WISHES, key, 5),
    fear: pickFrom(FEARS, key, 6),
    secret: pickFrom(SECRETS, key, 10),
    likes: likesThing,
    dislikes,
    romance: { open, likes },
    voiceStyle: young ? "jung, frech und schnell" : pickFrom(VOICE, key, 11),
  };
}

/**
 * Meets a character: known ones come back with everything they remember, new ones get a personality.
 * `returning`: she met the group in an earlier adventure.
 */
export function meet(world: NpcWorld, name: string, monster: string, adventure: string, now: number): { mind: NpcMind; returning: boolean } {
  const key = npcKey(name);
  let mind = world.npcs[key];
  if (!mind) {
    mind = { name, monster, persona: personaFor(name, monster), facts: [], bond: {}, adventures: [], firstMet: now, lastSeen: now };
    world.npcs[key] = mind;
  }
  const returning = mind.adventures.some((a) => a !== adventure);
  if (!mind.adventures.includes(adventure)) {
    mind.adventures.push(adventure);
    if (mind.adventures.length > 20) mind.adventures.splice(0, mind.adventures.length - 20);
  }
  mind.lastSeen = now;
  return { mind, returning };
}

export function findMind(world: NpcWorld, name: string): NpcMind | undefined {
  return world.npcs[npcKey(name)];
}

/** Adds something she will remember (short, in her view). Old facts fade after MAX_FACTS. */
export function remember(mind: NpcMind, fact: string): void {
  const clean = fact.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!clean || mind.facts.includes(clean)) return;
  mind.facts.push(clean);
  if (mind.facts.length > MAX_FACTS) mind.facts.splice(0, mind.facts.length - MAX_FACTS);
}

export function bondOf(mind: NpcMind, hero: string): number {
  return mind.bond[hero] ?? 0;
}

export function changeBond(mind: NpcMind, hero: string, delta: number): number {
  const next = Math.max(BOND_MIN, Math.min(BOND_MAX, bondOf(mind, hero) + delta));
  mind.bond[hero] = next;
  return next;
}

/** How she stands with a hero, in one word. */
export function bondLabel(bond: number): string {
  if (bond <= -6) return "verfeindet";
  if (bond <= -2) return "misstrauisch";
  if (bond < 2) return "neutral";
  if (bond < 5) return "freundlich";
  if (bond < 8) return "befreundet";
  return "sehr vertraut";
}

function romanceText(p: NpcPersona): string {
  if (!p.romance.open) return "nicht an Romantik interessiert (weist Flirts freundlich, aber klar ab)";
  const who = p.romance.likes.map((g) => (g === "female" ? "Frauen" : "Männer")).join(" und ");
  return `offen für Romantik, fühlt sich zu ${who} hingezogen (andere Flirts weist sie/er freundlich ab)`;
}

/** Everything the game master needs to play her true to herself (for the AI prompt). */
export function mindPrompt(mind: NpcMind, heroes: string[]): string {
  const p = mind.persona;
  const bonds = heroes.map((h) => `${h} ${bondOf(mind, h) >= 0 ? "+" : ""}${bondOf(mind, h)} (${bondLabel(bondOf(mind, h))})`).join(", ");
  return [
    `${mind.name} (${p.gender === "female" ? "Frau" : "Mann"}): ${p.traits.join(", ")}; ${p.speech}.`,
    `Wünscht sich: ${p.wish}. Fürchtet: ${p.fear}. Mag: ${p.likes}. Mag nicht: ${p.dislikes}.`,
    `Geheimnis (nur andeuten): ${p.secret}. Romantik: ${romanceText(p)}.`,
    `Gefühle zu den Helden: ${bonds}.`,
    heroes.some((h) => loveOf(mind, h) > 0) ? `Romantik: ${heroes.filter((h) => loveOf(mind, h) > 0).map((h) => `${h} ${loveLabel(loveOf(mind, h))} (${loveOf(mind, h)}/10)`).join(", ")}.` : "",
    mind.spouse ? `Verheiratet mit ${mind.spouse}.` : mind.widowOf ? `Trauert um ${mind.widowOf}.` : "",
    mind.expecting ? `Erwartet ein Kind von ${mind.expecting.hero}.` : "",
    mind.children?.length ? `Kinder: ${mind.children.map((c) => `${c.name} (mit ${c.hero}, ${c.traits.join(" und ")})`).join(", ")}.` : "",
    mind.facts.length ? `Erinnert sich: ${mind.facts.slice(-6).join(" | ")}` : "Kennt die Helden noch nicht.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The first words when she sees heroes again she already knows (no AI needed). */
export function greetingFor(mind: NpcMind, heroes: string[]): string {
  const known = heroes.filter((h) => h in mind.bond).sort((a, b) => bondOf(mind, b) - bondOf(mind, a));
  const who = known[0];
  const b = who ? bondOf(mind, who) : 0;
  const last = mind.facts[mind.facts.length - 1];
  if (mind.persona.young) {
    const r = (mind.facts.length % 7) / 7;
    const yo = pick(!who ? YOUTH_GREETINGS.stranger : b >= 5 ? YOUTH_GREETINGS.friend : b <= -2 ? YOUTH_GREETINGS.enemy : YOUTH_GREETINGS.known, r, who ?? "");
    return last ? `${yo} Weißt du noch? ${last}` : yo;
  }
  const hello = b >= 5 ? `${who}! Wie schön, dich wiederzusehen!` : b >= 2 ? `Ah, ${who}! Ihr seid zurück.` : b <= -2 ? `Ihr schon wieder${who ? `, ${who}` : ""} …` : "Euch kenne ich doch!";
  return last ? `${hello} Ich weiß noch genau: ${last}` : hello;
}

// ---------------------------------------------------------------- romance

export const LOVE_MAX = 10;
/** From here on she is in love (a rendezvous can happen). */
export const IN_LOVE = 5;

export function loveOf(mind: NpcMind, hero: string): number {
  return mind.love?.[hero] ?? 0;
}

export function changeLove(mind: NpcMind, hero: string, delta: number): number {
  const next = Math.max(0, Math.min(LOVE_MAX, loveOf(mind, hero) + delta));
  (mind.love ??= {})[hero] = next;
  return next;
}

export function loveLabel(love: number): string {
  if (love <= 0) return "";
  if (love < 3) return "ein Funke";
  if (love < IN_LOVE) return "geschmeichelt";
  if (love < 8) return "verliebt";
  return "sehr verliebt";
}

/** Can she fall for this hero at all? (Some people are not into romance, and each has a preference.) */
export function attractedTo(mind: NpcMind, heroGender: Gender): boolean {
  return mind.persona.romance.open && mind.persona.romance.likes.includes(heroGender);
}

/** How hard a flirt is: easier with a friend, harder with someone who distrusts you. */
export function flirtDc(mind: NpcMind, hero: string): number {
  const bond = bondOf(mind, hero);
  const love = loveOf(mind, hero);
  const shy = mind.persona.traits.some((t) => ["schüchtern", "misstrauisch", "stolz", "fromm"].includes(t)) ? 1 : 0;
  return Math.max(8, Math.min(18, 14 - Math.floor(bond / 2) - Math.floor(love / 3) + shy));
}

export type FlirtOutcome = "not_interested" | "great" | "yes" | "no" | "too_much";

/** What a flirt does: the outcome, and how love and friendship change. */
export function flirtResult(mind: NpcMind, heroGender: Gender, roll: { total: number; dc: number } | undefined): { outcome: FlirtOutcome; love: number; bond: number } {
  if (!attractedTo(mind, heroGender) || !roll) return { outcome: "not_interested", love: 0, bond: 0 };
  const margin = roll.total - roll.dc;
  if (margin >= 5) return { outcome: "great", love: 3, bond: 1 };
  if (margin >= 0) return { outcome: "yes", love: 2, bond: 1 };
  if (margin >= -5) return { outcome: "no", love: 0, bond: 0 };
  return { outcome: "too_much", love: 0, bond: -1 };
}

const LINES: Record<FlirtOutcome, string[]> = {
  not_interested: [
    "Du bist wirklich nett, {hero} – aber da muss ich dich enttäuschen. Freunde?",
    "Ach, {hero}. Das ehrt mich, aber mein Herz schlägt für andere.",
    "Schmeichler! Aber nein, daraus wird nichts. Trotzdem danke.",
  ],
  great: [
    "Oh … {hero}, du bringst mich ja ganz durcheinander.",
    "So hat schon lange niemand mehr mit mir geredet. Bleib doch noch ein bisschen.",
    "Du hast Mut, {hero}. Und Charme. Das gefällt mir sehr.",
  ],
  yes: [
    "Hm, du bist ja ein ganz Netter. Erzähl mir mehr von dir.",
    "Ich werde ja ganz rot … hör auf damit! Oder – nein, hör nicht auf.",
    "Vielleicht zeigst du mir irgendwann mal, wie mutig du wirklich bist.",
  ],
  no: [
    "Heute nicht, {hero}. Aber netter Versuch.",
    "Hm. Versuch es vielleicht mit etwas weniger Getöse.",
    "Ich kenne dich doch kaum. Mal sehen.",
  ],
  too_much: [
    "Also wirklich! Was fällt dir ein, {hero}?",
    "Das war jetzt ein bisschen zu viel des Guten.",
    "Geh mir aus der Sonne, du Aufschneider.",
  ],
};

/** Her answer in her own words (without the AI), different for different people. */
export function flirtLine(mind: NpcMind, hero: string, outcome: FlirtOutcome, salt = 0): string {
  const list = LINES[outcome];
  return list[hash(`${npcKey(mind.name)}|${hero}`, salt) % list.length]!.replace("{hero}", hero);
}

/** Gifts: something she likes counts double. "Blumen" are herbs, "Gold" is gold, and so on. */
const LIKE_ITEMS: Record<string, RegExp> = {
  Blumen: /kraut|blume|blüte|herb/i,
  "gutes Essen": /brot|ration|pilz|käse|wurst|essen|mushroom|food/i,
  Gold: /^gold$/i,
  Geschenke: /./,
  Tiere: /fell|feder|horn/i,
  "Musik und Lieder": /flöte|laute|horn/i,
};

export function giftValue(mind: NpcMind, itemId: string, itemName: string): { liked: boolean; bond: number } {
  const re = LIKE_ITEMS[mind.persona.likes];
  const liked = !!re && (re.test(itemId) || re.test(itemName));
  return { liked, bond: liked ? 3 : 1 };
}

/** One rendezvous per couple and adventure. */
export function canDate(mind: NpcMind, hero: string, adventure: string): boolean {
  return loveOf(mind, hero) >= IN_LOVE && !(mind.dates ?? []).includes(`${hero}|${adventure}`);
}

export function markDate(mind: NpcMind, hero: string, adventure: string): void {
  (mind.dates ??= []).push(`${hero}|${adventure}`);
  if (mind.dates.length > 30) mind.dates.splice(0, mind.dates.length - 30);
}

// ---------------------------------------------------------------- marriage

/** From here on she would say yes to a ring. */
export const PROPOSE_LOVE = 8;
export const PROPOSE_BOND = 3;

/** The character this hero is married to (or engaged with), if any. */
export function partnerOf(world: NpcWorld, hero: string): { mind: NpcMind; married: boolean } | undefined {
  for (const mind of Object.values(world.npcs)) {
    if (mind.spouse === hero) return { mind, married: true };
    if (mind.engaged === hero) return { mind, married: false };
  }
  return undefined;
}

export type ProposalAnswer = "yes" | "too_soon" | "not_interested" | "taken" | "already_bound";

/** Would she say yes? Love and friendship must be high; nobody marries twice. */
export function proposalAnswer(world: NpcWorld, mind: NpcMind, hero: string, heroGender: Gender): ProposalAnswer {
  if (partnerOf(world, hero) && partnerOf(world, hero)!.mind !== mind) return "already_bound";
  if ((mind.spouse && mind.spouse !== hero) || (mind.engaged && mind.engaged !== hero)) return "taken";
  if (!attractedTo(mind, heroGender)) return "not_interested";
  if (loveOf(mind, hero) < PROPOSE_LOVE || bondOf(mind, hero) < PROPOSE_BOND) return "too_soon";
  return "yes";
}

/** Back home: every engaged couple whose hero is still alive gets married. */
export function holdWeddings(world: NpcWorld, alive: string[]): { hero: string; name: string }[] {
  const out: { hero: string; name: string }[] = [];
  for (const mind of Object.values(world.npcs)) {
    if (!mind.engaged || !alive.includes(mind.engaged)) continue;
    mind.spouse = mind.engaged;
    delete mind.engaged;
    remember(mind, `Ich habe ${mind.spouse} geheiratet – der schönste Tag meines Lebens.`);
    out.push({ hero: mind.spouse, name: mind.name });
  }
  return out;
}

// ---------------------------------------------------------------- family and children

/** Adventures until a baby is a child, and a child a teenager (who may go along as squire). */
export const CHILD_AT = 3;
export const TEEN_AT = 6;
/** Adventures from the night in question to the birth. */
export const BIRTH_AFTER = 2;
export const MAX_CHILDREN = 4;

export type ChildStage = "baby" | "kind" | "jugend";

export function stageOf(child: NpcChild, clock: number): ChildStage {
  const age = clock - child.born;
  return age < CHILD_AT ? "baby" : age < TEEN_AT ? "kind" : "jugend";
}

export const STAGE_LABEL: Record<ChildStage, string> = { baby: "Baby", kind: "Kind", jugend: "Jugendlich" };

const GIRLS = ["Liese", "Grete", "Frieda", "Anni", "Mathilde", "Klara", "Ida", "Hanne", "Rosalie", "Emma", "Marie", "Lotte"];
const BOYS = ["Hannes", "Fritz", "Jakob", "Karl", "Paul", "Emil", "Konrad", "Otto", "Anton", "Ludwig", "Moritz", "Theo"];

/** The hero parent's children (with the other parent). */
export function childrenOf(world: NpcWorld, hero: string): { mind: NpcMind; child: NpcChild }[] {
  return Object.values(world.npcs).flatMap((mind) => (mind.children ?? []).filter((c) => c.hero === hero).map((child) => ({ mind, child })));
}

/** Only a married couple can wish for a child, and not while one is on the way. */
export function setChildWish(world: NpcWorld, hero: string, on: boolean): boolean {
  const p = partnerOf(world, hero);
  if (!p?.married || p.mind.expecting || (p.mind.children?.length ?? 0) >= MAX_CHILDREN) return false;
  if (on) p.mind.childWish = hero;
  else delete p.mind.childWish;
  return true;
}

/** The hero parent names a child – once, and only a proper name. */
export function nameChild(world: NpcWorld, hero: string, index: number, name: string): boolean {
  const entry = childrenOf(world, hero)[index];
  const clean = name.replace(/[<>{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
  if (!entry || entry.child.named || clean.length < 2) return false;
  entry.child.name = clean;
  entry.child.named = true;
  return true;
}

/** A teenager may go along as squire (one per hero). */
export function setSquire(world: NpcWorld, hero: string, index: number, on: boolean): boolean {
  const list = childrenOf(world, hero);
  const entry = list[index];
  if (!entry || (on && stageOf(entry.child, world.clock ?? 0) !== "jugend")) return false;
  for (const e of list) delete e.child.squire;
  if (on) entry.child.squire = true;
  return true;
}

/** The squire who goes along with this hero, if any. */
export function squireOf(world: NpcWorld, hero: string): NpcChild | undefined {
  return childrenOf(world, hero).find((e) => e.child.squire && stageOf(e.child, world.clock ?? 0) === "jugend")?.child;
}

export type FamilyEvent =
  | { kind: "mourn"; hero: string; name: string }
  | { kind: "night"; hero: string; name: string }
  | { kind: "birth"; hero: string; name: string; child: NpcChild }
  | { kind: "grown"; hero: string; name: string; child: NpcChild; stage: ChildStage };

/**
 * Home again, after the weddings: time passes. Those whose hero fell mourn (the children stay);
 * babies are born, children grow; a couple with a wish spends the night together (the curtain falls).
 */
export function familyAfterAdventure(world: NpcWorld, alive: string[], fallen: string[], seed = 0): FamilyEvent[] {
  const out: FamilyEvent[] = [];
  world.clock = (world.clock ?? 0) + 1;
  const clock = world.clock;
  for (const mind of Object.values(world.npcs)) {
    if (mind.spouse && fallen.includes(mind.spouse)) {
      const hero = mind.spouse;
      mind.widowOf = hero;
      delete mind.spouse;
      delete mind.childWish;
      remember(mind, `${hero} ist nicht heimgekehrt. Ich halte das Haus warm – für die Kinder und für die Erinnerung.`);
      out.push({ kind: "mourn", hero, name: mind.name });
    } else if (mind.engaged && fallen.includes(mind.engaged)) {
      const hero = mind.engaged;
      mind.widowOf = hero;
      delete mind.engaged;
      remember(mind, `${hero} wollte mich heiraten – und ist nicht heimgekehrt.`);
      out.push({ kind: "mourn", hero, name: mind.name });
    }
    for (const child of mind.children ?? []) {
      const before = stageOf(child, clock - 1);
      const now = stageOf(child, clock);
      if (now !== before) out.push({ kind: "grown", hero: child.hero, name: mind.name, child, stage: now });
    }
    if (mind.expecting && clock - mind.expecting.since >= BIRTH_AFTER) {
      const hero = mind.expecting.hero;
      const n = (mind.children?.length ?? 0) + hash(npcKey(mind.name), 200 + clock + seed);
      const gender: Gender = n % 2 ? "female" : "male";
      const pool = gender === "female" ? GIRLS : BOYS;
      const taken = new Set((mind.children ?? []).map((c) => c.name));
      const free = pool.map((_, i) => pool[(n + i) % pool.length]!).filter((x) => !taken.has(x));
      const name = free[0] ?? `${pool[n % pool.length]} ${taken.size + 1}`;
      const extra = TRAITS.filter((t) => !mind.persona.traits.includes(t));
      const child: NpcChild = { name, gender, hero, born: clock, traits: [mind.persona.traits[n % mind.persona.traits.length]!, extra[n % extra.length]!], visits: 0 };
      (mind.children ??= []).push(child);
      delete mind.expecting;
      remember(mind, `Unser Kind ist da: ${name}. ${alive.includes(hero) ? `${hero} hat es als Erste${gender === "male" ? "n" : ""} gehalten.` : `Ich wünschte, ${hero} könnte es sehen.`}`);
      out.push({ kind: "birth", hero, name: mind.name, child });
    }
    if (mind.childWish && mind.spouse === mind.childWish && alive.includes(mind.spouse) && !mind.expecting) {
      mind.expecting = { hero: mind.spouse, since: clock };
      delete mind.childWish;
      out.push({ kind: "night", hero: mind.spouse, name: mind.name });
    }
  }
  return out;
}

/**
 * Before an adventure: the family sees their hero off. Good news is told once; children remember
 * how often their parent came by.
 */
export function familyFarewell(world: NpcWorld, heroes: string[]): { npc?: string; text: string }[] {
  const lines: { npc?: string; text: string }[] = [];
  const clock = world.clock ?? 0;
  for (const mind of Object.values(world.npcs)) {
    const e = mind.expecting;
    if (e && !e.announced && heroes.includes(e.hero)) {
      e.announced = true;
      remember(mind, `Ich habe ${e.hero} gesagt, dass wir ein Kind erwarten.`);
      lines.push({ text: `🍼 ${mind.name} nimmt ${e.hero} beiseite und strahlt:` }, { npc: mind.name, text: `${e.hero}, wir bekommen ein Kind! Pass da draußen gut auf dich auf.` });
    }
    for (const child of mind.children ?? []) {
      if (!heroes.includes(child.hero)) continue;
      child.visits += 1;
      const stage = stageOf(child, clock);
      const text =
        stage === "baby"
          ? `👶 ${child.name} gluckst in den Armen von ${mind.name}, als ${child.hero} sich verabschiedet.`
          : stage === "kind"
            ? child.visits > 3
              ? `🧒 ${child.name} (${child.traits[1]}): ${pick(KID_FAREWELL, (child.visits % 5) / 5)}`
              : `🧒 ${child.name} (${child.traits[1]}) hängt an ${child.hero}s Bein: „Kommst du bald wieder?“`
            : child.squire
              ? `🗡️ ${child.name}: ${pick(SQUIRE_FAREWELL, (child.visits % 7) / 7, child.hero)}`
              : `🧑 ${child.name} (${child.traits[0]}): ${pick(TEEN_FAREWELL, (child.visits % 9) / 9, child.hero)}`;
      lines.push({ text });
    }
  }
  return lines;
}

export function familyView(world: NpcWorld, hero: string): FamilyView | undefined {
  const p = partnerOf(world, hero);
  const kids = childrenOf(world, hero);
  if (!p && !kids.length) return undefined;
  const clock = world.clock ?? 0;
  const v: FamilyView = {};
  if (p) {
    if (p.married) v.spouse = p.mind.name;
    else v.engaged = p.mind.name;
    if (p.married && p.mind.childWish === hero) v.wish = true;
    if (p.married && !p.mind.expecting && (p.mind.children?.length ?? 0) < MAX_CHILDREN) v.canWish = true;
    if (p.mind.expecting?.hero === hero && p.mind.expecting.announced) v.expecting = true;
  }
  if (kids.length) {
    v.children = kids.map(({ child }) => {
      const stage = stageOf(child, clock);
      return { name: child.name, stage: STAGE_LABEL[stage], named: !!child.named, squire: !!child.squire && stage === "jugend", canSquire: stage === "jugend", traits: [...child.traits] };
    });
  }
  return v;
}

// ---------------------------------------------------------------- rumours

export const MAX_RUMORS = 12;

/** Something people will talk about (from: who saw or heard it first). */
export function spreadRumor(world: NpcWorld, text: string, from: string): void {
  const list = (world.rumors ??= []);
  if (list.some((r) => r.text === text)) return;
  list.push({ text: text.slice(0, 140), from });
  if (list.length > MAX_RUMORS) list.splice(0, list.length - MAX_RUMORS);
}

/** A character picks up what others tell (at most `max` new things, never her own). */
export function hearRumors(world: NpcWorld, mind: NpcMind, max = 1): string[] {
  const heard: string[] = [];
  for (const r of [...(world.rumors ?? [])].reverse()) {
    if (heard.length >= max) break;
    if (r.from === mind.name) continue;
    const fact = `Man erzählt sich: ${r.text}`;
    if (mind.facts.includes(fact)) continue;
    remember(mind, fact);
    heard.push(r.text);
  }
  return heard;
}
