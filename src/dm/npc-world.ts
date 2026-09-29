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
  /** Adventures she appeared in (to tell "we have met before"). */
  adventures: string[];
  firstMet: number;
  lastSeen: number;
}

export interface NpcWorld {
  version: 1;
  npcs: Record<string, NpcMind>;
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
  return {
    gender,
    traits,
    speech: pickFrom(SPEECH, key, 4),
    wish: pickFrom(WISHES, key, 5),
    fear: pickFrom(FEARS, key, 6),
    secret: pickFrom(SECRETS, key, 10),
    likes: likesThing,
    dislikes,
    romance: { open, likes },
    voiceStyle: pickFrom(VOICE, key, 11),
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
