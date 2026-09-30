/**
 * Young people talk like young people: teenage children, squires, apprentices and some of the
 * younger foes use today's youth slang (digga, sheesh, cringe, no cap …) – loose and cheeky,
 * but still understandable.
 */

/** How young characters speak (for the AI and the personality card). */
export const YOUTH_SPEECH =
  "ist jung und redet in moderner Jugendsprache (digga, bro, sheesh, cringe, lost, no cap, lowkey, safe, Ehrenmann/Ehrenfrau, same, wild, sus, mid, Aura, Rizz, NPC-Verhalten, ich schwör, bruh, slay) – locker und frech, aber verständlich";

/** Titles that sound young. */
const YOUNG_WORDS = /\b(knappe|knappin|lehrling|magd|junge|junger|junges|jung|kleine|kleiner|bursche|göre|stallbursche|page|schüler|schülerin|novize|novizin|laufbursche|küken)\b/i;

export function soundsYoung(name: string): boolean {
  return YOUNG_WORDS.test(name);
}

/** Fills {hero} and picks one line (roll 0…1). */
export function pick(list: string[], roll: number, hero = ""): string {
  return list[Math.floor(roll * list.length) % list.length]!.replaceAll("{hero}", hero);
}

export const YOUTH_GREETINGS = {
  friend: ["Yo {hero}, digga! Endlich wieder da – sheesh, hab dich vermisst.", "{hero}! Ehrenmann-Move, dass du wiederkommst. No cap.", "Ayo {hero}! Lange nicht gesehen, bro. Was geht?"],
  known: ["Ah, {hero}. Safe, ihr seid zurück.", "Oh, {hero}, ihr wieder. Lowkey nice.", "Na {hero}, alles fit? Same hier."],
  enemy: ["Bruh. Ihr schon wieder, {hero}? Cringe.", "Ihr seid so mid, {hero}. Echt jetzt.", "Nee, {hero}, auf euch hab ich null Bock."],
  stranger: ["Yo, euch kenn ich doch! Ich schwör.", "Wait – euch hab ich schon mal gesehen. Wild."],
};

/** Teenage children seeing their parent off. */
export const TEEN_FAREWELL = [
  "„Yo, {hero}, pass auf dich auf, ja? Nicht wieder so lost rumlaufen.“",
  "„Sheesh, schon wieder los? Bring was Krasses mit, no cap.“",
  "„Ey, sei kein NPC da draußen. Du packst das, Ehrenmann-Energie!“",
  "„Lowkey stolz auf dich. Aber sag’s keinem, sonst cringe.“",
];

export const SQUIRE_FAREWELL = [
  "„Knappe-Modus aktiviert, digga. Heute wird gesnackt – Monster zum Frühstück!“",
  "„Ich bin ready, {hero}. Wir slayen das heute, ich schwör.“",
  "„Aura-Farming beim Abenteuer, let’s go!“",
];

export const KID_FAREWELL = [
  "„Das ist voll unfair, dass ich nicht mitdarf. Mega cringe!“",
  "„Bring mir ein Drachenzahn mit! Das wär so krass!“",
];

/** Trash talk of young foes: cheeky and crude. */
export const YOUTH_TAUNTS: Record<"hit_hero" | "missed_hero" | "hero_missed" | "hurt" | "low" | "dying", { cheeky: string[]; crude: string[] }> = {
  hit_hero: {
    cheeky: ["Sheesh, {hero}! Voll erwischt, bro!", "Get rekt, {hero}! Git gud!", "Das war ein Aura-Treffer, digga!"],
    crude: ["Friss das, du Lauch! Sheesh!", "Get rekt, du Opfer! Hahaha!", "Digga, du kämpfst wie ein Hurensohn-NPC!"],
  },
  missed_hero: {
    cheeky: ["Bruh, voll daneben. Lag!", "Das zählt nicht, mein Controller hat gesponnen!"],
    crude: ["Verfickte Scheiße, Lag, bro!", "Digga, halt still, du Lauch!"],
  },
  hero_missed: {
    cheeky: ["Daneben! Voll mid, {hero}!", "Bruh, das war so cringe, {hero}!", "Skill-Issue, digga!", "Lost. Einfach lost, {hero}."],
    crude: ["Skill-Issue, du Lauch!", "Digga, triffst du überhaupt was? Hurensohn-Aim!", "Hahaha, cringe, du Opfer!"],
  },
  hurt: {
    cheeky: ["Au! Okay, das war lowkey krass.", "Sheesh, das hat gesessen!"],
    crude: ["Au, du Wichser! Das war nicht fair, bro!", "Digga, was soll die Scheiße?!"],
  },
  low: {
    cheeky: ["Bro, ich bin raus, ich schwör! Gib mir ’nen Respawn!", "Okay okay, ihr habt Aura. Ich geb’s zu."],
    crude: ["Scheiße, bro, ich hab kein Bock mehr!", "Digga, ich bin so am Arsch!"],
  },
  dying: {
    cheeky: ["Bruh … ich wurde … gecancelt …", "Sheesh … GG …", "Unfair … Lag …"],
    crude: ["Fick … dich … Lauch …", "GG … du Hurensohn …"],
  },
};
